import React, { useState, useEffect, useRef } from 'react';
import { ColorGrading, Clip, MediaFile } from '../types';
import { ColorGradeFilter } from './ColorGradeFilter';
import { Tooltip } from './Tooltip';

interface ColorGradingPreviewModalProps {
    clip: Clip;
    mediaFile: MediaFile;
    currentTime: number;
    onSave: (grading: ColorGrading) => void;
    onCancel: () => void;
}

const DEFAULT_GRADING: ColorGrading = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    exposure: 0,
    sharpness: 0,
};

export const ColorGradingPreviewModal: React.FC<ColorGradingPreviewModalProps> = ({
    clip,
    mediaFile,
    currentTime,
    onSave,
    onCancel,
}) => {
    const [grading, setGrading] = useState<ColorGrading>(clip.colorGrading || DEFAULT_GRADING);
    const [isPlaying, setIsPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Sync video time
    useEffect(() => {
        if (videoRef.current && mediaFile.type === 'video') {
            const clipDuration = clip.sourceEnd - clip.sourceStart;
            const timeInClip = currentTime - clip.timelineStart;

            if (timeInClip >= 0 && timeInClip <= clipDuration) {
                const mediaTime = clip.sourceStart + timeInClip * (clip.speed || 1);
                videoRef.current.currentTime = mediaTime;
            }
        }
    }, [currentTime, clip, mediaFile]);

    // Load video source and auto-play
    useEffect(() => {
        if (videoRef.current && mediaFile.type === 'video') {
            const targetSrc = clip.processedVideoUrl || mediaFile.url;
            if (videoRef.current.src !== targetSrc) {
                videoRef.current.src = targetSrc;
            }
            if (clip.speed) {
                videoRef.current.playbackRate = clip.speed;
            }
            // Auto-play
            videoRef.current.play().then(() => setIsPlaying(true)).catch(() => { });
        }
    }, [clip, mediaFile]);

    // Keyboard controls (spacebar to toggle play/pause)
    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                e.preventDefault();
                handlePlayPause();
            }
        };
        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [isPlaying]);

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
                setIsPlaying(false);
            } else {
                videoRef.current.play();
                setIsPlaying(true);
            }
        }
    };

    const handleStop = () => {
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = clip.sourceStart;
            setIsPlaying(false);
        }
    };

    const handleRewind = () => {
        if (videoRef.current) {
            videoRef.current.currentTime = clip.sourceStart;
        }
    };

    const handleChange = (key: keyof ColorGrading, value: number) => {
        setGrading({ ...grading, [key]: value });
    };

    const handleSave = () => {
        onSave(grading);
    };

    const SliderControl = ({
        label,
        fieldKey,
        min,
        max,
        step,
        defaultValue,
        value,
    }: {
        label: string;
        fieldKey: keyof ColorGrading;
        min: number;
        max: number;
        step: number;
        defaultValue: number;
        value: number;
    }) => {
        const [textValue, setTextValue] = useState<string>(value.toString());
        const [sliderValue, setSliderValue] = useState<number>(value);

        useEffect(() => {
            setTextValue(value.toString());
            setSliderValue(value);
        }, [value]);

        const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const newVal = parseFloat(e.target.value);
            setSliderValue(newVal);
            setTextValue(newVal.toString());
            handleChange(fieldKey, newVal);
        };

        const handleCommitText = () => {
            let val = parseFloat(textValue);
            if (isNaN(val)) {
                setTextValue(value.toString());
                return;
            }
            if (val < min) val = min;
            if (val > max) val = max;

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

    const filterId = `preview-filter-${clip.id}`;
    const hasColorGrading =
        grading.brightness !== 1 ||
        grading.contrast !== 1 ||
        grading.saturation !== 1 ||
        grading.exposure !== 0 ||
        grading.sharpness !== 0;

    return (
        <div className="fixed inset-0 bg-black z-50 flex flex-col h-screen max-h-screen overflow-hidden">
            {/* Top Bar */}
            <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
                <h2 className="text-lg font-semibold text-white">
                    Color Grading Preview - {mediaFile.name}
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition"
                    >
                        Save Changes
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Video Preview (Left) */}
                <div className="flex-1 flex flex-col bg-black p-4 min-h-0">
                    <div className="relative flex-1 flex items-center justify-center min-h-0">
                        <ColorGradeFilter id={filterId} grading={grading} />
                        <video
                            ref={videoRef}
                            className="max-w-full max-h-full object-contain"
                            style={{
                                filter: hasColorGrading ? `url(#${filterId})` : 'none',
                            }}
                            loop
                            muted
                        />
                    </div>

                    {/* Playback Controls - Professional Design */}
                    <div className="flex items-center justify-center gap-3 mt-4 flex-shrink-0 pb-2">
                        <button
                            onClick={handleRewind}
                            className="group flex items-center justify-center w-11 h-11 bg-gray-800/90 hover:bg-gray-700 text-white rounded-full transition-all shadow-lg hover:shadow-xl hover:scale-105"
                            title="Rewind to start"
                        >
                            <span className="text-xl group-hover:scale-110 transition-transform">⏮</span>
                        </button>
                        <button
                            onClick={handlePlayPause}
                            className="group flex items-center justify-center w-14 h-14 bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-full transition-all shadow-lg hover:shadow-xl hover:scale-105 font-medium"
                            title="Play/Pause (Spacebar)"
                        >
                            <span className="text-2xl group-hover:scale-110 transition-transform">
                                {isPlaying ? '⏸' : '▶'}
                            </span>
                        </button>
                        <button
                            onClick={handleStop}
                            className="group flex items-center justify-center w-11 h-11 bg-gray-800/90 hover:bg-gray-700 text-white rounded-full transition-all shadow-lg hover:shadow-xl hover:scale-105"
                            title="Stop"
                        >
                            <span className="text-xl group-hover:scale-110 transition-transform">⏹</span>
                        </button>
                    </div>
                </div>

                {/* Controls Sidebar (Right) */}
                <div className="bg-gray-900 border-l border-gray-800 p-6 w-80 overflow-y-auto flex-shrink-0">
                    <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
                        Color Grading
                    </h3>

                    <SliderControl
                        label="Exposure"
                        fieldKey="exposure"
                        min={-0.5}
                        max={0.5}
                        step={0.01}
                        defaultValue={0}
                        value={grading.exposure}
                    />
                    <SliderControl
                        label="Contrast"
                        fieldKey="contrast"
                        min={0.5}
                        max={1.5}
                        step={0.01}
                        defaultValue={1}
                        value={grading.contrast}
                    />
                    <SliderControl
                        label="Brightness"
                        fieldKey="brightness"
                        min={0.5}
                        max={1.5}
                        step={0.01}
                        defaultValue={1}
                        value={grading.brightness}
                    />
                    <SliderControl
                        label="Saturation"
                        fieldKey="saturation"
                        min={0}
                        max={2}
                        step={0.01}
                        defaultValue={1}
                        value={grading.saturation}
                    />
                    <SliderControl
                        label="Sharpness"
                        fieldKey="sharpness"
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        value={grading.sharpness}
                    />
                </div>
            </div>
        </div>
    );
};
