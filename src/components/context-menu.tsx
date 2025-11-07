import type { ComponentChildren } from 'preact';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { computed, signal, useSignalEffect } from '@preact/signals';
import { computePosition, flip, shift, size } from '@floating-ui/dom';
import classNames from 'classnames';

import { modulo } from '../helpers/modulo';

export type TwoDim = [number, number];

interface FocusTrapProps {
    returnFocus: () => void;
    children?: ComponentChildren;
}

const FocusTrap = ({ returnFocus, children }: FocusTrapProps) => {
    const trap = <div tabIndex={0} style={{ position: 'absolute '}} onFocus={returnFocus} />;

    return (
        <>
            {trap}
            {children}
            {trap}
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

export const ContextMenu = ({ position, items, onCancel }: ContextMenuProps) => {
    const elementRef = useRef<HTMLDivElement>(null);
    const [constrainedPosition, setConstrainedPosition] = useState([0, 0] as TwoDim);
    const [maxSize, setMaxSize] = useState([0, 0] as TwoDim);
    const needToRecalculatePosition = useMemo(() => ({ value: true }), [...position]);
    const currentIndex = useMemo(() => signal<number | null>(null), [items]);
    const itemElements = useRef<HTMLElement[]>([]);

    const handleBackdropClick = useCallback((event: MouseEvent) => {
        event.preventDefault();
        onCancel();
    }, [onCancel]);

    const handleMouseOut = useCallback((event: MouseEvent) => {
        currentIndex.value = null;
    }, []);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            onCancel();
            event.stopPropagation();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            let direction = event.key === 'ArrowDown' ? 1 : -1;
            let newIndex;
            if (currentIndex.value !== null) {
                newIndex = modulo(currentIndex.value + direction, items.length);
            } else {
                newIndex = direction === 1 ? 0 : items.length - 1;
            }
            currentIndex.value = newIndex;
            event.stopPropagation();
        }
    }, []);

    const handleItemClick = useCallback((item: ContextMenuItem) => (event: MouseEvent) => {
        item.action(event);
        onCancel();
    }, []);

    const handleItemKeyDown = useCallback((item: ContextMenuItem) => (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
            item.action(event);
            onCancel();
        }
    }, []);

    const handleItemHover = useCallback((idx: number) => (event: MouseEvent) => {
        currentIndex.value = idx;
    }, []);

    useSignalEffect(() => {
        if (currentIndex.value !== null) {
            itemElements.current[currentIndex.value]?.focus();
        } else {
            elementRef.current?.focus();
        }
    });

    useLayoutEffect(() => {
        if (needToRecalculatePosition.value && elementRef.current) {
            const virtualReferenceElement = {
                getBoundingClientRect() {
                    return {
                        width: 0,
                        height: 0,
                        x: position[0],
                        y: position[1],
                        top: position[1],
                        left: position[0],
                        right: position[0],
                        bottom: position[1],
                    };
                },
            };

            const sizeCalculation = Promise.withResolvers<{
                availableWidth: number;
                availableHeight: number;
            }>();

            // Will be overridden on the next render
            elementRef.current.style.maxWidth = '';
            elementRef.current.style.maxHeight = '';

            computePosition(virtualReferenceElement, elementRef.current, {
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

                needToRecalculatePosition.value = false;
            });
        }
    });

    itemElements.current = [];

    return (
        <FocusTrap returnFocus={() => elementRef.current?.focus()}>
            <div
                className="popover-menu-backdrop"
                onClick={handleBackdropClick}
                onMouseDown={handleBackdropClick}
            />
            <div
                ref={elementRef}
                className="popover-menu"
                style={{
                    left: `${constrainedPosition[0]}px`,
                    top: `${constrainedPosition[1]}px`,
                    maxWidth: maxSize[0] > 0 ? `${maxSize[0]}px` : '',
                    maxHeight: maxSize[1] > 0 ? `${maxSize[1]}px` : '',
                }}
                tabIndex={0}
                onMouseOut={handleMouseOut}
                onKeyDown={handleKeyDown}
            >
                <ul className="menu-list">
                    {items.map((item, idx) => (
                        <li
                            ref={(element) => {
                                if (element) itemElements.current[idx] = element;
                                else delete itemElements.current[idx];
                            }}
                            key={idx}
                            className={computed(() => classNames('menu-list-item', currentIndex.value === idx && 'focused'))}
                            tabIndex={computed(() => currentIndex.value === idx ? 0 : -1)}
                            onClick={handleItemClick(item)}
                            onKeyDown={handleItemKeyDown(item)}
                            onMouseEnter={handleItemHover(idx)}
                        >
                            {item.name}
                        </li>
                    ))}
                </ul>
            </div>
        </FocusTrap>
    );
};
