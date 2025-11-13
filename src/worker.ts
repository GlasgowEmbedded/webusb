import cloneDeepWith from 'lodash/cloneDeepWith';
import termColors from './vendor/terminal-colors';
import { loadPyodide, type PyProxy } from './vendor/pyodide';

import type { InitialState } from './types';
import type { PageEndpoints, PageToWorkerMessage, WorkerEndpoints, WorkerToPageMessage } from './proto';

import { loadToolchain } from './toolchain';
import { GlasgowFileSystem } from './filesystem';
import { getPyodideStreamApiForTerminal, getPyodideTtyApiForTerminal, TerminalHandle } from './terminal-handle';

import { RPCController } from './rpc';

import { GLASGOW_WHEEL_URL, HOME_DIRECTORY } from './config';
import shell from './shell.py';

declare global {
    interface RegExpConstructor {
        escape(string: string): string;
    }

    namespace WebAssembly {
        const promising: unknown;
    }

    function syncFSFromBacking(): Promise<void>;
    function syncFSToBacking(): Promise<void>;

    function setIsExecutingCommand(value: boolean): void;
    function setInterruptFuture(future: any): void;
}

function send<M extends WorkerToPageMessage>(message: M, transfer?: Transferable[]) {
    globalThis.postMessage(message, { transfer });
}

const boot = async (initialState: InitialState) => {
    const rpc = new RPCController<WorkerEndpoints, PageEndpoints>({
        async readFile(path) {
            let view = await glasgowFS.readFile(path);
            return [view, [view.buffer]];
        },

        async createPath(path, type, fileContents, dryRun) {
            await glasgowFS.createPath(path, type, fileContents, dryRun);
            return [null, []];
        },

        async deletePath(path) {
            await glasgowFS.deletePath(path);
            return [null, []];
        },

        async duplicatePath(path, newPath, dryRun) {
            await glasgowFS.duplicatePath(path, newPath, dryRun);
            return [null, []];
        },

        async renamePath(path, newPath, dryRun) {
            await glasgowFS.renamePath(path, newPath, dryRun);
            return [null, []];
        },

        async mountNativeFS(fileSystemHandle: FileSystemDirectoryHandle) {
            await glasgowFS.mountNativeFS(fileSystemHandle);
            return [null, []];
        },

        async unmountNativeFS() {
            await glasgowFS.unmountNativeFS();
            return [null, []];
        },
    }, globalThis.postMessage.bind(globalThis));

    globalThis.addEventListener('message', (event: MessageEvent<PageToWorkerMessage>) => {
        let { data: message } = event;

        switch (message.type) {
            case 'rpc-request':
            case 'rpc-response': {
                rpc.onMessage(event);
                break;
            }
            case 'boot': {
                break; // ignore
            }
            case 'user-input': {
                terminal.appendUserInput(message.bytes);
                break;
            }
            case 'interrupt-request': {
                interrupt();
                break;
            }
            case 'terminal-presentation-change': {
                terminal.size = message.size;
                break;
            }
            default: message satisfies never;
        }
    });

    globalThis.setIsExecutingCommand = (value: boolean) => {
        send({
            type: 'execution-state-change',
            newState: value ? 'running' : 'idle',
        });
    };

    let interruptFuture: PyProxy | undefined;
    globalThis.setInterruptFuture = (future) => {
        interruptFuture = future;
    };

    Object.defineProperty(navigator.usb, 'requestDevice', {
        get: () => async (...args: Parameters<USB['requestDevice']>) => {
            const cloner = (value: unknown) => {
                if (value instanceof pyodide.ffi.PyProxy) {
                    return value.toJs({
                        create_pyproxies: false,
                        dict_converter: Object.fromEntries,
                    });
                }
            };

            const newArgs: Parameters<USB['requestDevice']> = cloneDeepWith(args, cloner);
            await rpc.send('requestUSBDevice', newArgs);

            // USBDevice is not transferrable ;_;

            let devices = await navigator.usb.getDevices();
            const [options] = newArgs;
            if (options?.filters?.length) {
                const { filters } = options;
                devices = devices.filter((device) => filters.some((filter) => {
                    return Object.keys(filter).every((_key) => {
                        let key = _key as (keyof USBDeviceFilter & keyof USBDevice);
                        return filter[key] === undefined || device[key] === filter[key];
                    });
                }));
            }
            if (!devices[0]) {
                throw new Error('Requested USB device not found (most likely programmer error)');
            }
            return devices[0];
        },
    });

    const terminal = new TerminalHandle({
        size: initialState.termSize,
        ptyAttrs: initialState.termPtyAttrs,
        onOutput(bytes) {
            let view = bytes.slice();
            send({ type: 'application-output', bytes: view }, [view.buffer]);
        },
        onPtyAttrsUpdate(attrs) {
            send({ type: 'terminal-state-change', attributes: attrs });
        },
    });

    const printText = (text: string, end: string = '\n') => {
        terminal.write(new TextEncoder().encode(text + end));
    };

    const printError = (text: string, end?: string) => {
        printText(`${termColors.bold(termColors.red('Error:'))} ${text}`, end);
    };

    const printProgress = (text: string, end?: string) => {
        printText(termColors.dim(text), end);
    };

    // Erase the screen
    printText('\x1b[2J\x1b[H', '');

    printText(termColors.bold('Glasgow Interface Explorer on the Web platform'));
    printText(termColors.yellowBright('Experimental software, use at your own risk.'));
    printText('All data is processed locally.');
    printText('Files in /root are persisted over reloads.');
    printText('');

    if (typeof WebAssembly !== "object") {
        return printError('WebAssembly is required but not available.');
    } else if (typeof WebAssembly.promising !== "function") {
        return printError('WebAssembly JSPI is required but not available.');
    } else if (typeof navigator.usb !== "object") {
        return printError('WebUSB is required but not available.');
    }

    printProgress('Loading toolchain...');
    await loadToolchain({
        loadProgress({ command, totalLength, doneLength }) {
            send({ type: 'tool-load-progress', command, totalLength, doneLength });
        },
    });

    printProgress('Loading Python...');
    const pyodide = await loadPyodide({
        env: {
            HOME: HOME_DIRECTORY,
            TERM: 'xterm-256color',
        },
    });

    // Use Object.assign() so that we can re-use the existing object
    // and update every currently open stream/TTY at once
    Object.assign(pyodide._module.TTY.stream_ops, getPyodideStreamApiForTerminal(pyodide, terminal));
    Object.assign(pyodide._module.TTY.default_tty_ops, getPyodideTtyApiForTerminal(pyodide, terminal));

    const glasgowFS = new GlasgowFileSystem({ pyodide });

    const interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    pyodide.setInterruptBuffer(interruptBuffer);
    send({ type: 'interrupt-buffer-update', buffer: interruptBuffer });

    const pyKeyboardInterrupt = pyodide.globals.get('KeyboardInterrupt');
    const interrupt = () => {
        if (interruptBuffer[0] === 0) {
            // Python has already caught SIGINT sent by the parent window via the buffer
            return;
        }
        if (interruptFuture !== undefined && !interruptFuture.done()) {
            interruptFuture.set_exception(pyKeyboardInterrupt());
        }
    };

    const conoutHandler = {
        write(buf: Uint8Array) {
            terminal.write(buf);
            return buf.length;
        },
        isatty: true,
    };
    pyodide.setStdout(conoutHandler);
    pyodide.setStderr(conoutHandler);

    pyodide.FS.closeStream(0);
    pyodide.FS.closeStream(1);
    pyodide.FS.closeStream(2);

    pyodide.FS.unlink('/dev/stdin');
    pyodide.FS.unlink('/dev/stdout');
    pyodide.FS.unlink('/dev/stderr');

    pyodide.FS.symlink('/dev/tty', '/dev/stdin');
    pyodide.FS.symlink('/dev/tty', '/dev/stdout');
    pyodide.FS.symlink('/dev/tty', '/dev/stderr');

    const stdinStream = pyodide.FS.open('/dev/stdin', 'r');
    if (stdinStream.fd !== 0) throw 'stdin fd not 0';
    const stdoutStream = pyodide.FS.open('/dev/stdout', 'w');
    if (stdoutStream.fd !== 1) throw 'stdout fd not 1';
    const stderrStream = pyodide.FS.open('/dev/stderr', 'w');
    if (stderrStream.fd !== 2) throw 'stderr fd not 2';

    globalThis.syncFSFromBacking = () => {
        return glasgowFS.syncFSFromBacking();
    };

    globalThis.syncFSToBacking = () => {
        return glasgowFS.syncFSToBacking();
    };

    const sendHomeFileTree = () => {
        send({ type: 'home-change', tree: glasgowFS.readFileTree(HOME_DIRECTORY) });
    };
    await glasgowFS.subscribeToUpdates(new RegExp(`^${RegExp.escape(HOME_DIRECTORY)}(?:\\/|$)`), () => {
        sendHomeFileTree();
    });

    Object.assign(globalThis, { pyodide });

    await glasgowFS.mountHome();
    sendHomeFileTree();

    printProgress('Loading Glasgow software...');

    printText('\x1b[2m', '');
    await pyodide.loadPackage(['micropip']);
    const micropip = pyodide.pyimport('micropip');
    await micropip.install(GLASGOW_WHEEL_URL);
    printText('\x1b[22m', '');
    printText('');

    send({ type: 'app-state-change', newState: 'booted' });

    // await pyodide.runPythonAsync(`
    //     #import site
    //     #site.enablerlcompleter()
    //     #site.register_readline()
    //     from _pyrepl.main import interactive_console
    //     interactive_console()
    // `);

    await pyodide.runPythonAsync(shell);
};

let waitingToBoot = true;
globalThis.addEventListener('message', async (event: MessageEvent<PageToWorkerMessage>) => {
    if (event.data.type === 'boot' && waitingToBoot) {
        waitingToBoot = false;
        try {
            await boot(event.data.initialState);
        } finally {
            send({ type: 'app-state-change', newState: 'dead' });
        }
    }
});
