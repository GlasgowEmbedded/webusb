import { createComputed, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';

import { ContextMenu, type TwoDim } from './context-menu';
import { Icon } from './icon';
import { IconMore } from './icon-more';

import { cls } from '../helpers/class-names';

const resizeObserverCallbacks = new Map<Element, (entry: ResizeObserverEntry) => void>();

const resizeObserver = new ResizeObserver((entries, _observer) => {
    for (const entry of entries) {
        resizeObserverCallbacks.get(entry.target)?.(entry);
    }
});

function useResizeObserverRef(callback: (entry: ResizeObserverEntry) => void) {
    let savedElementRef: Element | null = null;

    let ref = (element: Element | null) => {
        if (savedElementRef !== null) {
            resizeObserver.unobserve(savedElementRef);
            resizeObserverCallbacks.delete(savedElementRef);
        }
        savedElementRef = element;
        if (savedElementRef !== null) {
            resizeObserver.observe(savedElementRef);
            resizeObserverCallbacks.set(savedElementRef, callback);
        }
    };

    onCleanup(() => ref(null));

    return ref;
}

interface PanelAction {
    name: string;
    iconName?: string;
    iconOnly?: boolean;
    disabled: boolean;
    handleAction: (event: Event) => void;
}

interface PanelActionsProps {
    actions?: PanelAction[];
}

const PanelActions = (props: PanelActionsProps) => {
    const [numberOfVisibleActions, setNumberOfVisibleActions] = createSignal(props.actions?.length ?? 0);
    const [actionsMenuOpenAtPosition, setActionsMenuOpenAtPosition] = createSignal<TwoDim | null>(null);

    const visibleActionsWrapperRef = useResizeObserverRef((entry: ResizeObserverEntry) => {
        const wrapper = entry.target as HTMLElement;
        const gap = Number(getComputedStyle(wrapper.children[0]).gap.replace(/px$/, ''));
        const buttons = [...wrapper.children[0].children] as HTMLElement[];
        const hiddenButtons = buttons.filter(element => element.hidden);
        const actions = buttons.slice(0, -1);
        const moreButton = buttons.at(-1)!;

        for (const button of hiddenButtons) {
            button.hidden = false;
        }

        let cumulativeInlineSize = moreButton.clientWidth;
        let numberOfActionsThatFit = 0;
        for (let idx = 0, len = actions.length; idx < len; idx++) {
            if (cumulativeInlineSize + gap + actions[idx].clientWidth > entry.contentBoxSize[0].inlineSize) {
                break;
            }
            cumulativeInlineSize += gap + actions[idx].clientWidth;
            numberOfActionsThatFit++;
        }

        for (const button of hiddenButtons) {
            button.hidden = true;
        }

        setNumberOfVisibleActions(numberOfActionsThatFit);
    });

    const handleMoreButtonClick = (event: MouseEvent) => {
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        setActionsMenuOpenAtPosition([rect.right, rect.bottom - 4]);
    };

    return (
        <>
            <div ref={visibleActionsWrapperRef} class="panel-visible-actions-wrapper">
                <div class="panel-visible-actions">
                    {props.actions?.map((action, idx) => (
                        <button
                            type="button"
                            class="button"
                            hidden={idx >= numberOfVisibleActions()}
                            disabled={action.disabled}
                            title={action.name}
                            aria-label={action.name}
                            onClick={action.handleAction}
                        >
                            {action.iconName ? <Icon class="aligned-icon" name={action.iconName} /> : null}
                            {!action.iconOnly ? <span>{action.name}</span> : null}
                        </button>
                    ))}
                    <button
                        type="button"
                        class="button"
                        aria-label="More"
                        hidden={numberOfVisibleActions() === props.actions?.length}
                        onClick={handleMoreButtonClick}
                    >
                        <IconMore class="aligned-icon" />
                    </button>
                </div>
            </div>
            {(props.actions && actionsMenuOpenAtPosition()) ? (
                <ContextMenu
                    position={actionsMenuOpenAtPosition()!}
                    items={props.actions.slice(numberOfVisibleActions()).map((action) => ({
                        name: action.name,
                        action: (event) => action.handleAction(event),
                    }))}
                    onCancel={() => setActionsMenuOpenAtPosition(null)}
                />
            ) : null}
        </>
    );
};

interface Panel {
    name: string;
    iconName: string;
    className?: string;
    actions?: PanelAction[];
    children?: JSX.Element;
}

interface PanelContainerProps {
    panels: Panel[];
}

export const PanelContainer = (props: PanelContainerProps) => {
    const [activePanelIdx, setActivePanelIdx] = createSignal(0);
    const [isSinglePanel, setIsSinglePanel] = createSignal(false);

    const handleResize = (entry: ResizeObserverEntry) => {
        setIsSinglePanel(entry.borderBoxSize[0].inlineSize <= 600);
    };

    const lastFocusedElementsPerPanel: HTMLOrSVGElement[] = [];
    createComputed(() => {
        props.panels;
        lastFocusedElementsPerPanel.length = 0;
    });

    const switchToPanel = (newIdx: number) => {
        setActivePanelIdx(newIdx);
    };

    const handlePanelButtonPointerDown = (newIdx: number) => (event: PointerEvent) => {
        event.preventDefault();
        lastFocusedElementsPerPanel[activePanelIdx()] =
            (document.activeElement ?? document.body) as HTMLElement as HTMLOrSVGElement;
        switchToPanel(newIdx);
        if (lastFocusedElementsPerPanel[newIdx]) {
            requestAnimationFrame(() => {
                lastFocusedElementsPerPanel[newIdx].focus();
                delete lastFocusedElementsPerPanel[newIdx];
            });
        }
    };

    const rootRefCallback = useResizeObserverRef(handleResize);

    return (
        <div
            ref={rootRefCallback}
            class={cls('panel-container', isSinglePanel() && 'single-panel')}
        >
            <Show when={isSinglePanel()}>
                <header class="panel-header">
                    <For each={props.panels}>
                        {(panel, idx) => (
                            <button
                                class={cls('panel-title', panel.className && `${panel.className}-title`, (activePanelIdx() === idx()) && 'active')}
                                aria-label={panel.name}
                                onClick={() => switchToPanel(idx())}
                                onPointerDown={handlePanelButtonPointerDown(idx())}
                            >
                                <Icon class="aligned-icon" name={panel.iconName} />
                            </button>
                        )}
                    </For>
                    <PanelActions actions={props.panels[activePanelIdx()].actions} />
                </header>
            </Show>
            <div class="panel-grid">
                <For each={props.panels}>
                    {(panel, idx) => (
                        <div
                            class={cls(
                                'panel',
                                panel.className,
                                !isSinglePanel() && 'padded',
                                isSinglePanel() && activePanelIdx() !== idx() && 'panel-hidden',
                            )}
                        >
                            <Show when={!isSinglePanel()}>
                                <header class="panel-header">
                                    <h2 class="panel-title active">
                                        <Icon class="aligned-icon" name={panel.iconName} />
                                        <span>{panel.name}</span>
                                    </h2>
                                    <Show when={panel.actions && panel.actions.length > 0}>
                                        {(_) => <PanelActions actions={panel.actions} />}
                                    </Show>
                                </header>
                            </Show>
                            {panel.children}
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
};
