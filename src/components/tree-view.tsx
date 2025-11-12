import { createComputed, createContext, createEffect, createMemo, createSignal, For, Show, useContext } from 'solid-js';

import type { Point2D, TreeNode } from '../types';

import { ContextMenu } from './context-menu';
import { Icon } from './icon';
import { IconMore } from './icon-more';

import { cls } from '../helpers/class-names';
import { modulo } from '../helpers/modulo';

interface TreeNodeAction<N extends TreeNode> {
    name: string;
    iconName?: string;
    applicable: (node: N | null, parents: N[]) => boolean;
    execute: (node: N | null, parents: N[], nodeAPI: TreeNodeAPI | null) => void;
    showInline?: boolean;
}

interface TreeNodeAPI {
    rename(options: {
        execute(options: { newName: string; dryRun: boolean; }): Promise<void>;
    }): void;
}

interface TreeRootContextValue {
    rootNodes: TreeNode[];
    nodeElements: Map<TreeNode, HTMLElement>;
    currentlyFocusableNode: TreeNode | null;
    creatingNewNode: TreeViewProps<any>['creatingNewNode'];
    cancelNodeCreation: () => void;
    actions: TreeNodeAction<TreeNode>[];
    focus(node: TreeNode | null): void;
}

const TreeRootContext = createContext<TreeRootContextValue | null>(null);

interface TreeNodeCreationProps {
    creatingType: 'file' | 'folder';
    parents: TreeNode[];
}

const TreeNodeCreationForm = (props: TreeNodeCreationProps) => {
    const treeRootContext = useContext(TreeRootContext);
    if (treeRootContext === null) {
        throw new Error('TreeRootContext must be provided');
    }

    const execute = async (form: HTMLFormElement, dryRun: boolean) => {
        const nameInput = form.elements.namedItem('name') as HTMLInputElement;
        const name = nameInput.value.trim();
        if (name === '') {
            nameInput.setCustomValidity('');
            return;
        }
        try {
            await treeRootContext.creatingNewNode!.execute({
                node: props.parents.at(-1) ?? null,
                parents: props.parents.slice(0, -1),
                name: name,
                dryRun: dryRun,
            });
            nameInput.setCustomValidity('');
            if (dryRun)
                return;
            treeRootContext.cancelNodeCreation();
        } catch (e) {
            nameInput.setCustomValidity(String(e));
        }
    };

    const cancel = () => {
        treeRootContext.cancelNodeCreation();
    };

    const handleBlur = (_event: FocusEvent) => {
        cancel();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            cancel();
        }
    };

    const handleInput = (event: InputEvent) => {
        const form = (event.target as HTMLInputElement).form!;
        execute(form, true);
    };

    const handleSubmit = (event: SubmitEvent) => {
        event.preventDefault();
        execute(event.target as HTMLFormElement, false);
    };

    return (
        <form class="tree-list-item" onSubmit={handleSubmit}>
            <div class="tree-node-line" style={{ '--level': props.parents.length }}>
                {props.creatingType === 'folder' ? (
                    <Icon class="tree-node-chevron" name="chevron-right" />
                ) : null}
                <Icon class="tree-node-icon" name={props.creatingType === 'folder' ? 'folder' : 'file'} aria-hidden />
                <input
                    ref={el => requestAnimationFrame(() => {
                        if (el) {
                            el.focus();
                            el.setSelectionRange(0, modulo(el.value.lastIndexOf('.'), el.value.length + 1));
                        }
                    })}
                    class="tree-node-name"
                    type="text"
                    name="name"
                    value={treeRootContext.creatingNewNode!.defaultName ?? ''}
                    autocomplete="off"
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    onInput={handleInput}
                />
            </div>
        </form>
    );
};

interface TreeListProps {
    nodes: TreeNode[];
    parents: TreeNode[];
    ref?: (el: HTMLElement) => void;
}

const TreeList = (props: TreeListProps) => {
    const treeRootContext = useContext(TreeRootContext);
    if (treeRootContext === null) {
        throw new Error('TreeRootContext must be provided');
    }

    const isRoot = () => props.parents.length === 0;

    let ulRef: HTMLUListElement | undefined;
    const [contextMenuOpenAtPosition, setContextMenuOpenAtPosition] = createSignal<Point2D | null>(null);

    const nodesIncludingNew = createMemo<(TreeNode | { creatingType: 'file' | 'folder' })[]>(() => {
        const creatingNewNode = treeRootContext.creatingNewNode;
        if (creatingNewNode === null) {
            return props.nodes;
        }
        if (creatingNewNode.underNode !== (props.parents.at(-1) ?? null)) {
            return props.nodes;
        }
        if (creatingNewNode.type === 'folder') {
            return [{ creatingType: 'folder' }, ...props.nodes];
        }
        let firstFileIndex = props.nodes.findIndex(node => !node.children);
        let folders = firstFileIndex !== -1 ? props.nodes.slice(0, firstFileIndex) : props.nodes;
        let files = props.nodes.slice(folders.length);
        return [...folders, { creatingType: 'file' }, ...files];
    });

    const handleFocus = (event: FocusEvent) => {
        if (isRoot()) {
            treeRootContext.currentlyFocusableNode = null;
        }
    };

    const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        setContextMenuOpenAtPosition([event.clientX, event.clientY]);
    };

    const handleContextMenuCancel = () => {
        ulRef?.focus();
        setContextMenuOpenAtPosition(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            let direction = event.key === 'ArrowDown' ? 1 : -1;
            let currentIndex = -1;
            if (treeRootContext.currentlyFocusableNode) {
                currentIndex = props.nodes.indexOf(treeRootContext.currentlyFocusableNode);
            }
            let newIndex = currentIndex + direction;
            if (currentIndex === -1) {
                newIndex = direction === 1 ? 0 : -1;
            }
            if (currentIndex !== -1 && newIndex < 0) {
                if (props.parents.length > 0) {
                    treeRootContext.focus(props.parents.at(-1)!);
                    event.stopPropagation();
                }
            } else if (currentIndex !== -1 && newIndex >= props.nodes.length) {
                if (props.parents.length > 0) {
                    let parentParentChildren = props.parents.at(-2)?.children ?? treeRootContext.rootNodes;
                    let parentIndex = parentParentChildren.indexOf(props.parents.at(-1)!);
                    if (parentIndex + 1 < parentParentChildren.length) {
                        treeRootContext.focus(parentParentChildren[parentIndex + 1]);
                        event.stopPropagation();
                    }
                }
            } else {
                newIndex = modulo(newIndex, props.nodes.length);
                let node = props.nodes[newIndex];
                if (direction === -1) {
                    while (node.children && node.children.length > 0 && treeRootContext.nodeElements.has(node.children.at(-1)!)) {
                        node = node.children.at(-1)!;
                    }
                }
                treeRootContext.focus(node);
                event.stopPropagation();
            }
        } else if (isRoot() && event.key === 'ArrowRight') {
            if (props.nodes.length > 0 && treeRootContext.currentlyFocusableNode === null) {
                treeRootContext.focus(props.nodes[0]);
            }
        }
    };

    return (
        <>
            <ul
                ref={el => { ulRef = el; props.ref?.(el); }}
                class="tree-list"
                role={isRoot() ? 'tree' : 'group'}
                tabIndex={(() => {
                    if (isRoot()) return treeRootContext.currentlyFocusableNode === null ? 0 : -1;
                    return undefined;
                })()}
                onFocus={handleFocus}
                onContextMenu={handleContextMenu}
                onKeyDown={handleKeyDown}
            >
                <For each={nodesIncludingNew()}>
                    {(node) => (
                        'creatingType' in node
                            ? (
                                <TreeNodeCreationForm
                                    creatingType={node.creatingType}
                                    parents={props.parents}
                                />
                            )
                            : <TreeNodeView node={node} parents={props.parents} />
                    )}
                </For>
            </ul>
            <Show when={contextMenuOpenAtPosition() !== null}>
                <ContextMenu
                    anchor={contextMenuOpenAtPosition()!}
                    items={treeRootContext.actions
                        .filter((action) => action.applicable(props.parents.at(-1) ?? null, props.parents.slice(0, -1)))
                        .map((action) => ({
                            name: action.name,
                            action: () => action.execute(props.parents.at(-1) ?? null, props.parents.slice(0, -1), null),
                        }))}
                    onCancel={handleContextMenuCancel}
                />
            </Show>
        </>
    );
};

interface TreeNodeViewProps {
    node: TreeNode;
    parents: TreeNode[];
}

const TreeNodeView = (props: TreeNodeViewProps) => {
    const treeRootContext = useContext(TreeRootContext);
    if (treeRootContext === null) {
        throw new Error('TreeRootContext must be provided');
    }

    let ref: HTMLElement | undefined;
    const [isOpened, setIsOpened] = createSignal(false);
    const [wasLastFocused, setWasLastFocused] = createSignal(false);
    const [contextMenuOpenAtPosition, setContextMenuOpenAtPosition] = createSignal<Point2D | null>(null);
    const [currentlyRenaming, setCurrentlyRenaming] = createSignal<Parameters<TreeNodeAPI['rename']>[0] | null>(null);

    createEffect(() => {
        if (treeRootContext.creatingNewNode?.underNode === props.node) {
            setIsOpened(true);
        }
    });

    const handleFocus = (event: FocusEvent) => {
        treeRootContext.currentlyFocusableNode = props.node;
    };

    const handleClick = (event: MouseEvent) => {
        event.stopPropagation();

        if (props.node.children) {
            setIsOpened(!isOpened());
        }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' && props.node.children && props.node.children.length > 0 && isOpened()) {
            treeRootContext.focus(props.node.children[0]);
            event.stopPropagation();
        } else if (event.key === 'ArrowRight' && props.node.children && event.target === ref) {
            if (isOpened()) {
                if (props.node.children.length > 0) {
                    treeRootContext.focus(props.node.children[0]);
                    event.stopPropagation();
                }
            } else {
                setIsOpened(true);
                event.stopPropagation();
            }
        } else if (event.key === 'ArrowLeft') {
            if (!props.node.children || !isOpened()) {
                treeRootContext.focus(props.parents.at(-1) ?? null);
                event.stopPropagation();
            } else {
                setIsOpened(false);
                event.stopPropagation();
            }
        }
    };

    const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setWasLastFocused(true);
        setContextMenuOpenAtPosition([event.clientX, event.clientY]);
    };

    const handleContextMenuCancel = () => {
        ref?.focus();
        setWasLastFocused(false);
        setContextMenuOpenAtPosition(null);
    };

    const saveNewName = async (input: HTMLInputElement, dryRun: boolean) => {
        const newName = input.value.trim();
        if (newName === '') {
            input.setCustomValidity('');
            return;
        }
        try {
            await currentlyRenaming()!.execute({
                newName: newName,
                dryRun: dryRun,
            });
            input.setCustomValidity('');
            if (dryRun)
                return;
            setCurrentlyRenaming(null);
        } catch (e) {
            input.setCustomValidity(String(e));
            input.reportValidity();
        }
    };

    const handleInputBlur = (event: FocusEvent) => {
        saveNewName(event.target as HTMLInputElement, false);
    };

    const handleInputKeyDown = (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            saveNewName(event.target as HTMLInputElement, false);
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            setCurrentlyRenaming(null);
        }
    };

    const handleInputInput = (event: InputEvent) => {
        saveNewName(event.target as HTMLInputElement, true);
    };

    const treeNodeAPI: TreeNodeAPI = {
        rename(options) {
            setCurrentlyRenaming(options);
        },
    };

    const inlineActions = [];
    const hiddenActions = [];
    for (const action of treeRootContext.actions) {
        if (!action.applicable(props.node, props.parents)) {
            continue;
        }
        if (action.showInline && action.iconName) {
            inlineActions.push(action);
        } else {
            hiddenActions.push(action);
        }
    }

    return (
        <li
            ref={(element) => {
                ref = element;
                element ? treeRootContext.nodeElements.set(props.node, element) : treeRootContext.nodeElements.delete(props.node);
            }}
            role="treeitem"
            class={cls('tree-list-item', wasLastFocused() && 'last-focused')}
            aria-expanded={props.node.children ? isOpened() : undefined}
            tabIndex={props.node === treeRootContext.currentlyFocusableNode ? 0 : -1}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
        >
            <div
                class="tree-node-line"
                style={{ '--level': props.parents.length }}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
            >
                {props.node.children ? (
                    <Icon class="tree-node-chevron" name={isOpened() ? 'chevron-down' : 'chevron-right'} />
                ) : null}
                <Icon class="tree-node-icon" name={props.node.children ? isOpened() ? 'folder-opened' : 'folder' : 'file'} aria-hidden />
                <Show when={currentlyRenaming()}>
                    <input
                        ref={el => requestAnimationFrame(() => {
                            if (el) {
                                el.focus();
                                el.setSelectionRange(0, modulo(el.value.lastIndexOf('.'), el.value.length + 1));
                            }
                        })}
                        class="tree-node-name"
                        type="text"
                        value={props.node.name}
                        autocomplete="off"
                        onBlur={handleInputBlur}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={handleInputKeyDown}
                        onInput={handleInputInput}
                    />
                </Show>
                <Show when={!currentlyRenaming()}>
                    <span class="tree-node-name">{props.node.name}</span>
                </Show>
                <div class="tree-node-actions">
                    {inlineActions.map((action) => (
                        <button
                            type="button"
                            class="button"
                            onClick={() => action.execute(props.node, props.parents, treeNodeAPI)}
                        >
                            <Icon class="aligned-icon" name={action.iconName!} />
                            <span class="visually-hidden">{action.name}</span>
                        </button>
                    ))}
                    {hiddenActions.length ? (
                        <button
                            type="button"
                            class="button"
                            onClick={handleContextMenu}
                        >
                            <IconMore class="aligned-icon" />
                            <span class="visually-hidden">More</span>
                        </button>
                    ) : null}
                </div>
            </div>
            <Show when={props.node.children && isOpened()}>
                <TreeList
                    nodes={props.node.children!}
                    parents={[...props.parents, props.node]}
                />
            </Show>
            <Show when={contextMenuOpenAtPosition() !== null}>
                <ContextMenu
                    anchor={contextMenuOpenAtPosition()!}
                    items={treeRootContext.actions
                        .filter((action) => action.applicable(props.node, props.parents))
                        .map((action) => ({
                            name: action.name,
                            action: () => action.execute(props.node, props.parents, treeNodeAPI),
                        }))}
                    onCancel={handleContextMenuCancel}
                />
            </Show>
        </li>
    );
};

interface TreeViewProps<N extends TreeNode> {
    nodes: N[];
    creatingNewNode: null | {
        type: 'file' | 'folder';
        underNode: TreeNode | null;
        defaultName?: string;
        execute(options: { node: N | null; parents: N[]; name: string; dryRun: boolean; }): Promise<void>;
    };
    emptyTreeMessage?: string;
    actions: TreeNodeAction<N>[];
    onCancelNodeCreation: () => void;
}

export const TreeView = <N extends TreeNode>(props: TreeViewProps<N>) => {
    let rootListRef: HTMLElement | undefined;
    const nodeElements = new Map<TreeNode, HTMLElement>();
    const [currentlyFocusableNode, setCurrentlyFocusableNode] = createSignal<TreeNode | null>(null);

    createComputed(() => {
        props.nodes;
        setCurrentlyFocusableNode(null);
    });

    const treeRootContextValue = {
        get rootNodes() {
            return props.nodes;
        },
        get currentlyFocusableNode() {
            return currentlyFocusableNode();
        },
        set currentlyFocusableNode(value) {
            setCurrentlyFocusableNode(value);
        },
        nodeElements: nodeElements,
        get creatingNewNode() {
            return props.creatingNewNode;
        },
        get cancelNodeCreation() {
            return props.onCancelNodeCreation;
        },
        get actions() {
            return props.actions as TreeNodeAction<TreeNode>[];
        },

        focus(node) {
            treeRootContextValue.currentlyFocusableNode = node;
            if (node) {
                treeRootContextValue.nodeElements.get(node)?.focus();
            } else {
                rootListRef?.focus();
            }
        },
    } satisfies TreeRootContextValue;

    return (
        <TreeRootContext.Provider value={treeRootContextValue}>
            <Show
                when={props.nodes.length > 0 || props.creatingNewNode !== null}
                fallback={<i>{props.emptyTreeMessage ?? 'No entries'}</i>}
            >
                <TreeList ref={el => rootListRef = el} nodes={props.nodes} parents={[]} />
            </Show>
        </TreeRootContext.Provider>
    );
};
