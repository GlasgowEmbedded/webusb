import { children, createComputed, createSignal, type JSX } from 'solid-js';

const ANIMATION_ID = 'popover-container-animation';

interface PopoverContainerProps {
    children: JSX.Element;
}

export const PopoverContainer = (props: PopoverContainerProps) => {
    const resolved = children(() => props.children);

    const [rendered, setRendered] = createSignal<JSX.Element>(null);

    function cancelExistingAnimation(element: HTMLElement) {
        element.getAnimations().find(anim => anim.id === ANIMATION_ID)?.cancel();
    }

    createComputed((previous) => {
        const current = resolved();

        if (current !== undefined && current !== null && !(current instanceof HTMLElement)) {
            throw new Error('Popover container only supports a single popover');
        }

        if (previous !== undefined && previous !== null && !(previous instanceof HTMLElement)) {
            throw new Error('Unexpected children type');
        }

        if (!previous && current) {
            setRendered(current);
            cancelExistingAnimation(current);
            current.animate(
                { transform: 'translateY(16px)', opacity: 0, offset: 0 },
                { duration: 150, id: ANIMATION_ID, timeline: document.timeline },
            );
        } else if (previous && !current) {
            cancelExistingAnimation(previous);
            const animation = previous.animate(
                { transform: 'translateY(16px)', opacity: 0 },
                { duration: 150, id: ANIMATION_ID, timeline: document.timeline },
            );
            animation.finished.then(() => {
                if (rendered() === previous) {
                    setRendered(null);
                }
            });
        }

        return current;
    }, resolved());

    return (
        <div class="popover-container">
            {rendered()}
        </div>
    );
};
