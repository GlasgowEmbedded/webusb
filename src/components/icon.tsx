import { splitProps, type JSX } from 'solid-js';
import { cls } from '../helpers/class-names';

const codiconsSpriteSheetURL = new URL('../../node_modules/@vscode/codicons/dist/codicon.svg', import.meta.url).href;

export interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
    name: string;
}

export const Icon = (props: IconProps) => {
    const [local, other] = splitProps(props, ['name', 'class']);

    return (
        <svg width={16} height={16} class={cls('icon', props.class)} {...other}>
            <use href={`${codiconsSpriteSheetURL}#${local.name}`} />
        </svg>
    );
};
