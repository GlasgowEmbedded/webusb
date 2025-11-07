import type { Tree } from '@yowasp/runtime';

import * as builderProto from './builder/proto';

export class Builder {
    #worker: Worker;
    #busy: boolean;
    #packages: Promise<{ [name: string]: string }>;

    constructor() {
        this.#worker = new Worker('builder.worker.js', { type: 'module' });
        this.#busy = true;
        this.#packages = new Promise((resolve, reject) => {
            this.#worker.onmessage = (event: MessageEvent<builderProto.BuilderToAppMessage>) => {
                const message = event.data;
                if (message.type === 'packages') {
                    this.#busy = false;
                    resolve(message.packages);
                } else if (message.type === 'error') {
                    reject(message.error);
                    this.#busy = false;
                } else {
                    throw new Error(`Unexpected message '${message.type}'`);
                }
            };
        });
    }

    packages(): Promise<{ [name: string]: string }> {
        return this.#packages;
    }

    build(
        files: Tree,
        scriptName: string,
        writeOutput: (bytes: Uint8Array) => void,
        loadProgress: (event: { command: string; totalLength: number; doneLength: number }) => void,
    ): Promise<{ code: number, files: Tree }> {
        if (this.#busy) {
            throw new Error("Builder is busy");
        }
        return new Promise((resolve, reject) => {
            this.#busy = true;
            this.#worker.onmessage = (event: MessageEvent<builderProto.BuilderToAppMessage>) => {
                const message = event.data;
                if (message.type === 'output') {
                    writeOutput(message.bytes);
                } else if (message.type === 'loadProgress') {
                    let { command, totalLength, doneLength } = message;
                    loadProgress({ command, totalLength, doneLength });
                } else if (message.type === 'result') {
                    resolve({ code: message.code, files: message.files });
                    this.#busy = false;
                } else if (message.type === 'error') {
                    reject(message.error);
                    this.#busy = false;
                } else {
                    throw new Error(`Unexpected message '${message.type}'`);
                }
            };
            this.#worker.postMessage({
                type: 'build', files, scriptName
            } as builderProto.AppToBuilderMessage);
        });
    }
}
