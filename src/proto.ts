import type { RPCRequestMessage, RPCResponseMessage, RPCResult } from './rpc';
import type { FileTreeNode, InitialState, Termios } from './types';

export interface PageEndpoints {
    requestUSBDevice(...args: Parameters<USB['requestDevice']>): Promise<RPCResult<null>>;
}

export interface WorkerEndpoints {
    readFile(path: string): Promise<RPCResult<Uint8Array<ArrayBuffer>>>;

    createPath(
        path: string,
        type: 'file' | 'folder',
        fileContents: Uint8Array<ArrayBuffer> | null,
        dryRun: boolean,
    ): Promise<RPCResult<null>>;

    deletePath(path: string): Promise<RPCResult<null>>;

    duplicatePath(path: string, newPath: string, dryRun: boolean): Promise<RPCResult<null>>;

    renamePath(path: string, newPath: string, dryRun: boolean): Promise<RPCResult<null>>;

    mountNativeFS(fileSystemHandle: FileSystemDirectoryHandle): Promise<RPCResult<null>>;

    unmountNativeFS(): Promise<RPCResult<null>>;
}

interface BootMessage {
    type: 'boot';
    initialState: InitialState;
}

interface AppStateChangeMessage {
    type: 'app-state-change';
    newState:
        | 'booting'
        | 'fs-mounted'
        | 'booted'
        | 'dead'
        ;
}

interface UserInputMessage {
    type: 'user-input';
    bytes: Uint8Array<ArrayBuffer>;
}

interface InterruptBufferUpdateMessage {
    type: 'interrupt-buffer-update';
    buffer: Uint8Array<SharedArrayBuffer>;
}

interface InterruptRequestMessage {
    type: 'interrupt-request';
}

interface ExecutionStateChangeMessage {
    type: 'execution-state-change';
    newState: 'running' | 'stopping' | 'idle';
}

interface ApplicationOutputMessage {
    type: 'application-output';
    bytes: Uint8Array<ArrayBuffer>;
}

interface TerminalPresentationChangeMessage {
    type: 'terminal-presentation-change';
    size: { cols: number; rows: number };
}

interface TerminalStateChangeMessage {
    type: 'terminal-state-change';
    attributes: Termios;
}

interface MountStateChangeMessage {
    type: 'mount-state-update';
    newState: 'mounted' | 'unmounted';
}

interface HomeChangeMessage {
    type: 'home-change';
    tree: FileTreeNode[];
}

export type PageToWorkerMessage =
    | RPCRequestMessage
    | RPCResponseMessage
    | BootMessage
    | UserInputMessage
    | InterruptRequestMessage
    | TerminalPresentationChangeMessage
    ;

export type WorkerToPageMessage =
    | RPCRequestMessage
    | RPCResponseMessage
    | AppStateChangeMessage
    | InterruptBufferUpdateMessage
    | ExecutionStateChangeMessage
    | ApplicationOutputMessage
    | TerminalStateChangeMessage
    | MountStateChangeMessage
    | HomeChangeMessage
    ;
