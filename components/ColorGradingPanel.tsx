import React from 'react';
import { ColorGrading } from '../types';
import { Tooltip } from './Tooltip';

interface ColorGradingPanelProps {
    colorGrading: ColorGrading | undefined;
    onChange: (grading: ColorGrading) => void;
    onPreview?: () => void;
}

const DEFAULT_GRADING: ColorGrading = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    exposure: 0,
    sharpness: 0,
};

export const ColorGradingPanel: React.FC<ColorGradingPanelProps> = ({ colorGrading, onChange, onPreview }) => {
    const grading = colorGrading || DEFAULT_GRADING;

    const handleChange = (key: keyof ColorGrading, value: number) => {
        onChange({ ...grading, [key]: value });
    };

    const SliderControl = ({
        label,
        fieldKey,
        min,
        max,
        step,
        defaultValue,
        value
    }: {
        label: string,
        fieldKey: keyof ColorGrading,
        min: number,
        max: number,
        step: number,
        defaultValue: number,
        value: number
    }) => {
        // Local state for the text input
        const [textValue, setTextValue] = React.useState<string>(value.toString());
        // Local state for the slider handle to ensure smooth dragging
        const [sliderValue, setSliderValue] = React.useState<number>(value);

        // Sync local values when prop changes (unless focused/dragging)
        React.useEffect(() => {
            setTextValue(value.toString());
            setSliderValue(value);
        }, [value]);

        const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const newVal = parseFloat(e.target.value);
            setSliderValue(newVal); // Instant local update
            setTextValue(newVal.toString());
            handleChange(fieldKey, newVal); // Propagate to parent
        };

        const handleCommitText = () => {
            let val = parseFloat(textValue);
            if (isNaN(val)) {
                setTextValue(value.toString()); // Revert to current prop value
                return;
            }
            // Clamp
            if (val < min) val = min;
            if (val > max) val = max;

            // Update parent
            handleChange(fieldKey, val);
            setSliderValue(val);
            setTextValue(val.toString());
        };

        const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
            }
        };

        return (
            <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{label}</span>
                    <div className="flex gap-2">
                        <span>{min}</span>
                        <span>{max}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={sliderValue}
                        onChange={handleSliderChange}
                        className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                    <input
                        type="text"
                        value={textValue}
                        onChange={(e) => setTextValue(e.target.value)}
                        onBlur={handleCommitText}
                        onKeyDown={handleKeyDown}
                        className="w-16 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-white focus:ring-1 focus:ring-orange-500 text-center"
                    />
                    <Tooltip text="Reset">
                        <button
                            onClick={() => handleChange(fieldKey, defaultValue)}
                            className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-white"
                        >
                            ↺
                        </button>
                    </Tooltip>
                </div>
            </div>
        );
    };

    return (
        <div className="bg-gray-900 border-l border-gray-800 p-4 w-64 overflow-y-auto h-full flex-shrink-0 flex flex-col">
            <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Color Grading</h3>

            <div className="flex-1">
                <SliderControl label="Exposure" fieldKey="exposure" min={-0.5} max={0.5} step={0.01} defaultValue={0} value={grading.exposure} />
                <SliderControl label="Contrast" fieldKey="contrast" min={0.5} max={1.5} step={0.01} defaultValue={1} value={grading.contrast} />
                <SliderControl label="Brightness" fieldKey="brightness" min={0.5} max={1.5} step={0.01} defaultValue={1} value={grading.brightness} />
                <SliderControl label="Saturation" fieldKey="saturation" min={0} max={2} step={0.01} defaultValue={1} value={grading.saturation} />
                <SliderControl label="Sharpness" fieldKey="sharpness" min={0} max={1} step={0.01} defaultValue={0} value={grading.sharpness} />
            </div>

            {/* Preview Button */}
            {onPreview && (
                <button
                    onClick={onPreview}
                    className="w-full mt-4 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition font-medium"
                >
                    🔍 Preview
                </button>
            )}
        </div>
    );
};
