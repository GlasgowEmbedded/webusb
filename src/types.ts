export interface InitialState {
    termSize: TerminalSize;
    termPtyAttrs: Termios;
}

export interface TerminalSize {
    cols: number;
    rows: number;
}

export interface Termios {
    iflag: number;
    oflag: number;
    cflag: number;
    lflag: number;
    cc: number[];
}

export interface TreeNode {
    name: string;
    children?: TreeNode[];
}

export interface FileTreeNode extends TreeNode {
    path: string;
}

export type Point2D = [number, number];
