import { splitProps, type JSX } from 'solid-js';
import classNames from 'classnames';

export const IconMore = (props: JSX.SvgSVGAttributes<SVGSVGElement>) => {
    const [local, other] = splitProps(props, ['class']);

    return (
        <svg width="16" height="16" fill="currentColor" class={classNames('icon', local.class)} {...other}>
            <circle cx="2" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="14" cy="8" r="1.5" />
        </svg>
    );
};
