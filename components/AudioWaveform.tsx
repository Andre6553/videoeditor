import React, { useEffect, useRef, useState } from 'react';

interface AudioWaveformProps {
    url: string;
    sourceStart: number;
    sourceEnd: number;
    color?: string;
    beats?: number[];
    transitionStart?: { type: string; duration: number };
    transitionEnd?: { type: string; duration: number };
    clipVolume?: number;
    onVolumeChange?: (newVolume: number) => void;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({ url, sourceStart, sourceEnd, color = '#ffffff', beats, transitionStart, transitionEnd, clipVolume = 1.0, onVolumeChange }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchAudio = async () => {
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
                setAudioBuffer(decodedBuffer);
                await audioContext.close();
            } catch (err) {
                console.error('Error loading audio waveform:', err);
                setError('Failed to load audio');
            }
        };

        fetchAudio();
    }, [url]);

    useEffect(() => {
        if (!canvasRef.current || !audioBuffer) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth * dpr;
        const height = canvas.clientHeight * dpr;

        canvas.width = width;
        canvas.height = height;

        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = color;

        const data = audioBuffer.getChannelData(0);

        // Calculate start and end samples based on sourceStart/sourceEnd
        // sourceStart/End are in seconds
        const startSample = Math.floor(sourceStart * audioBuffer.sampleRate);
        const endSample = Math.floor(sourceEnd * audioBuffer.sampleRate);
        const totalSamplesToDraw = endSample - startSample;

        if (totalSamplesToDraw <= 0) return;

        const step = Math.ceil(totalSamplesToDraw / (width / dpr));
        // const amp = (height / dpr) / 2; // Unused

        // Set opacity for waveform if beats are present
        if (beats && beats.length > 0) {
            ctx.globalAlpha = 0.5;
        } else {
            ctx.globalAlpha = 1.0;
        }

        for (let i = 0; i < width / dpr; i++) {
            let min = 1.0;
            let max = -1.0;

            const startIndex = startSample + (i * step);

            for (let j = 0; j < step; j++) {
                if (startIndex + j < data.length) {
                    const datum = data[startIndex + j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
            }

            // Draw a line for this slice
            // Center it vertically
            const yMin = ((1 - max) * (height / dpr)) / 2;
            const yMax = ((1 - min) * (height / dpr)) / 2;

            ctx.fillRect(i, yMin, 1, yMax - yMin);
        }

        // Draw beats
        if (beats && beats.length > 0) {
            ctx.globalAlpha = 1.0; // Reset opacity for beats
            ctx.fillStyle = '#FF0000'; // Bright red lines for beats
            const duration = sourceEnd - sourceStart;

            beats.forEach(beatTime => {
                if (beatTime >= sourceStart && beatTime <= sourceEnd) {
                    const x = ((beatTime - sourceStart) / duration) * (width / dpr);
                    ctx.fillRect(x, 0, 1, height / dpr);
                }
            });
        }

    }, [audioBuffer, sourceStart, sourceEnd, color, beats]);

    if (error) return null;

    const clipDuration = sourceEnd - sourceStart;

    return (
        <div className="relative w-full h-full">
            <canvas
                ref={canvasRef}
                className="w-full h-full opacity-80 pointer-events-none"
            />
            {/* SVG Overlay for Fade Curves */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                {/* Fade-in at START */}
                {transitionStart?.type === 'fade-in' && transitionStart.duration > 0 && (
                    <line
                        x1="0"
                        y1="100%"
                        x2={`${(transitionStart.duration / clipDuration) * 100}%`}
                        y2="0"
                        stroke="rgba(255, 255, 255, 0.6)"
                        strokeWidth="2"
                    />
                )}
                {/* Fade-out at START */}
                {transitionStart?.type === 'fade-out' && transitionStart.duration > 0 && (
                    <line
                        x1="0"
                        y1="0"
                        x2={`${(transitionStart.duration / clipDuration) * 100}%`}
                        y2="100%"
                        stroke="rgba(255, 255, 255, 0.6)"
                        strokeWidth="2"
                    />
                )}
                {/* Fade-in at END */}
                {transitionEnd?.type === 'fade-in' && transitionEnd.duration > 0 && (
                    <line
                        x1={`${((clipDuration - transitionEnd.duration) / clipDuration) * 100}%`}
                        y1="100%"
                        x2="100%"
                        y2="0"
                        stroke="rgba(255, 255, 255, 0.6)"
                        strokeWidth="2"
                    />
                )}
                {/* Fade-out at END */}
                {transitionEnd?.type === 'fade-out' && transitionEnd.duration > 0 && (
                    <line
                        x1={`${((clipDuration - transitionEnd.duration) / clipDuration) * 100}%`}
                        y1="0"
                        x2="100%"
                        y2="100%"
                        stroke="rgba(255, 255, 255, 0.6)"
                        strokeWidth="2"
                    />
                )}

                {/* Volume line - horizontal line showing clip volume level */}
                <line
                    x1="0"
                    y1={`${(1 - clipVolume) * 100}%`}
                    x2="100%"
                    y2={`${(1 - clipVolume) * 100}%`}
                    stroke="rgba(255, 16, 240, 0.95)"
                    strokeWidth="2"
                    className={onVolumeChange ? "pointer-events-auto cursor-ns-resize" : "pointer-events-none"}
                    onMouseDown={(e) => {
                        if (!onVolumeChange) return;
                        e.stopPropagation();
                        e.preventDefault();

                        const svg = e.currentTarget.ownerSVGElement;
                        if (!svg) return;

                        const handleMouseMove = (moveEvent: MouseEvent) => {
                            const rect = svg.getBoundingClientRect();
                            const y = moveEvent.clientY - rect.top;
                            const newVolume = Math.max(0, Math.min(1, 1 - (y / rect.height)));
                            onVolumeChange(newVolume);
                        };

                        const handleMouseUp = () => {
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', handleMouseUp);
                            document.body.style.cursor = 'default';
                        };

                        document.addEventListener('mousemove', handleMouseMove);
                        document.addEventListener('mouseup', handleMouseUp);
                        document.body.style.cursor = 'ns-resize';
                    }}
                />
            </svg>
        </div>
    );
};
