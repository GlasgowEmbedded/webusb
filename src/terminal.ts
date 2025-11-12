import { Terminal as Xterm } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { FitAddon } from '@xterm/addon-fit';
import { openpty } from 'xterm-pty';

import terminalTheme from './terminal-theme';
import type { TerminalSize, Termios } from './types';

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
            theme: terminalTheme,
            drawBoldTextInBrightColors: false,

            // Read the desired font-family and font-size from CSS and apply it here.
            // We cannot override these properties on .xterm-rows in CSS
            // because xterm.js relies on these for calculating other metrics
            // like line-height.
            fontFamily: parentContainerStyles.fontFamily,
            fontSize: Number(parentContainerStyles.fontSize.replace(/px$/, '')),
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

    get size(): TerminalSize {
        let { cols, rows } = this.#xterm;
        return { cols, rows };
    }

    getPTYAttrs(): Termios {
        const termios = this.#ptyHandle.ioctl('TCGETS');
        return {
            iflag: termios.iflag,
            oflag: termios.oflag,
            cflag: termios.cflag,
            lflag: termios.lflag,
            cc: [...termios.cc],
        };
    }

    setPTYAttrs(attrs: Termios) {
        this.#ptyHandle.ioctl('TCSETS', attrs);
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

    onResize(handler: (newSize: TerminalSize) => void) {
        this.#xterm.onResize((newSize) => {
            handler(newSize);
        });
    }

    onInterrupt(handler: () => void) {
        this.#ptyHandle.onSignal((signal) => {
            if (signal === 'SIGINT') {
                handler();
            }
        });
    }

    onReadable(handler: (bytes: Uint8Array<ArrayBuffer>) => void) {
        this.#ptyHandle.onReadable(() => {
            handler(new Uint8Array(this.#ptyHandle.read()));
        });
    }
}
