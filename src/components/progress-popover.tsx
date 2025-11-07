import { ProgressBar } from './progress-bar';

interface ProgressPopoverProps {
    label: string;
    progressText: string;
    progressValue: number;
    done: boolean;
}

export const ProgressPopover = (props: ProgressPopoverProps) => {
    return (
        <div class="progress-popover popover">
            <div class="label">{props.label}</div>
            <div class="progress-text">{props.progressText}</div>
            <ProgressBar value={props.progressValue} style={props.done ? 'success' : 'normal'} />
        </div>
    );
};
