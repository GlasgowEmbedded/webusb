import type { PyodideAPI } from './vendor/pyodide';
import type { Termios, TerminalSize } from './types';

export class TerminalHandle {
    size: TerminalSize;
    ptyAttrs: Termios;
    userInputBuffers: Uint8Array[] = [];
    userInputBufferLength = 0;
    readPromise = Promise.withResolvers<void>();

    onOutput: (bytes: Uint8Array) => void;
    onPtyAttrsUpdate: (attrs: Termios) => void;

    constructor(config: {
        size: TerminalSize;
        ptyAttrs: Termios;
        onOutput: (bytes: Uint8Array) => void;
        onPtyAttrsUpdate: (attrs: Termios) => void;
    }) {
        this.size = config.size;
        this.ptyAttrs = config.ptyAttrs;
        this.onOutput = config.onOutput;
        this.onPtyAttrsUpdate = config.onPtyAttrsUpdate;
    }

    get readable() {
        return this.readableByteCount > 0;
    }

    get readableByteCount() {
        return this.userInputBufferLength;
    }

    get writable() {
        // TODO: this does not respect flow control
        return true;
    }

    async waitUntilReadable(ms?: number) {
        if (this.readable) return;
        await Promise.race([
            this.readPromise.promise,
            ms ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : null,
        ].filter(Boolean));
    }

    appendUserInput(bytes: Uint8Array) {
        if (bytes.length === 0) return;
        this.userInputBuffers.push(bytes);
        this.userInputBufferLength += bytes.length;
        this.readPromise.resolve();
        this.readPromise = Promise.withResolvers();
    }

    async read(length: number) {
        if (this.userInputBuffers.length === 0) {
            await this.readPromise.promise;
        }

        let collected = [];
        let collectedLength = 0;
        while (collectedLength < length && this.userInputBuffers.length > 0) {
            collected.push(this.userInputBuffers[collected.length]);
            collectedLength += collected.at(-1)!.length;
        }
        this.userInputBuffers.splice(0, collected.length);
        this.userInputBufferLength -= collectedLength;

        let joined = new Uint8Array(collectedLength);
        for (let idx = 0, ptr = 0, len = collected.length; idx < len; idx++) {
            joined.set(collected[idx], ptr);
            ptr += collected[idx].length;
        }

        if (joined.length > length) {
            let diff = joined.length - length;
            this.userInputBuffers.unshift(new Uint8Array(
                joined.buffer,
                joined.byteLength - diff,
                diff,
            ));
            this.userInputBufferLength += diff;
            joined = new Uint8Array(joined.buffer, 0, length);
        }

        return joined;
    }

    write(bytes: Uint8Array) {
        this.onOutput(bytes);
    }

    getPtyAttrs() {
        return this.ptyAttrs;
    }

    setPtyAttrs(attrs: Termios) {
        this.ptyAttrs = attrs;
        this.onPtyAttrsUpdate(attrs);
    }
}

export function getPyodideStreamApiForTerminal(pyodide: PyodideAPI, terminal: TerminalHandle): PyodideAPI['_module']['TTY']['stream_ops'] {
    return {
        async readAsync(_stream, buffer, offset, length, _pos) {
            let readBytes = await terminal.read(length);
            buffer.set(readBytes, offset);
            return readBytes.length;
        },

        write(_stream, signedBuffer, offset, length) {
            let view = new Uint8Array(
                signedBuffer.buffer as ArrayBuffer,
                signedBuffer.byteOffset,
                signedBuffer.length,
            );
            terminal.write(view.subarray(offset, offset + length));
            return length;
        },

        async pollAsync(_stream, timeout) {
            if (!terminal.readable && timeout) {
                await terminal.waitUntilReadable(timeout);
            }
            let { readable, writable } = terminal;
            return (readable ? 1 /* POLLIN */ : 0) | (writable ? 4 /* POLLOUT */ : 0);
        },

        ioctl(_stream, request, varargs) {
            if (request === 0x541b /* FIONREAD */) {
                let result = terminal.readableByteCount;
                pyodide._module.HEAPU32[varargs / 4] = result;
                return 0;
            }
            throw new Error('Unimplemented ioctl request');
        },
    };
}

export function getPyodideTtyApiForTerminal(_pyodide: PyodideAPI, terminal: TerminalHandle): PyodideAPI['_module']['TTY']['default_tty_ops'] {
    return {
        ioctl_tcgets() {
            let attrs = terminal.getPtyAttrs();
            return {
                c_iflag: attrs.iflag,
                c_oflag: attrs.oflag,
                c_cflag: attrs.cflag,
                c_lflag: attrs.lflag,
                c_cc: attrs.cc,
            };
        },

        ioctl_tcsets(_tty, _optional_actions, data) {
            let attrs = {
                iflag: data.c_iflag,
                oflag: data.c_oflag,
                cflag: data.c_cflag,
                lflag: data.c_lflag,
                cc: data.c_cc,
            };
            terminal.setPtyAttrs(attrs);
            return 0;
        },

        ioctl_tiocgwinsz() {
            return [terminal.size.rows, terminal.size.cols];
        },

        get_char() { throw new Error('Unimplemented'); },
        put_char() { throw new Error('Unimplemented'); },
        fsync() {},
    };
}
