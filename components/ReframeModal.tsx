import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Clip, MediaFile, ReframeKeyframe } from '../types';
import { PlayIcon, PauseIcon, SparklesIcon, AdjustmentsHorizontalIcon } from './Icons';
import { VideoTrackingService } from '../services/videoTrackingService';

interface ReframeModalProps {
    clip: Clip;
    mediaFile: MediaFile;
    onClose: () => void;
    onSave: (keyframes: ReframeKeyframe[]) => void;
}

export const ReframeModal: React.FC<ReframeModalProps> = ({ clip, mediaFile, onClose, onSave }) => {
    const [currentTime, setCurrentTime] = useState(0); // Time relative to clip source
    const [isPlaying, setIsPlaying] = useState(false);
    const [keyframes, setKeyframes] = useState<ReframeKeyframe[]>(clip.reframeKeyframes || []);

    // State for crop position and scale
    const [cropPosition, setCropPosition] = useState({ x: 0.5, y: 0.5 });
    const [scale, setScale] = useState(1);

    // AI Tracking states
    const [trackingMode, setTrackingMode] = useState<'manual' | 'ai'>('manual');
    const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
    const [isTracking, setIsTracking] = useState(false);
    const [trackingProgress, setTrackingProgress] = useState(0);
    const [trackingConfidence, setTrackingConfidence] = useState<number | null>(null);
    const [showFocusPoint, setShowFocusPoint] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastTimeRef = useRef<number | undefined>(undefined);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const trackingServiceRef = useRef<VideoTrackingService | null>(null);

    const clipDuration = clip.sourceEnd - clip.sourceStart;

    // Initialize tracking service
    useEffect(() => {
        trackingServiceRef.current = new VideoTrackingService();
    }, []);

    // Calculate crop box dimensions based on scale
    // 9:16 aspect ratio within 16:9 container
    // 16:9 = 1.777...
    // 9:16 = 0.5625
    // Width relative to 16:9 container = (9/16) / (16/9) = 81/256 ≈ 0.3164
    const getCropBoxDimensions = useCallback(() => {
        // We need to calculate the crop box dimensions relative to the VIDEO content, not the container.
        // But first, let's get the video aspect ratio.
        // If video is not loaded yet, assume 16:9.
        const video = videoRef.current;
        const videoRatio = video ? video.videoWidth / video.videoHeight : 16 / 9;

        // Target crop aspect ratio is 9:16
        const targetRatio = 9 / 16;

        // We want the crop box to be:
        // Width = (Target Ratio / Video Ratio) * (1/Scale)
        // Height = 1/Scale
        // This ensures that if Scale=1, the crop box covers the full height of the video, 
        // and has the correct width to be 9:16 relative to the video's height.

        const cropHeight = 1 / scale;
        const cropWidth = (targetRatio / videoRatio) * cropHeight;

        return { cropWidth, cropHeight };
    }, [scale]);

    // Interpolate crop based on time
    const getInterpolatedCrop = useCallback((time: number) => {
        if (keyframes.length === 0) return { x: 0.5, y: 0.5, scale: 1 };

        const sorted = [...keyframes].sort((a, b) => a.time - b.time);

        if (time <= sorted[0].time) return { ...sorted[0] };
        if (time >= sorted[sorted.length - 1].time) return { ...sorted[sorted.length - 1] };

        for (let i = 0; i < sorted.length - 1; i++) {
            const k1 = sorted[i];
            const k2 = sorted[i + 1];
            if (time >= k1.time && time < k2.time) {
                const t = (time - k1.time) / (k2.time - k1.time);
                const easedT = t * t * (3 - 2 * t); // Smoothstep
                return {
                    x: k1.x + (k2.x - k1.x) * easedT,
                    y: k1.y + (k2.y - k1.y) * easedT,
                    scale: k1.scale + (k2.scale - k1.scale) * easedT
                };
            }
        }
        return { x: 0.5, y: 0.5, scale: 1 };
    }, [keyframes]);

    // Update crop position based on current time
    useEffect(() => {
        if (!isPlaying) { // Only manual update if playing manages it
            const interp = getInterpolatedCrop(currentTime);
            // Only update from interpolation if we have keyframes. 
            // Otherwise let user drag freely for initial setup.
            if (keyframes.length > 0) {
                setCropPosition({ x: interp.x, y: interp.y });
                setScale(interp.scale);
            }
        }
    }, [currentTime, isPlaying, getInterpolatedCrop, keyframes.length]);

    const playbackLoop = (timestamp: number) => {
        if (lastTimeRef.current === undefined) lastTimeRef.current = timestamp;
        const delta = (timestamp - lastTimeRef.current) / 1000;
        lastTimeRef.current = timestamp;

        if (videoRef.current) {
            // Sync our time state with video time (clip relative)
            const vidTime = videoRef.current.currentTime;
            const relTime = vidTime - clip.sourceStart;

            if (relTime >= clipDuration) {
                setIsPlaying(false);
                videoRef.current.pause();
                setCurrentTime(clipDuration);
            } else {
                setCurrentTime(relTime);
                const interp = getInterpolatedCrop(relTime);
                setCropPosition({ x: interp.x, y: interp.y });
                setScale(interp.scale);
                animationFrameRef.current = requestAnimationFrame(playbackLoop);
            }
        }
    };

    useEffect(() => {
        if (isPlaying) {
            lastTimeRef.current = undefined;
            videoRef.current?.play();
            animationFrameRef.current = requestAnimationFrame(playbackLoop);
        } else {
            videoRef.current?.pause();
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        }
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isPlaying, clip.sourceStart, clipDuration, getInterpolatedCrop]);

    // Sync video element to start time initially
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.currentTime = clip.sourceStart + currentTime;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Init only

    // Helper to get video metrics
    const getVideoMetrics = () => {
        const video = videoRef.current;
        const container = containerRef.current;
        if (!video || !container) return null;

        const videoRatio = video.videoWidth / video.videoHeight;
        const containerRatio = container.clientWidth / container.clientHeight;

        let renderedWidth, renderedHeight, offsetLeft, offsetTop;

        if (videoRatio > containerRatio) {
            // Video is wider than container (fit width)
            renderedWidth = container.clientWidth;
            renderedHeight = renderedWidth / videoRatio;
            offsetLeft = 0;
            offsetTop = (container.clientHeight - renderedHeight) / 2;
        } else {
            // Video is taller than container (fit height)
            renderedHeight = container.clientHeight;
            renderedWidth = renderedHeight * videoRatio;
            offsetTop = 0;
            offsetLeft = (container.clientWidth - renderedWidth) / 2;
        }

        return { renderedWidth, renderedHeight, offsetLeft, offsetTop };
    };

    // Handle focus point selection
    const handleFocusPointSelection = (e: React.MouseEvent<HTMLDivElement>) => {
        if (trackingMode !== 'ai') return;

        e.preventDefault();
        const metrics = getVideoMetrics();
        if (!metrics) return;

        const { renderedWidth, renderedHeight, offsetLeft, offsetTop } = metrics;
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        const clickX = e.clientX - containerRect.left - offsetLeft;
        const clickY = e.clientY - containerRect.top - offsetTop;

        // Check if click is within video bounds
        if (clickX < 0 || clickX > renderedWidth || clickY < 0 || clickY > renderedHeight) return;

        // Convert to normalized coordinates relative to VIDEO
        const normalizedX = clickX / renderedWidth;
        const normalizedY = clickY / renderedHeight;

        setFocusPoint({ x: normalizedX, y: normalizedY });
        setShowFocusPoint(true);

        console.log('🎯 Focus point selected:', { x: normalizedX, y: normalizedY });
    };

    const handleStartTracking = async () => {
        if (!focusPoint) {
            alert('Please click on your subject first');
            return;
        }

        if (!trackingServiceRef.current) {
            alert('Tracking service not initialized');
            return;
        }

        setIsTracking(true);
        setTrackingProgress(0);

        try {
            const videoElement = videoRef.current;

            if (!videoElement) {
                throw new Error('Video not loaded');
            }

            const result = await trackingServiceRef.current.trackSubject({
                video: videoElement,
                focusPoint,
                duration: clipDuration,
                progressCallback: (progress) => {
                    setTrackingProgress(progress);
                    const confidence = trackingServiceRef.current?.getLastTrackingConfidence() || 0;
                    setTrackingConfidence(confidence);
                }
            });

            // Convert tracking data
            const newKeyframes: ReframeKeyframe[] = result.map(pos => ({
                time: pos.time,
                x: pos.x,
                y: pos.y,
                scale: pos.scale
            }));

            setKeyframes(prev => {
                const filtered = prev.filter(k =>
                    !newKeyframes.some(nk => Math.abs(nk.time - k.time) < 0.1)
                );
                return [...filtered, ...newKeyframes].sort((a, b) => a.time - b.time);
            });

            setTrackingProgress(1);
            setIsTracking(false);

            const confidence = trackingServiceRef.current?.getLastTrackingConfidence() || 0;
            if (confidence > 0.6) {
                alert('AI tracking completed successfully!');
            } else {
                alert('AI tracking completed, but confidence is low. Manual adjustment may be needed.');
            }

        } catch (error) {
            console.error('❌ AI tracking failed:', error);
            alert('AI tracking failed. Please try again or use manual mode.');
            setIsTracking(false);
        }
    };

    // Clear all keyframes
    const handleClearAll = () => {
        setKeyframes([]);
        setCropPosition({ x: 0.5, y: 0.5 });
        setScale(1);
        setFocusPoint(null);
        setShowFocusPoint(false);
        setTrackingConfidence(null);
    };

    const handleAddKeyframe = () => {
        const newKeyframe: ReframeKeyframe = {
            time: currentTime,
            x: cropPosition.x,
            y: cropPosition.y,
            scale: scale
        };

        setKeyframes(prev => {
            const filtered = prev.filter(k => Math.abs(k.time - currentTime) > 0.1);
            return [...filtered, newKeyframe].sort((a, b) => a.time - b.time);
        });
    };

    // 2D Dragging Logic
    const handleDragCrop = (e: React.MouseEvent<HTMLDivElement>) => {
        if (trackingMode === 'ai') return;

        e.preventDefault();
        const metrics = getVideoMetrics();
        if (!metrics) return;

        const { renderedWidth, renderedHeight } = metrics;

        const startX = e.clientX;
        const startY = e.clientY;
        const startBoxX = cropPosition.x;
        const startBoxY = cropPosition.y;

        const { cropWidth, cropHeight } = getCropBoxDimensions();

        // Calculate bounds (0 to 1 relative to video)
        const minX = cropWidth / 2;
        const maxX = 1 - cropWidth / 2;
        const minY = cropHeight / 2;
        const maxY = 1 - cropHeight / 2;

        const handleMouseMove = (mv: MouseEvent) => {
            const deltaPixelsX = mv.clientX - startX;
            const deltaPixelsY = mv.clientY - startY;

            // Convert pixels to percentage of VIDEO dimensions
            const deltaPercentX = deltaPixelsX / renderedWidth;
            const deltaPercentY = deltaPixelsY / renderedHeight;

            const newX = Math.max(minX, Math.min(maxX, startBoxX + deltaPercentX));
            const newY = Math.max(minY, Math.min(maxY, startBoxY + deltaPercentY));

            setCropPosition({ x: newX, y: newY });
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        setCurrentTime(time);
        if (videoRef.current) {
            videoRef.current.currentTime = clip.sourceStart + time;
        }
        const interp = getInterpolatedCrop(time);
        if (keyframes.length > 0) {
            setCropPosition({ x: interp.x, y: interp.y });
            setScale(interp.scale);
        }
    }

    const handleSaveClick = () => {
        let finalKeyframes = [...keyframes];
        if (finalKeyframes.length === 0) {
            finalKeyframes.push({
                time: 0,
                x: cropPosition.x,
                y: cropPosition.y,
                scale: scale
            });
        }
        onSave(finalKeyframes);
    }

    const getConfidenceColor = (confidence: number) => {
        if (confidence > 0.8) return 'text-green-400';
        if (confidence > 0.6) return 'text-yellow-400';
        return 'text-red-400';
    };

    const getConfidenceDescription = (confidence: number) => {
        if (confidence > 0.8) return 'Excellent tracking';
        if (confidence > 0.6) return 'Good tracking';
        if (confidence > 0.4) return 'Fair tracking';
        return 'Poor tracking - manual adjustment recommended';
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">
                    AI Reframe Tool
                    {trackingMode === 'ai' && <span className="ml-2 text-sm bg-orange-600 px-2 py-1 rounded">AI Mode</span>}
                </h2>
                <div className="space-x-2">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600">Cancel</button>
                    <button onClick={handleSaveClick} className="px-4 py-2 bg-orange-600 rounded hover:bg-orange-500 font-bold">
                        Save Changes ({keyframes.length} keyframes)
                    </button>
                </div>
            </div>

            <div className="mb-4 p-3 bg-gray-800 rounded-lg">
                <h3 className="text-white font-medium mb-2">How to use:</h3>
                <div className="text-sm text-gray-300 space-y-1">
                    <p>• <strong>Blue box</strong> = 9:16 crop region</p>
                    <p>• <strong>Manual Mode</strong>: Drag the box to position. Use <strong>Scale</strong> slider to zoom in/out.</p>
                    <p>• <strong>AI Mode</strong>: Click on subject, then "Start AI Tracking" to auto-track.</p>
                    <p>• <strong>Add Keyframes</strong> to animate position and scale over time.</p>
                </div>
            </div>

            {/* Controls */}
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <div className="flex bg-gray-800 rounded-lg p-1">
                        <button
                            onClick={() => setTrackingMode('manual')}
                            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${trackingMode === 'manual'
                                ? 'bg-gray-600 text-white'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            <AdjustmentsHorizontalIcon className="w-4 h-4 inline mr-2" />
                            Manual
                        </button>
                        <button
                            onClick={() => setTrackingMode('ai')}
                            className={`px-3 py-2 rounded text-sm font-medium transition-colors ${trackingMode === 'ai'
                                ? 'bg-orange-600 text-white'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            <SparklesIcon className="w-4 h-4 inline mr-2" />
                            AI Tracking
                        </button>
                    </div>

                    {trackingMode === 'manual' && (
                        <div className="flex items-center space-x-2 bg-gray-800 px-3 py-2 rounded-lg">
                            <span className="text-sm text-gray-400">Scale:</span>
                            <input
                                type="range"
                                min="1"
                                max="3"
                                step="0.1"
                                value={scale}
                                onChange={(e) => setScale(parseFloat(e.target.value))}
                                className="w-32 accent-orange-500"
                            />
                            <span className="text-sm text-white w-8">{scale.toFixed(1)}x</span>
                        </div>
                    )}

                    {trackingMode === 'ai' && focusPoint && (
                        <button
                            onClick={handleStartTracking}
                            disabled={isTracking}
                            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-orange-600 rounded hover:from-purple-500 hover:to-orange-500 disabled:opacity-50 font-bold text-white"
                        >
                            {isTracking ? (
                                <>
                                    <SparklesIcon className="w-4 h-4 inline mr-2 animate-pulse" />
                                    Tracking...
                                </>
                            ) : (
                                <>
                                    <SparklesIcon className="w-4 h-4 inline mr-2" />
                                    Start AI Tracking
                                </>
                            )}
                        </button>
                    )}
                </div>

                {trackingConfidence && (
                    <div className="text-sm">
                        <span className="text-gray-400">AI Confidence: </span>
                        <span className={getConfidenceColor(trackingConfidence)}>
                            {(trackingConfidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-gray-500 ml-2">
                            {getConfidenceDescription(trackingConfidence)}
                        </span>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            {isTracking && (
                <div className="mb-4 bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center justify-between text-sm text-gray-300 mb-2">
                        <span>Analyzing video frames...</span>
                        <span>{trackingProgress.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                            className="bg-gradient-to-r from-purple-600 to-orange-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${trackingProgress}%` }}
                        />
                    </div>
                </div>
            )}

            <div className="flex-1 flex items-center justify-center overflow-hidden relative bg-gray-900 rounded-lg border border-gray-700">
                <div
                    ref={containerRef}
                    className="relative aspect-video h-full max-w-full bg-black overflow-hidden"
                    onClick={handleFocusPointSelection}
                >
                    <video
                        ref={videoRef}
                        src={clip.processedVideoUrl || mediaFile.url}
                        className="w-full h-full object-contain pointer-events-none"
                        muted
                    />

                    {trackingMode === 'ai' && showFocusPoint && focusPoint && (
                        (() => {
                            const metrics = getVideoMetrics();
                            if (!metrics) return null;
                            const { renderedWidth, renderedHeight, offsetLeft, offsetTop } = metrics;

                            return (
                                <div
                                    className="absolute w-4 h-4 bg-purple-500 rounded-full border-2 border-white shadow-lg animate-pulse z-10"
                                    style={{
                                        left: offsetLeft + (focusPoint.x * renderedWidth),
                                        top: offsetTop + (focusPoint.y * renderedHeight),
                                        transform: 'translate(-50%, -50%)'
                                    }}
                                    title="Selected focus point"
                                />
                            );
                        })()
                    )}

                    {trackingMode === 'ai' && !focusPoint && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                            <div className="bg-purple-600/90 text-white p-4 rounded-lg text-center max-w-sm">
                                <SparklesIcon className="w-8 h-8 mx-auto mb-2" />
                                <p className="font-semibold">Click on the subject you want to track</p>
                                <p className="text-sm text-purple-200 mt-1">
                                    AI will automatically follow this subject
                                </p>
                            </div>
                        </div>
                    )}

                    {(() => {
                        const metrics = getVideoMetrics();
                        if (!metrics) return null;
                        const { renderedWidth, renderedHeight, offsetLeft, offsetTop } = metrics;

                        const { cropWidth, cropHeight } = getCropBoxDimensions();

                        // Convert normalized video coordinates to container pixels
                        const displayLeft = offsetLeft + (cropPosition.x - cropWidth / 2) * renderedWidth;
                        const displayTop = offsetTop + (cropPosition.y - cropHeight / 2) * renderedHeight;
                        const displayWidth = cropWidth * renderedWidth;
                        const displayHeight = cropHeight * renderedHeight;

                        return (
                            <div
                                className={`absolute border-4 shadow-[0_0_0_9999px_rgba(0,0,0,0.8)] cursor-move flex items-center justify-center group ${trackingMode === 'ai'
                                    ? 'border-purple-400 cursor-default shadow-purple-500/50'
                                    : 'border-blue-400 shadow-blue-400/50'
                                    }`}
                                onMouseDown={handleDragCrop}
                                style={{
                                    left: displayLeft,
                                    top: displayTop,
                                    width: displayWidth,
                                    height: displayHeight,
                                    borderStyle: 'dashed'
                                }}
                            >
                                {/* Corner indicators */}
                                <div className={`absolute -top-2 -left-2 w-4 h-4 border-2 ${trackingMode === 'ai' ? 'border-purple-400' : 'border-blue-400'
                                    }`}>
                                    <div className={`w-full h-full ${trackingMode === 'ai' ? 'border-l-2 border-t-2 border-purple-400' : 'border-l-2 border-t-2 border-blue-400'
                                        }`}></div>
                                </div>
                                <div className={`absolute -top-2 -right-2 w-4 h-4 border-2 ${trackingMode === 'ai' ? 'border-purple-400' : 'border-blue-400'
                                    }`}>
                                    <div className={`w-full h-full ${trackingMode === 'ai' ? 'border-r-2 border-t-2 border-purple-400' : 'border-r-2 border-t-2 border-blue-400'
                                        }`}></div>
                                </div>
                                <div className={`absolute -bottom-2 -left-2 w-4 h-4 border-2 ${trackingMode === 'ai' ? 'border-purple-400' : 'border-blue-400'
                                    }`}>
                                    <div className={`w-full h-full ${trackingMode === 'ai' ? 'border-l-2 border-b-2 border-purple-400' : 'border-l-2 border-b-2 border-blue-400'
                                        }`}></div>
                                </div>
                                <div className={`absolute -bottom-2 -right-2 w-4 h-4 border-2 ${trackingMode === 'ai' ? 'border-purple-400' : 'border-blue-400'
                                    }`}>
                                    <div className={`w-full h-full ${trackingMode === 'ai' ? 'border-r-2 border-b-2 border-purple-400' : 'border-r-2 border-b-2 border-blue-400'
                                        }`}></div>
                                </div>

                                <div className={`absolute top-1 left-1 text-xs font-bold px-2 py-1 rounded ${trackingMode === 'ai'
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-blue-600 text-white'
                                    }`}>
                                    📱 9:16
                                </div>

                                <div className={`w-3 h-3 rounded-full border-2 border-white ${trackingMode === 'ai' ? 'bg-purple-500' : 'bg-blue-500'
                                    }`} />

                                <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 bg-black/80 text-white text-xs px-2 py-1 rounded pointer-events-none">
                                    {trackingMode === 'ai' ? '🤖 AI Tracking Active' : '✋ Drag to reframe'}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>

            <div className="h-32 bg-gray-800 mt-4 rounded-lg p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
                    <span>{(currentTime).toFixed(2)}s</span>
                    <div className="flex items-center space-x-4">
                        <span>Keyframes: {keyframes.length}</span>
                        {trackingMode === 'manual' && (
                            <button
                                onClick={handleAddKeyframe}
                                className="flex items-center px-3 py-2 bg-orange-600 rounded hover:bg-orange-500 text-white text-sm"
                            >
                                <div className="w-3 h-3 bg-white rotate-45 mr-2" />
                                Add Keyframe
                            </button>
                        )}
                        <button
                            onClick={handleClearAll}
                            className="text-red-400 hover:text-red-300"
                        >
                            Clear All
                        </button>
                    </div>
                </div>

                <div className="flex items-center space-x-4">
                    <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="p-2 bg-gray-700 rounded-full hover:bg-gray-600"
                    >
                        {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
                    </button>

                    <input
                        type="range"
                        min={0}
                        max={clipDuration}
                        step={0.05}
                        value={currentTime}
                        onChange={handleSeek}
                        className="flex-1 accent-orange-500"
                    />
                </div>

                <div className="relative h-4 bg-gray-700 mt-2 rounded overflow-hidden">
                    {keyframes.map((kf, idx) => (
                        <div
                            key={idx}
                            className={`absolute top-0 bottom-0 w-1 ${trackingMode === 'ai' ? 'bg-purple-500' : 'bg-orange-500'
                                }`}
                            style={{ left: `${(kf.time / clipDuration) * 100}%` }}
                            title={`Keyframe at ${kf.time.toFixed(2)}s`}
                        />
                    ))}
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white"
                        style={{ left: `${(currentTime / clipDuration) * 100}%` }}
                    />
                </div>
            </div>
        </div>
    );
};