import { cls } from '../helpers/class-names';
import './progress-bar.css';

interface ProgressBarProps {
    value: number;
    style?: 'normal' | 'success';
}

export const ProgressBar = (props: ProgressBarProps) => {
    return (
        <div
            class={cls('progress-bar', props.style === 'success' && 'success')}
            role="progressbar"
            aria-valuenow={props.value}
            aria-valuemax={1}
        >
            <div class="filled" style={{ 'inline-size': `${(props.value * 100).toFixed(2)}%` }} />
        </div>
    );
};
