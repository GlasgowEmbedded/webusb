import { createComputed, createEffect, createMemo, createSignal, For, on, type JSX } from 'solid-js';
import { computePosition, flip, shift, size } from '@floating-ui/dom';
import classNames from 'classnames';

import { modulo } from '../helpers/modulo';

export type TwoDim = [number, number];

interface FocusTrapProps {
    returnFocus: () => void;
    children: JSX.Element;
}

const FocusTrap = (props: FocusTrapProps) => {
    const trap = () => <div tabIndex={0} style={{ position: 'absolute' }} onFocus={props.returnFocus} />;

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
    action: (event: Event) => void;
}

interface ContextMenuProps {
    position: TwoDim;
    items: ContextMenuItem[];
    onCancel: () => void;
}

export const ContextMenu = (props: ContextMenuProps) => {
    let elementRef: HTMLDivElement;

    const [constrainedPosition, setConstrainedPosition] = createSignal<TwoDim>([0, 0]);
    const [maxSize, setMaxSize] = createSignal<TwoDim>([0, 0]);
    const needToRecalculatePosition = createMemo(on(() => props.position, () => ({ value: true })));
    const [currentIndex, setCurrentIndex] = createSignal<number | null>(null);
    const itemElements: HTMLElement[] = [];

    createComputed(() => {
        props.items;
        setCurrentIndex(null);
    });

    const handleBackdropClick = (event: MouseEvent) => {
        event.preventDefault();
        props.onCancel();
    };

    const handleMouseOut = (event: MouseEvent) => {
        setCurrentIndex(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            props.onCancel();
            event.stopPropagation();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            let direction = event.key === 'ArrowDown' ? 1 : -1;
            let newIndex;
            if (currentIndex() !== null) {
                newIndex = modulo(currentIndex()! + direction, props.items.length);
            } else {
                newIndex = direction === 1 ? 0 : props.items.length - 1;
            }
            setCurrentIndex(newIndex);
            event.stopPropagation();
        }
    };

    const handleItemClick = (item: ContextMenuItem) => (event: MouseEvent) => {
        item.action(event);
        props.onCancel();
    };

    const handleItemKeyDown = (item: ContextMenuItem) => (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
            item.action(event);
            props.onCancel();
        }
    };

    const handleItemHover = (idx: number) => (event: MouseEvent) => {
        setCurrentIndex(idx);
    };

    createEffect(() => {
        if (currentIndex() !== null) {
            itemElements[currentIndex()!]?.focus();
        } else {
            elementRef.focus();
        }
    });

    createEffect(() => {
        if (needToRecalculatePosition().value && elementRef) {
            const virtualReferenceElement = {
                getBoundingClientRect() {
                    return {
                        width: 0,
                        height: 0,
                        x: props.position[0],
                        y: props.position[1],
                        top: props.position[1],
                        left: props.position[0],
                        right: props.position[0],
                        bottom: props.position[1],
                    };
                },
            };

            const sizeCalculation = Promise.withResolvers<{
                availableWidth: number;
                availableHeight: number;
            }>();

            // Will be overridden on the next render
            elementRef.style.maxWidth = '';
            elementRef.style.maxHeight = '';

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

                setConstrainedPosition([result.x, result.y]);
                setMaxSize([size.availableWidth, size.availableHeight]);

                needToRecalculatePosition().value = false;
            });
        }
    });

    return (
        <FocusTrap returnFocus={() => elementRef.focus()}>
            <div
                class="popover-menu-backdrop"
                onClick={handleBackdropClick}
                onMouseDown={handleBackdropClick}
            />
            <div
                ref={(el) => elementRef = el}
                class="popover-menu"
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
                <ul class="menu-list">
                    <For each={props.items}>
                        {(item, idx) => (
                            <li
                                ref={(element) => {
                                    if (element) itemElements[idx()] = element;
                                    else delete itemElements[idx()];
                                }}
                                class={classNames('menu-list-item', currentIndex() === idx() && 'focused')}
                                tabIndex={currentIndex() === idx() ? 0 : -1}
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
    );
};
