import { createEffect, createSelector, createSignal, For, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { computePosition, flip, shift, size } from '@floating-ui/dom';

import type { Point2D } from '../types';

import { modulo } from '../helpers/modulo';
import { cls } from '../helpers/class-names';
import { equals } from '../helpers/comparison';

interface FocusTrapProps {
    returnFocus: () => void;
    children: JSX.Element;
}

const FocusTrap = (props: FocusTrapProps) => {
    const trap = () => (
        <div tabIndex={0} style={{ position: 'absolute' }} onFocus={props.returnFocus} />
    );

    return (
        <>
            {trap()}
            {props.children}
            {trap()}
        </>
    );
};

interface ContextMenuItem {
    name: string;
    action: () => void;
}

interface ContextMenuProps {
    anchor: Point2D;
    items: ContextMenuItem[];
    onCancel: () => void;
}

export const ContextMenu = (props: ContextMenuProps) => {
    let elementRef: HTMLDivElement;
    let listElement: HTMLUListElement;

    const [constrainedPosition, setConstrainedPosition] = createSignal<Point2D>([0, 0]);
    const [maxSize, setMaxSize] = createSignal<Point2D>([0, 0]);
    const [lastAnchorPoint, setLastAnchorPoint] = createSignal<Point2D | null>(null);

    const [selectedIndex, setSelectedIndex] = createSignal<number | null>(null);
    const isItemSelected = createSelector(selectedIndex);

    const handleBackdropClick = (event: MouseEvent) => {
        event.preventDefault();
        props.onCancel();
    };

    const handleMouseOut = (event: MouseEvent) => {
        setSelectedIndex(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            props.onCancel();
            event.stopPropagation();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            let delta = event.key === 'ArrowDown' ? 1 : -1;
            let oldIndex = selectedIndex() ?? (delta > 0 ? -1 : props.items.length);
            let newIndex = modulo(oldIndex + delta, props.items.length);
            setSelectedIndex(newIndex);
            event.stopPropagation();
        }
    };

    const handleItemClick = (item: ContextMenuItem) => (event: MouseEvent) => {
        item.action();
        props.onCancel();
    };

    const handleItemKeyDown = (item: ContextMenuItem) => (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
            item.action();
            props.onCancel();
        }
    };

    const handleItemHover = (idx: number) => (event: MouseEvent) => {
        setSelectedIndex(idx);
    };

    createEffect(() => {
        ((listElement.children[selectedIndex() ?? -1] ?? elementRef) as HTMLElement).focus();
    });

    createEffect(() => {
        let anchorPoint = props.anchor;
        if (!equals(lastAnchorPoint(), anchorPoint)) {
            const virtualReferenceElement = {
                getBoundingClientRect() {
                    return {
                        width: 0,
                        height: 0,
                        x: anchorPoint[0],
                        y: anchorPoint[1],
                        top: anchorPoint[1],
                        left: anchorPoint[0],
                        right: anchorPoint[0],
                        bottom: anchorPoint[1],
                    };
                },
            };

            const sizeCalculation = Promise.withResolvers<{
                availableWidth: number;
                availableHeight: number;
            }>();

            setMaxSize([0, 0]);

            computePosition(virtualReferenceElement, elementRef, {
                placement: 'bottom-start',
                strategy: 'fixed',
                middleware: [
                    flip({
                        crossAxis: 'alignment',
                        fallbackAxisSideDirection: 'end',
                    }),
                    shift(),
                    size({
                        apply(result: { availableWidth: number; availableHeight: number; }) {
                            sizeCalculation.resolve(result);
                        },
                    }),
                ],
            }).then(async (result) => {
                const size = await sizeCalculation.promise;

                if (equals(props.anchor, anchorPoint)) {
                    setConstrainedPosition([result.x, result.y]);
                    setMaxSize([size.availableWidth, size.availableHeight]);
                    setLastAnchorPoint(anchorPoint);
                }
            });
        }
    });

    return (
        <Portal>
            <FocusTrap returnFocus={() => elementRef.focus()}>
                <div
                    class="popover-backdrop"
                    onClick={handleBackdropClick}
                    onMouseDown={handleBackdropClick}
                />
                <div
                    ref={(el) => elementRef = el}
                    class="menu-popover popover fixed-positioning animate-enter"
                    style={{
                        'left': `${constrainedPosition()[0]}px`,
                        'top': `${constrainedPosition()[1]}px`,
                        'max-width': maxSize()[0] > 0 ? `${maxSize()[0]}px` : '',
                        'max-height': maxSize()[1] > 0 ? `${maxSize()[1]}px` : '',
                    }}
                    tabIndex={0}
                    onMouseOut={handleMouseOut}
                    onKeyDown={handleKeyDown}
                >
                    <ul ref={(el) => listElement = el} class="menu-list">
                        <For each={props.items}>
                            {(item, idx) => (
                                <li
                                    class={cls('menu-list-item', isItemSelected(idx()) && 'focused')}
                                    tabIndex={isItemSelected(idx()) ? 0 : -1}
                                    onClick={handleItemClick(item)}
                                    onKeyDown={handleItemKeyDown(item)}
                                    onMouseEnter={handleItemHover(idx())}
                                >
                                    {item.name}
                                </li>
                            )}
                        </For>
                    </ul>
                </div>
            </FocusTrap>
        </Portal>
    );
};
