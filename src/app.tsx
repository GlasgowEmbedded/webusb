import { createEffect, createSignal, onMount, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { render } from 'solid-js/web';
import debounce from 'lodash/debounce';
import termColors from './vendor/terminal-colors';

import type { PageEndpoints, PageToWorkerMessage, WorkerEndpoints, WorkerToPageMessage } from './proto';
import type { FileTreeNode } from './types';

import { RPCController } from './rpc';
import { Terminal } from './terminal';

import { PopoverContainer } from './components/popover-container';
import { ProgressPopover } from './components/progress-popover';
import { PanelContainer } from './components/panel';
import { TreeView } from './components/tree-view';

import { onlyTruthy } from './helpers/comparison';
import { joinPath } from './helpers/path';

import { HOME_DIRECTORY } from './config';

import './app.css';

declare global {
    var IS_PRODUCTION: boolean;
    var GIT_COMMIT: string;
}

const App = () => {
    const [isInitializing, setIsInitializing] = createSignal(true);
    const [fileTree, setFileTree] = createStore<{ tree: FileTreeNode[] | null }>({ tree: null });

    function updateFileTree(newTree: FileTreeNode[]) {
        setFileTree('tree', reconcile(newTree, { key: 'name' }));
    }

    const [isNativeFSMounted, setIsNativeFSMounted] = createSignal(false);
    const [isNativeFSMountBusy, setIsNativeFSMountBusy] = createSignal(false);
    const [isNativeFSMountAvailable, setIsNativeFSMountAvailable] = createSignal(false);

    const handleMountNativeFSClick = async () => {
        setIsNativeFSMountBusy(true);

        if (isNativeFSMounted()) {
            await rpc.send('unmountNativeFS', []);

            setIsNativeFSMounted(false);
            setIsNativeFSMountBusy(false);
            return;
        }

        try {
            if (!confirm("The changes in the directory you pick will be reflected within /mnt and vice versa. Bugs may cause DATA CORRUPTION. Consider picking a new directory just for this application."))
                throw new Error("declined");

            const fileSystemHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            await rpc.send('mountNativeFS', [fileSystemHandle], []);
            setIsNativeFSMounted(true);
        } finally {
            setIsNativeFSMountBusy(false);
        }
    };

    const [isCurrentlyExecutingCommand, setIsCurrentlyExecutingCommand] = createSignal(false);
    const [isInterruptExecutionButtonEnabled, setIsInterruptExecutionButtonEnabled] = createSignal(false);
    const activateInterruptExecutionButton = debounce(() => {
        setIsInterruptExecutionButtonEnabled(true);
    }, 100);

    createEffect(() => {
        if (isCurrentlyExecutingCommand()) {
            activateInterruptExecutionButton();
        } else {
            activateInterruptExecutionButton.cancel();
            setIsInterruptExecutionButtonEnabled(false);
        }
    });

    const handleInterruptExecutionClick = () => {
        printText(termColors.reset('^C'), '');
        interrupt();
    };

    const [currentlyLoadingTool, setCurrentlyLoadingTool] = createSignal<
        { command: string; totalLength: number; doneLength: number } | null
    >(null);

    let hideToolLoadProgressTimeout = 0;

    createEffect(() => {
        let info;
        if (info = currentlyLoadingTool()) {
            clearTimeout(hideToolLoadProgressTimeout);
            const timeout = info.doneLength === info.totalLength ? 2000 : 10000;
            hideToolLoadProgressTimeout = setTimeout(() => setCurrentlyLoadingTool(null), timeout);
        }
    });

    let [creatingNewFileNode, setCreatingNewFileNode] = createSignal<
        Parameters<typeof TreeView<FileTreeNode>>[0]['creatingNewNode']
    >(null);

    const handleFileTreeNodeAction = async (node: FileTreeNode) => {
        let fileContents = await rpc.send('readFile', [node.path]);
        let url = URL.createObjectURL(new Blob([fileContents]));
        let element = document.createElement('a');
        element.href = url;
        element.download = node.name;
        element.click();
        URL.revokeObjectURL(url);
    };

    const createNewFile = (node: FileTreeNode | null) => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.addEventListener('change', () => {
            if (!fileInput.files || fileInput.files.length < 1) {
                return;
            }
            let file = fileInput.files[0];
            let fileReader = new FileReader();
            fileReader.addEventListener('loadend', () => {
                const fileContents = new Uint8Array(fileReader.result as ArrayBuffer);

                setCreatingNewFileNode({
                    type: 'file',
                    underNode: node,
                    defaultName: file.name,
                    async execute({ node, parents, name, dryRun }) {
                        await rpc.send('createPath', [joinPath(HOME_DIRECTORY, ...parents, node, name), 'file', fileContents, dryRun]);
                    },
                });
            });
            fileReader.readAsArrayBuffer(file);
        });
        fileInput.click();
    };

    const createNewFolder = (node: FileTreeNode | null) => {
        setCreatingNewFileNode({
            type: 'folder',
            underNode: node,
            async execute({ node, parents, name, dryRun }) {
                await rpc.send('createPath', [joinPath(HOME_DIRECTORY, ...parents, node, name), 'folder', null, dryRun]);
            },
        });
    };

    const handleFileDeletion = async (node: FileTreeNode, parents: FileTreeNode[]) => {
        if (!confirm(`Are you sure you want to delete ${node.children ? 'folder' : 'file'} "${node.name}"? This operation is irreversible.`)) {
            return;
        }

        await rpc.send('deletePath', [joinPath(HOME_DIRECTORY, ...parents, node)]);
    };

    const handleFileDuplicate = async (node: FileTreeNode, parents: FileTreeNode[]) => {
        setCreatingNewFileNode({
            type: node.children ? 'folder' : 'file',
            underNode: parents.at(-1) ?? null,
            defaultName: node.name,
            async execute({ name, dryRun }) {
                await rpc.send('duplicatePath', [node.path, joinPath(HOME_DIRECTORY, ...parents, name), dryRun]);
            },
        });
    };

    const handleFileRename = async (node: FileTreeNode, parents: FileTreeNode[], newName: string, dryRun: boolean) => {
        if (['', '.', '..'].includes(newName)) {
            throw 'The file name must not be . or ..';
        }

        const path = joinPath(HOME_DIRECTORY, ...parents, node);
        const newPath = joinPath(HOME_DIRECTORY, ...parents, newName);

        await rpc.send('renamePath', [path, newPath, dryRun]);
    };

    const fileTreeActions: Parameters<typeof TreeView<FileTreeNode>>[0]['actions'] = [
        {
            name: 'New File...',
            iconName: 'new-file',
            applicable: (node) => !node || !!node.children,
            execute: (node, _parents) => {
                createNewFile(node);
            },
        },
        {
            name: 'New Folder...',
            iconName: 'new-file',
            applicable: (node) => !node || !!node.children,
            execute: (node, _parents) => {
                createNewFolder(node);
            },
        },
        {
            name: 'Download',
            iconName: 'save',
            applicable: (node) => !!node && !node.children,
            execute: (node) => handleFileTreeNodeAction(node!),
            showInline: true,
        },
        {
            name: 'Duplicate...',
            applicable: (node) => !!node,
            execute: (node, parents) => handleFileDuplicate(node!, parents),
        },
        {
            name: 'Rename...',
            applicable: (node) => !!node,
            execute: (node, parents, nodeAPI) => {
                nodeAPI!.rename({
                    async execute({ newName, dryRun }) {
                        await handleFileRename(node!, parents, newName, dryRun);
                    },
                });
            },
        },
        {
            name: 'Delete',
            applicable: (node) => !!node,
            execute: (node, parents) => handleFileDeletion(node!, parents),
        },
    ];

    let worker = new Worker('app.worker.js', { type: 'module' });

    function send<M extends PageToWorkerMessage>(message: M, transfer?: Transferable[]) {
        worker.postMessage(message, { transfer });
    }

    worker.addEventListener('message', (event: MessageEvent<WorkerToPageMessage>) => {
        let { data: message } = event;

        switch (message.type) {
            case 'rpc-request':
            case 'rpc-response': {
                rpc.onMessage(event);
                break;
            }
            case 'app-state-change': {
                switch (message.newState) {
                    case 'booting':
                        setIsInitializing(true);
                        setIsNativeFSMountAvailable(false);
                        break;
                    case 'fs-mounted':
                        setIsInitializing(true);
                        setIsNativeFSMountAvailable(true);
                        break;
                    case 'booted':
                        setIsInitializing(false);
                        setIsNativeFSMountAvailable(true);
                        break;
                    case 'dead':
                        setIsInitializing(false);
                        setIsNativeFSMountAvailable(false);
                        printText(termColors.reset('') + termColors.dim('\nThe application has exited.'));
                        xterm.endSession();
                        break;
                    default: message satisfies never;
                }
                break;
            }
            case 'interrupt-buffer-update': {
                interruptBuffer = message.buffer;
                break;
            }
            case 'execution-state-change': {
                setIsCurrentlyExecutingCommand(message.newState === 'running');
                break;
            }
            case 'application-output': {
                xterm.write(message.bytes);
                break;
            }
            case 'terminal-state-change': {
                xterm.setPTYAttrs(message.attributes);
                break;
            }
            case 'mount-state-update': {
                setIsNativeFSMounted(message.newState === 'mounted');
                break;
            }
            case 'home-change': {
                updateFileTree(message.tree);
                break;
            }
            case 'tool-load-progress': {
                let { command, totalLength, doneLength } = message;
                setCurrentlyLoadingTool({ command, totalLength, doneLength });
                break;
            }
            default: message satisfies never;
        }
    });

    const rpc = new RPCController<PageEndpoints, WorkerEndpoints>({
        async requestUSBDevice(...params) {
            await navigator.usb.requestDevice(...params);
            return [null, []];
        },
    }, worker.postMessage.bind(worker));

    let xterm: Terminal;
    let xtermContainer: HTMLDivElement;

    const printText = (text: string, end = '\n') => {
        xterm.write(new TextEncoder().encode(text + end));
    };

    let interruptBuffer: Uint8Array<SharedArrayBuffer> | undefined;
    const interrupt = () => {
        // raise SIGINT signal within Python interpreter on next PyErr_CheckSignals() call;
        // this will interrupt long running computations (but not async I/O or stdin reads)
        if (interruptBuffer) interruptBuffer[0] = 2;

        // raise `KeyboardInterrupt` exception within Python webloop on next iteration;
        // this will interrupt async I/O (but not stdin reads or long running computations).
        send({ type: 'interrupt-request' });
    };

    onMount(() => {
        xterm = new Terminal(xtermContainer);
        xterm.focus();

        xterm.onResize((newSize) => {
            send({ type: 'terminal-presentation-change', size: newSize });
        });
        xterm.onReadable((bytes) => {
            send({ type: 'user-input', bytes: bytes }, [bytes.buffer]);
        });
        xterm.onInterrupt(interrupt);

        printText(termColors.dim('Starting the worker...'));

        send({
            type: 'boot',
            initialState: {
                termSize: xterm.size,
                termPtyAttrs: xterm.getPTYAttrs(),
            },
        });
    });

    return (
        <div class="main">
            <PanelContainer
                panels={[
                    {
                        name: 'Terminal',
                        iconName: 'terminal',
                        className: 'terminal-panel',
                        get actions() {
                            return onlyTruthy([
                                'showDirectoryPicker' in window && {
                                    get name() {
                                        return isNativeFSMounted() ? 'Unmount /mnt' : 'Mount /mnt';
                                    },
                                    get disabled() {
                                        return !isNativeFSMountAvailable() || isNativeFSMountBusy();
                                    },
                                    handleAction: handleMountNativeFSClick,
                                },
                                {
                                    name: 'Stop',
                                    iconName: 'stop-circle',
                                    iconOnly: true,
                                    get disabled() {
                                        return !isInterruptExecutionButtonEnabled();
                                    },
                                    handleAction: handleInterruptExecutionClick,
                                },
                            ]);
                        },
                        get children() {
                            return <div class="panel-content">
                                <div ref={el => xtermContainer = el} id="terminal" />
                                <PopoverContainer>
                                    <Show when={currentlyLoadingTool()}>
                                        {(info) => {
                                            const fmt = (n: number) => (n / 1048576).toFixed(1);
                                            const done = () => info().doneLength === info().totalLength;
                                            return <ProgressPopover
                                                label={!done() ? `Loading ${info().command}...` : `Loaded ${info().command}`}
                                                progressText={(!done() ? `${fmt(info().doneLength)} / ` : '') +
                                                    `${fmt(info().totalLength)} MiB`}
                                                progressValue={info().doneLength / info().totalLength}
                                                done={done()}
                                            />;
                                        }}
                                    </Show>
                                </PopoverContainer>
                            </div>;
                        },
                    },

                    {
                        name: '/root',
                        iconName: 'folder-opened',
                        className: 'file-tree-panel',
                        get actions() {
                            return [
                                {
                                    name: 'Upload file',
                                    iconName: 'new-file',
                                    iconOnly: true,
                                    disabled: fileTree.tree === null,
                                    handleAction() {
                                        createNewFile(null);
                                    },
                                },
                                {
                                    name: 'Create folder',
                                    iconName: 'new-folder',
                                    iconOnly: true,
                                    disabled: fileTree.tree === null,
                                    handleAction() {
                                        createNewFolder(null);
                                    },
                                },
                            ];
                        },
                        get children() {
                            return (
                                <div class="panel-content tree">
                                    {fileTree.tree
                                        ? (
                                            <TreeView
                                                nodes={fileTree.tree}
                                                creatingNewNode={creatingNewFileNode()}
                                                onCancelNodeCreation={() => setCreatingNewFileNode(null)}
                                                emptyTreeMessage="Directory is empty"
                                                actions={fileTreeActions}
                                            />
                                        )
                                        : <i>{isInitializing() ? 'Waiting...' : 'Unavailable'}</i>
                                    }
                                </div>
                            );
                        },
                    },
                ]}
            />
        </div>
    );
};

console.log(`[App] Built from git commit ${globalThis.GIT_COMMIT}`);

render(() => <App />, document.querySelector('#app')!);

// https://esbuild.github.io/api/#live-reload
if (!globalThis.IS_PRODUCTION)
    new EventSource('/esbuild').addEventListener('change', () => location.reload());
