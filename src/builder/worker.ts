import { type Tree, Application, Exit } from '@yowasp/runtime';
import * as yosys from '@yowasp/yosys';
import * as nextpnrIce40 from '@yowasp/nextpnr-ice40';

import * as proto from './proto';

declare function postMessage(message: proto.BuilderToAppMessage, transfer: Transferable[]): void;
declare function postMessage(message: proto.BuilderToAppMessage, options?: StructuredSerializeOptions): void;
declare var onmessage: ((this: DedicatedWorkerGlobalScope, ev: MessageEvent<proto.AppToBuilderMessage>) => any) | null;

interface Command {
    run: Application['run'],
    Exit: typeof Exit
}

interface Script {
    commands: string[][]
}

const commands = (async () => {
    const packages = new Map<string, string>();
    const commands = new Map<string, Command>();
    for (const [bundleName, bundle] of Object.entries({ yosys, 'nextpnr-ice40': nextpnrIce40 })) {
        packages.set(bundleName, bundle.version);
        for (const [commandName, commandRun] of Object.entries(bundle.commands)) {
            commands.set(commandName, { run: commandRun, Exit: bundle.Exit });
        }
    }
    postMessage({ type: 'packages', packages: Object.fromEntries(packages.entries()) });
    return commands;
})();

function lineBuffered(process: (bytes: Uint8Array) => void): (bytes: Uint8Array | null) => void {
    let buffer = new Uint8Array();
    return (bytes: Uint8Array | null) => {
        if (bytes === null) {
            // Ignore flushes. Nextpnr will write to stderr one character at a time, which isn't
            // very helpful for anything.

            // process(buffer);
            // buffer = new Uint8Array();
        } else {
            let newBuffer = new Uint8Array(buffer.length + bytes.length);
            newBuffer.set(buffer);
            newBuffer.set(bytes, buffer.length);
            buffer = newBuffer;

            let newlineAt = -1;
            while (true) {
                const nextNewlineAt = buffer.indexOf(10, newlineAt + 1);
                if (nextNewlineAt === -1)
                    break;
                process(buffer.subarray(newlineAt + 1, nextNewlineAt + 1));
                newlineAt = nextNewlineAt;
            }
            buffer = buffer.subarray(newlineAt + 1);
        }
    };
}

async function executeScript(
    files: Tree,
    scriptName: string,
    writeOutput: (bytes: Uint8Array) => void
): Promise<{ code: number, files: Tree }> {
    const writeBuffered = lineBuffered(writeOutput);
    const script = <Script>JSON.parse(<string>files[scriptName]);
    for (const scriptLine of script.commands) {
        writeBuffered(new TextEncoder().encode(`+ ${scriptLine.join(' ')}\n`));
        const [name, ...args] = scriptLine;
        const command = (await commands).get(name)!;
        try {
            files = await command.run(args, files, {
                stdout: writeBuffered,
                stderr: writeBuffered,
                decodeASCII: false,
                fetchProgress: ({ totalLength, doneLength }) => {
                    postMessage({ type: 'loadProgress', command: name, totalLength, doneLength });
                },
            })!;
        } catch (error) {
            if (error instanceof command.Exit) {
                return { code: error.code, files: error.files };
            } else {
                throw error;
            }
        }
    }
    return { code: 0, files };
}

onmessage = async (event) => {
    const { files, scriptName } = event.data;
    const result = await executeScript(files, scriptName, (bytes) => {
        if (bytes.length !== 0) {
            console.log('[Builder Output]', new TextDecoder().decode(bytes).trimEnd());
            postMessage({ type: 'output', bytes });
        }
    });
    console.log('[Builder Result]', result);
    postMessage({ type: 'result', ...result });

};

onunhandledrejection = (event) => {
    if (event.reason instanceof Error) {
        console.error('[Builder Error]', event.reason);
        postMessage({ type: 'error', error: event.reason });
        event.preventDefault();
    }
};
