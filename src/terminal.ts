import { Terminal as Xterm } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { FitAddon } from '@xterm/addon-fit';
import { openpty } from 'xterm-pty';

export class Terminal {
    #element: HTMLElement;

    #xterm: Xterm;
    #ptyAddon: ReturnType<typeof openpty>['master'];
    #ptyHandle: ReturnType<typeof openpty>['slave'];

    constructor(element: HTMLElement) {
        this.#element = element;

        let parentContainerStyles = getComputedStyle(element);

        if (!/^[\d.]+px$/.test(parentContainerStyles.fontSize)) {
            throw new Error(`Unexpected font-size value`);
        }

        const xterm = new Xterm({
            scrollback: 10000,
            screenReaderMode: true,

            // Read the desired font-family and font-size from CSS and apply it here.
            // We cannot override these properties on .xterm-rows in CSS
            // because xterm.js relies on these for calculating other metrics
            // like line-height.
            fontFamily: parentContainerStyles.fontFamily,
            fontSize: Number(parentContainerStyles.fontSize.replace(/px$/, '')),

            theme: {
                black:   '#7a828e',
                red:     '#ff9492',
                green:   '#26cd4d',
                yellow:  '#f0b72f',
                blue:    '#71b7ff',
                magenta: '#cb9eff',
                cyan:    '#39c5cf',
                white:   '#d9dee3',

                brightBlack:   '#9ea7b3',
                brightRed:     '#ffb1af',
                brightGreen:   '#4ae168',
                brightYellow:  '#f7c843',
                brightBlue:    '#91cbff',
                brightMagenta: '#dbb7ff',
                brightCyan:    '#56d4dd',
                brightWhite:   '#ffffff',

                background: '#0a0c10',
                foreground: '#f0f3f6',

                cursor:       '#71b7ff',
                cursorAccent: '#71b7ff',

                selectionBackground: '#f0f3f6',
                selectionForeground: '#0a0c10',
            },
        });
        xterm.open(element);
        this.#xterm = xterm;

        xterm.loadAddon(new WebLinksAddon());

        const fitAddon = new FitAddon();
        xterm.loadAddon(fitAddon);

        // This will also call fitAddon.fit() before the browser renders the page,
        // saving us the need to call it ourselves for the first time.
        // It is important that this occurs after we load the pty addon.
        const resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(element);

        const { master: ptyAddon, slave: ptyHandle } = openpty();
        xterm.loadAddon(ptyAddon);
        this.#ptyAddon = ptyAddon;
        this.#ptyHandle = ptyHandle;
    }

    get columns() {
        return this.#xterm.cols;
    }

    get rows() {
        return this.#xterm.rows;
    }

    getPTYAttrs() {
        const termios = this.#ptyHandle.ioctl('TCGETS');
        return {
            c_iflag: termios.iflag,
            c_oflag: termios.oflag,
            c_cflag: termios.cflag,
            c_lflag: termios.lflag,
            c_cc: [...termios.cc],
        };
    }

    setPTYAttrs(attrs: {
        c_iflag: number;
        c_oflag: number;
        c_cflag: number;
        c_lflag: number;
        c_cc: number[];
    }) {
        this.#ptyHandle.ioctl('TCSETS', {
            iflag: attrs.c_iflag,
            oflag: attrs.c_oflag,
            cflag: attrs.c_cflag,
            lflag: attrs.c_lflag,
            cc: attrs.c_cc,
        });
    }

    focus() {
        this.#xterm.focus();
    }

    endSession() {
        this.#ptyAddon.dispose();
        this.#element.classList.add('session-ended');
    }

    write(bytes: Uint8Array) {
        this.#ptyHandle.write(Array.from(bytes));
    }

    async read(length?: number) {
        let result = this.#ptyHandle.read(length);
        if (result.length === 0 && length && length > 0) {
            await this.waitUntilReadable();
            result = this.#ptyHandle.read(length);
        }
        return new Uint8Array(result);
    }

    async waitUntilReadable(ms?: number) {
        await Promise.race([
            new Promise<void>((resolve) => this.#ptyHandle.onReadable(resolve)),
            ms ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : null,
        ].filter(Boolean));
    }

    get readable() {
        return this.#ptyHandle.readable;
    }

    get readableByteCount() {
        return (this.#ptyHandle as any).fromLdiscToUpperBuffer.length as number;
    }

    get writable() {
        return this.#ptyHandle.writable;
    }

    onInterrupt(handler: () => void) {
        this.#ptyHandle.onSignal((signal) => {
            if (signal === 'SIGINT') {
                handler();
            }
        });
    }
}
