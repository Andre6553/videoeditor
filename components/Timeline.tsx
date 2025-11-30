import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { PlayIcon, PauseIcon, ScissorsIcon, MuteIcon, UnmuteIcon, FilmIcon, MusicIcon, TrashIcon, SkipStartIcon, SkipEndIcon, MagnetIcon, CropIcon, UndoIcon, RedoIcon } from './Icons';
import { Tooltip } from './Tooltip';
import { AudioWaveform } from './AudioWaveform';
import { convertFps } from '../services/ffmpegService';
import type { Track, Clip, MediaFile, SelectedClip, DragState, TransitionType, TemplateMarker, Template } from '../types';

interface TimelineProps {
  mediaFiles: MediaFile[];
  videoTracks: Track[];
  audioTracks: Track[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  selectedClip: SelectedClip | null;
  dragState: DragState;
  isMagnetMode: boolean;
  onClipDurationChange?: (trackId: string, clipId: string, newDuration: number) => void;
  onSetDragState: (state: DragState) => void;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onMuteToggle: (trackId: string, type: 'video' | 'audio') => void;
  onVolumeChange: (trackId: string, volume: number, type: 'video' | 'audio') => void;
  onCut: (trackId?: string, clipId?: string) => void;
  onDeleteClip: () => void;
  onClipUpdate: (trackId: string, clipId: string, updates: Partial<Clip>) => void;
  onSetSelectedClip: (selection: SelectedClip | null) => void;
  onAddClip: (mediaFileId: string, trackId: string, timelineStart: number) => void;
  onMoveClip: (clipId: string, sourceTrackId: string, targetTrackId: string, newTimelineStart: number) => void;
  onJumpToStart: () => void;
  onJumpToEnd: () => void;
  onToggleMagnetMode: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
  onApplyTransition: (trackId: string, clipId: string, type: TransitionType, location: 'start' | 'end') => void;
  onRemoveTransition: (trackId: string, clipId: string, location: 'start' | 'end') => void;
  onOpenTransitionDurationModal: (trackId: string, clipId: string) => void;
  onOpenReframeModal: (trackId: string, clipId: string) => void;
  onClipMuteToggle: (trackId: string, clipId: string) => void;
  onAnalyzeBeats: (trackId: string, clipId: string) => void;
  selectedClips: SelectedClip[];
  onSetSelectedClips: (clips: SelectedClip[]) => void;
  activeTrackId: string | null;
  onSetActiveTrackId: (trackId: string | null) => void;
  onMergeClips: () => void;
  templateMarkers: TemplateMarker[];
  onAddTemplateMarker: (time: number, templateId: string) => void;
  onUpdateTemplateMarker: (markerId: string, newTemplateId: string) => void;
  onUpdateTemplateMarkerTime: (markerId: string, newTime: number) => void;
  onDeleteTemplateMarker: (markerId: string) => void;
  currentTemplate: Template;
}

const formatTime = (time: number): string => {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  const milliseconds = Math.floor((time - Math.floor(time)) * 100);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')} `;
};

const SNAP_THRESHOLD = 0.3;
const ZERO_SNAP_THRESHOLD = 0.5;
const PIXELS_PER_SECOND = 60; // Fixed width per second to enable scrolling

// Helper function to calculate snapped time
const calculateSnap = (
  proposedTime: number,
  duration: number,
  track: Track,
  allTracks: Track[],
  currentClipId: string | null,
  clipDuration: number,
  currentTime?: number // Add playhead position
): { time: number; snapped: boolean } => {
  let timelineStart = proposedTime;
  let snapped = false;

  if (Math.abs(timelineStart) < ZERO_SNAP_THRESHOLD) {
    return { time: 0, snapped: true };
  }

  // ALWAYS snap to playhead (white ruler) if close - regardless of magnetic mode
  if (currentTime !== undefined) {
    const clipEndTime = timelineStart + clipDuration;

    // Snap clip start to playhead
    if (Math.abs(timelineStart - currentTime) < SNAP_THRESHOLD) {
      return { time: currentTime, snapped: true };
    }

    // Snap clip end to playhead
    if (Math.abs(clipEndTime - currentTime) < SNAP_THRESHOLD) {
      return { time: currentTime - clipDuration, snapped: true };
    }
  }

  const otherClips = track.clips.filter(c => c.id !== currentClipId);
  const clipEndTime = timelineStart + clipDuration;

  for (const otherClip of otherClips) {
    const otherClipDuration = otherClip.sourceEnd - otherClip.sourceStart;
    const otherClipEndTime = otherClip.timelineStart + otherClipDuration;

    if (Math.abs(timelineStart - otherClipEndTime) < SNAP_THRESHOLD) { return { time: otherClipEndTime, snapped: true }; }
    if (Math.abs(timelineStart - otherClip.timelineStart) < SNAP_THRESHOLD) { return { time: otherClip.timelineStart, snapped: true }; }
    if (Math.abs(clipEndTime - otherClip.timelineStart) < SNAP_THRESHOLD) { return { time: otherClip.timelineStart - clipDuration, snapped: true }; }
    if (Math.abs(clipEndTime - otherClipEndTime) < SNAP_THRESHOLD) { return { time: otherClipEndTime - clipDuration, snapped: true }; }
  }

  return { time: Math.max(0, timelineStart), snapped };
};

const getClipDuration = (clip: Clip) => {
  return (clip.sourceEnd - clip.sourceStart) / (clip.speed || 1);
};


const ClipUI: React.FC<{
  clip: Clip;
  track: Track;
  mediaFile: MediaFile | undefined;
  duration: number;
  timelineWidth: number;
  isSelected: boolean;
  onClipUpdate: TimelineProps['onClipUpdate'];
  onSelect: (e: React.MouseEvent) => void;
  onSetDragState: (state: DragState) => void;
  dragState: DragState;
  onApplyTransition: TimelineProps['onApplyTransition'];
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  onSeekToMouse: (clientX: number) => void;
}> = ({ clip, track, mediaFile, duration, timelineWidth, isSelected, onClipUpdate, onSelect, onSetDragState, dragState, onApplyTransition, onContextMenu, onSeekToMouse }) => {
  const [dragMode, setDragMode] = useState<'trimLeft' | 'trimRight' | null>(null);
  const dragStartRef = useRef({ x: 0, clipStart: 0, sourceStart: 0, sourceEnd: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [transitionDropZone, setTransitionDropZone] = useState<'start' | 'end' | null>(null);
  const clipRef = useRef<HTMLDivElement>(null);

  const pixelsPerSecond = timelineWidth / duration;

  const handleTrimMouseDown = (e: React.MouseEvent<HTMLDivElement>, mode: 'trimLeft' | 'trimRight') => {
    e.stopPropagation();
    e.preventDefault();
    setDragMode(mode);
    onSelect(e);
    dragStartRef.current = {
      x: e.clientX,
      clipStart: clip.timelineStart,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
    };
    document.body.style.cursor = 'ew-resize';
  };

  const handleTrimMouseMove = useCallback((e: MouseEvent) => {
    if (!dragMode) return;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaTime = deltaX / pixelsPerSecond;

    if (dragMode === 'trimRight') {
      const newSourceEnd = dragStartRef.current.sourceEnd + deltaTime;
      onClipUpdate(track.id, clip.id, { sourceEnd: newSourceEnd });

    } else if (dragMode === 'trimLeft') {
      const newSourceStart = dragStartRef.current.sourceStart + deltaTime;
      const newTimelineStart = dragStartRef.current.clipStart + deltaTime;
      onClipUpdate(track.id, clip.id, { timelineStart: newTimelineStart, sourceStart: newSourceStart });
    }

  }, [dragMode, pixelsPerSecond, onClipUpdate, track.id, clip.id]);

  const handleTrimMouseUp = useCallback(() => {
    setDragMode(null);
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    if (dragMode) {
      document.addEventListener('mousemove', handleTrimMouseMove);
      document.addEventListener('mouseup', handleTrimMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleTrimMouseMove);
      document.removeEventListener('mouseup', handleTrimMouseUp);
    };
  }, [dragMode, handleTrimMouseMove, handleTrimMouseUp]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Standard Data Transfer
    e.dataTransfer.setData('move-clip-id', clip.id);
    e.dataTransfer.setData('source-track-id', track.id);
    e.dataTransfer.effectAllowed = 'move';

    const clipRect = e.currentTarget.getBoundingClientRect();
    const offset = e.clientX - clipRect.left;
    e.dataTransfer.setData('drag-offset-x', offset.toString());

    // Global Drag State
    onSetDragState({
      isDragging: true,
      type: 'move',
      mediaType: mediaFile?.type || null,
      id: clip.id,
      sourceTrackId: track.id,
      dragOffsetX: offset
    });

    setTimeout(() => setIsDragging(true), 0);
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsDragging(false);
    onSetDragState({
      isDragging: false,
      type: null,
      mediaType: null,
      id: null,
      sourceTrackId: null,
      dragOffsetX: 0
    });
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (dragState.type === 'transition' && clipRef.current && dragState.transitionType) {
      // Check if transition type is compatible with track type
      const isAudioTransition = dragState.transitionType === 'fade-in' || dragState.transitionType === 'fade-out';
      const isAudioTrack = track.type === 'audio';

      // Only allow audio transitions on audio tracks and video transitions on video tracks
      if (isAudioTransition !== isAudioTrack) {
        return; // Don't allow drop
      }

      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';

      const rect = clipRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;

      if (x < width * 0.3) {
        setTransitionDropZone('start');
      } else if (x > width * 0.7) {
        setTransitionDropZone('end');
      } else {
        setTransitionDropZone(null);
      }
    }
  }

  const handleDragLeave = () => {
    setTransitionDropZone(null);
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (dragState.type === 'transition' && dragState.transitionType && transitionDropZone) {
      e.preventDefault();
      e.stopPropagation();
      onApplyTransition(track.id, clip.id, dragState.transitionType, transitionDropZone);
      setTransitionDropZone(null);
    }
  }

  const clipDuration = getClipDuration(clip);
  const left = (clip.timelineStart / duration) * 100;
  const width = (clipDuration / duration) * 100;

  const clipColor = mediaFile?.type === 'video' ? 'bg-orange-500/50 border-orange-400'
    : mediaFile?.type === 'audio' ? 'bg-black border-teal-400'
      : 'bg-indigo-500/50 border-indigo-400';

  const handleColor = mediaFile?.type === 'video' ? 'bg-orange-400'
    : mediaFile?.type === 'audio' ? 'bg-teal-400'
      : 'bg-indigo-400';

  const selectedStyle = isSelected ? 'ring-2 ring-offset-2 ring-offset-gray-700 ring-white' : 'border-2';
  const draggingStyle = isDragging ? 'opacity-50' : '';

  return (
    <div
      ref={clipRef}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={(e) => { e.stopPropagation(); onSelect(e); onSeekToMouse(e.clientX); }}
      onContextMenu={onContextMenu}
      className={`absolute rounded-md cursor-grab active:cursor-grabbing transition-shadow ${mediaFile?.type === 'audio' ? 'inset-y-2' : 'top-1/2 -translate-y-1/2 h-10'
        } ${clipColor} ${selectedStyle} ${draggingStyle}`}
      style={{ left: `${left}%`, width: `${width}%`, minWidth: '10px' }}
    >
      {/* Transition Drop Zones Highlights */}
      {transitionDropZone === 'start' && <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-purple-500/50 z-10 rounded-l-md pointer-events-none" />}
      {transitionDropZone === 'end' && <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-purple-500/50 z-10 rounded-r-md pointer-events-none" />}

      {/* Active Transition Indicators */}
      {clip.transitionStart && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-4 rounded-l-sm z-0 ${clip.transitionStart.type === 'fade-in'
            ? 'bg-gradient-to-r from-teal-500 to-transparent'
            : 'bg-gradient-to-r from-purple-500 to-transparent'
            }`}
          title={`Start: ${clip.transitionStart.type}`}
        />
      )}
      {clip.transitionEnd && (
        <div
          className={`absolute right-0 top-0 bottom-0 w-4 rounded-r-sm z-0 ${clip.transitionEnd.type === 'fade-out'
            ? 'bg-gradient-to-l from-teal-500 to-transparent'
            : 'bg-gradient-to-l from-purple-500 to-transparent'
            }`}
          title={`End: ${clip.transitionEnd.type}`}
        />
      )}

      {/* Muted Clip Indicator */}
      {clip.isMuted && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/60 rounded-md z-10 pointer-events-none">
          <MuteIcon className="w-5 h-5 text-gray-300" />
        </div>
      )}

      {/* Audio Waveform */}
      {mediaFile?.type === 'audio' && (
        <div className="absolute inset-0 z-0 opacity-50">
          <AudioWaveform
            url={mediaFile.url}
            sourceStart={clip.sourceStart}
            sourceEnd={clip.sourceEnd}
            color="#39ff14" // Bright Green
            beats={clip.beats}
            transitionStart={clip.transitionStart}
            transitionEnd={clip.transitionEnd}
            clipVolume={clip.volume ?? 1.0}
            onVolumeChange={(newVolume) => onClipUpdate(track.id, clip.id, { volume: newVolume })}
          />
        </div>
      )}

      {/* Processing Indicator */}
      {clip.processingStatus === 'processing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-md z-30 pointer-events-none">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-orange-500 mb-1"></div>
            <span className="text-[10px] text-white font-mono">{Math.round((clip.processingProgress || 0) * 100)}%</span>
          </div>
        </div>
      )}

      <div
        onMouseDown={(e) => handleTrimMouseDown(e, 'trimLeft')}
        className={`absolute left - 0 top - 0 h - full w - 2 rounded - l - sm cursor - ew - resize ${handleColor} z - 20`}
      />
      <div
        onMouseDown={(e) => handleTrimMouseDown(e, 'trimRight')}
        className={`absolute right - 0 top - 0 h - full w - 2 rounded - r - sm cursor - ew - resize ${handleColor} z - 20`}
      />

      {/* Fade-in handle at START of clip */}
      {mediaFile?.type === 'audio' && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const startX = e.clientX;
            const startDuration = clip.transitionStart?.type === 'fade-in' ? clip.transitionStart.duration : 0;
            const clipRect = clipRef.current!.getBoundingClientRect();

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const deltaX = moveEvent.clientX - startX;
              const deltaTime = (deltaX / clipRect.width) * clipDuration;
              const newDuration = Math.max(0, Math.min(clipDuration / 2, startDuration + deltaTime));

              if (newDuration < 0.1) {
                onClipUpdate(track.id, clip.id, { transitionStart: undefined });
              } else {
                onClipUpdate(track.id, clip.id, {
                  transitionStart: { type: 'fade-in', duration: newDuration }
                });
              }
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
              document.body.style.cursor = 'default';
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'ew-resize';
          }}
          className="absolute top-0 w-4 h-4 -ml-2 bg-white border-2 border-teal-500 rounded-full cursor-ew-resize z-40 shadow-lg hover:scale-125 transition-transform flex items-center justify-center"
          style={{ left: `${((clip.transitionStart?.type === 'fade-in' ? clip.transitionStart.duration : 0) / clipDuration) * 100}% ` }}
          title="Drag to adjust Fade In"
        >
          <div className="w-1 h-1 bg-teal-500 rounded-full" />
        </div>
      )}



      {/* Fade-out handle at END of clip */}
      {mediaFile?.type === 'audio' && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const startX = e.clientX;
            const startDuration = clip.transitionEnd?.type === 'fade-out' ? clip.transitionEnd.duration : 0;
            const clipRect = clipRef.current!.getBoundingClientRect();

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const deltaX = moveEvent.clientX - startX;
              const deltaTime = (deltaX / clipRect.width) * clipDuration;
              // Dragging left (negative delta) increases duration for end transition
              const newDuration = Math.max(0, Math.min(clipDuration / 2, startDuration - deltaTime));

              if (newDuration < 0.1) {
                onClipUpdate(track.id, clip.id, { transitionEnd: undefined });
              } else {
                onClipUpdate(track.id, clip.id, {
                  transitionEnd: { type: 'fade-out', duration: newDuration }
                });
              }
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
              document.body.style.cursor = 'default';
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'ew-resize';
          }}
          className="absolute top-0 w-4 h-4 -ml-2 bg-white border-2 border-teal-500 rounded-full cursor-ew-resize z-40 shadow-lg hover:scale-125 transition-transform flex items-center justify-center"
          style={{ left: `${((clipDuration - (clip.transitionEnd?.type === 'fade-out' ? clip.transitionEnd.duration : 0)) / clipDuration) * 100}% ` }}
          title="Drag to adjust Fade Out"
        >
          <div className="w-1 h-1 bg-teal-500 rounded-full" />
        </div>
      )}



    </div>
  );
};

const TrackLane: React.FC<{
  track: Track;
  allTracks: Track[];
  mediaFiles: MediaFile[];
  duration: number;
  selectedClip: SelectedClip | null;
  onMuteToggle: () => void;
  onVolumeChange: (val: number) => void;
  name: string;
  icon: React.ReactNode;
  timelineWidth: number;
  dragState: DragState;
  onClipUpdate: TimelineProps['onClipUpdate'];
  onSnap: (position: number | null) => void;
  onSetSelectedClip: TimelineProps['onSetSelectedClip'];
  onAddClip: TimelineProps['onAddClip'];
  onMoveClip: TimelineProps['onMoveClip'];
  onSetDragState: (state: DragState) => void;
  onApplyTransition: TimelineProps['onApplyTransition'];
  onClipContextMenu: (e: React.MouseEvent<HTMLDivElement>, clipId: string) => void;
  onSeekToMouse: (clientX: number) => void;
  selectedClips: SelectedClip[];
  onSetSelectedClips: (clips: SelectedClip[]) => void;
  templateMarkers: TemplateMarker[];
  onAddTemplateMarker: (time: number, templateId: string) => void;
  onUpdateTemplateMarker: (markerId: string, newTemplateId: string) => void;
  onDeleteTemplateMarker: (markerId: string) => void;
  currentTime: number;
}> = ({ track, allTracks, mediaFiles, duration, onMuteToggle, onVolumeChange, name, icon, timelineWidth, onClipUpdate, onSnap, selectedClip, onSetSelectedClip, onAddClip, onMoveClip, dragState, onSetDragState, onApplyTransition, onClipContextMenu, onSeekToMouse, selectedClips, onSetSelectedClips, templateMarkers, onAddTemplateMarker, onUpdateTemplateMarker, onDeleteTemplateMarker, currentTime }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [trackHeight, setTrackHeight] = useState(64); // Default 64px (h-16)
  const trackLaneRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    if (!dragState.isDragging || !trackLaneRef.current) return;

    // Allow transition drop logic to bubble down to clips if hovering over them
    if (dragState.type === 'transition') return;

    let isCompatible = false;
    const mediaType = dragState.mediaType;

    if (dragState.type === 'new') {
      isCompatible = (track.type === 'video' && (mediaType === 'video' || mediaType === 'image')) ||
        (track.type === 'audio' && mediaType === 'audio');
    } else if (dragState.type === 'move') {
      const sourceTrack = allTracks.find(t => t.id === dragState.sourceTrackId);
      isCompatible = sourceTrack?.type === track.type;
    }

    if (isCompatible) {
      e.dataTransfer.dropEffect = dragState.type === 'new' ? 'copy' : 'move';
      setIsDragOver(true);

      // --- Dynamic Snap Visuals during Drag ---
      const rect = trackLaneRef.current.getBoundingClientRect();
      const dropX = e.clientX - rect.left;
      const dragOffsetX = dragState.dragOffsetX;
      const rawTimelineStart = ((dropX - dragOffsetX) / rect.width) * duration;

      let currentDuration = 0;
      if (dragState.type === 'new') {
        const mediaFile = mediaFiles.find(mf => mf.id === dragState.id);
        if (mediaFile) currentDuration = mediaFile.duration;
      } else {
        const clip = allTracks.flatMap(t => t.clips).find(c => c.id === dragState.id);
        if (clip) currentDuration = getClipDuration(clip);
      }

      const { time, snapped } = calculateSnap(rawTimelineStart, duration, track, allTracks, dragState.id, currentDuration, currentTime);

      if (snapped) {
        onSnap(time);
      } else {
        onSnap(null);
      }

    } else {
      e.dataTransfer.dropEffect = 'none';
      setIsDragOver(false);
      onSnap(null);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
    onSnap(null);
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    onSnap(null);

    // If dropping a transition, we let the ClipUI handle it if it was dropped on a clip.
    // But if dropped on empty track space, we do nothing.
    if (dragState.type === 'transition') return;

    if (!trackLaneRef.current || !dragState.isDragging) return;

    const rect = trackLaneRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left;

    const dragOffsetX = dragState.dragOffsetX;
    const timelineStartRaw = ((dropX - dragOffsetX) / rect.width) * duration;

    // --- Snapping Logic on Drop ---
    let currentDuration = 0;
    if (dragState.type === 'new') {
      const mediaFile = mediaFiles.find(mf => mf.id === dragState.id);
      if (mediaFile) currentDuration = mediaFile.duration;
    } else {
      const clip = allTracks.flatMap(t => t.clips).find(c => c.id === dragState.id);
      if (clip) currentDuration = getClipDuration(clip);
    }
    const { time: snappedTime } = calculateSnap(timelineStartRaw, duration, track, allTracks, dragState.id, currentDuration, currentTime);
    // If the target track has no clips, force start at 0
    const timelineStart = track.clips.length === 0 ? 0 : snappedTime;
    // --- End Snapping Logic ---

    if (dragState.type === 'new' && dragState.id) {
      onAddClip(dragState.id, track.id, timelineStart);
    } else if (dragState.type === 'move' && dragState.id && dragState.sourceTrackId) {
      if (dragState.sourceTrackId === track.id) {
        onClipUpdate(track.id, dragState.id, { timelineStart });
      } else {
        onMoveClip(dragState.id, dragState.sourceTrackId, track.id, timelineStart);
      }
    }
  };


  return (
    <div className="flex items-center space-x-2">
      <div className="w-32 bg-gray-900 p-2 rounded-l-lg flex flex-col justify-center self-stretch sticky left-0 z-20 border-r border-gray-800 shadow-xl flex-shrink-0">
        <div className="flex items-center font-semibold text-sm truncate mb-2">
          {icon} {name}
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={onMuteToggle} className="text-gray-400 hover:text-white focus:outline-none">
            {track.isMuted ? <MuteIcon className="w-5 h-5" /> : <UnmuteIcon className="w-5 h-5" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={track.volume ?? 1}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            title={`Volume: ${Math.round((track.volume ?? 1) * 100)}% `}
          />
        </div>
      </div>
      <div
        ref={trackLaneRef}
        onClick={(e) => onSeekToMouse(e.clientX)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ width: `${timelineWidth}px`, height: `${trackHeight}px` }}
        className={`bg-gray-700/50 rounded-r-lg relative overflow-hidden transition-all border-2 box-border flex-shrink-0 ${isDragOver ? 'border-orange-500' : 'border-transparent'}`}
      >
        {track.clips.map(clip => (
          <ClipUI
            key={clip.id}
            clip={clip}
            track={track}
            mediaFile={mediaFiles.find(mf => mf.id === clip.mediaFileId)}
            duration={duration}
            timelineWidth={timelineWidth}
            isSelected={selectedClips.some(sc => sc.clipId === clip.id && sc.trackId === track.id)}
            onClipUpdate={onClipUpdate}
            onSelect={(e) => {
              const isMultiSelect = e.ctrlKey || e.metaKey;
              const isSelected = selectedClips.some(sc => sc.clipId === clip.id && sc.trackId === track.id);

              if (isMultiSelect) {
                if (isSelected) {
                  onSetSelectedClips(selectedClips.filter(sc => sc.clipId !== clip.id));
                } else {
                  onSetSelectedClips([...selectedClips, { trackId: track.id, clipId: clip.id }]);
                }
                // When multi-selecting, we might want to clear the single selectedClip or keep the last one
                onSetSelectedClip({ trackId: track.id, clipId: clip.id });
              } else {
                onSetSelectedClips([{ trackId: track.id, clipId: clip.id }]);
                onSetSelectedClip({ trackId: track.id, clipId: clip.id });
              }
            }}
            onSetDragState={onSetDragState}
            dragState={dragState}
            onApplyTransition={onApplyTransition}
            onContextMenu={(e) => onClipContextMenu(e, clip.id)}
            onSeekToMouse={onSeekToMouse}
          />
        ))}

        {/* Resize handle for audio tracks */}
        {track.type === 'audio' && (
          <div
            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-transparent hover:bg-teal-500/30 transition-colors z-30 group"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const startY = e.clientY;
              const startHeight = trackHeight;

              const handleMouseMove = (moveEvent: MouseEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const newHeight = Math.max(64, Math.min(400, startHeight + deltaY)); // Min 64px (h-16), max 400px
                setTrackHeight(newHeight);
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
          >
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
    </div>
  );
};

const ClipDurationInput: React.FC<{
  duration: number;
  onChange: (newDuration: number) => void;
}> = ({ duration, onChange }) => {
  const [value, setValue] = useState(duration.toFixed(2));

  useEffect(() => {
    setValue(duration.toFixed(2));
  }, [duration]);

  const handleBlur = () => {
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed > 0) {
      onChange(parsed);
      setValue(parsed.toFixed(2));
    } else {
      setValue(duration.toFixed(2));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="number"
      step="0.1"
      min="0.1"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="w-20 px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs font-mono text-center text-white focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
    />
  );
};

export function Timeline(props: TimelineProps) {
  const {
    mediaFiles, videoTracks, audioTracks, currentTime, duration, isPlaying, selectedClip, dragState, isMagnetMode,
    onSetDragState, onPlayPause, onSeek, onMuteToggle, onVolumeChange, onCut, onDeleteClip, onClipUpdate,
    onSetSelectedClip, onAddClip, onMoveClip, onJumpToStart, onJumpToEnd, onToggleMagnetMode, onApplyTransition,
    onRemoveTransition, onOpenTransitionDurationModal, onOpenReframeModal, onClipMuteToggle, onAnalyzeBeats,
    selectedClips, onSetSelectedClips, onMergeClips, activeTrackId, onSetActiveTrackId,
    templateMarkers, onAddTemplateMarker, onUpdateTemplateMarker, onDeleteTemplateMarker,
    currentTemplate, onUndo, canUndo, onRedo, canRedo
  } = props;

  const allTracks = useMemo(() => [...videoTracks, ...audioTracks], [videoTracks, audioTracks]);
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [snapLinePosition, setSnapLinePosition] = useState<number | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, trackId: string, clipId: string } | null>(null);
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const resizeObserver = new ResizeObserver(entries => {
        if (entries[0]) {
          setContainerWidth(entries[0].contentRect.width);
        }
      });
      resizeObserver.observe(scrollContainerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll logic - keep playhead visible at all times
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const playheadOffset = 136; // 128px header + 8px margin
      const playheadX = playheadOffset + (currentTime * PIXELS_PER_SECOND);

      const { scrollLeft, clientWidth } = container;
      const rightEdge = scrollLeft + clientWidth;

      // Auto-scroll when playhead goes out of view
      if (playheadX > rightEdge - 20) {
        // Move scroll to keep playhead visible with some margin
        container.scrollLeft = playheadX - clientWidth + 150;
      } else if (playheadX < scrollLeft + playheadOffset) {
        // Handle jumping back
        container.scrollLeft = Math.max(0, playheadX - playheadOffset - 20);
      }
    }
  }, [currentTime]);

  // Calculate explicit timeline width based on duration and pixels per second
  // Ensure it fits at least the screen (minus header) or extends if needed
  // Header (128px) + gap (8px) + padding approx = 150px
  const availableTrackWidth = Math.max(0, containerWidth - 150);
  const requiredWidth = duration * PIXELS_PER_SECOND;
  const timelineWidth = Math.max(availableTrackWidth, requiredWidth);

  const handleSeekInteraction = useCallback((e: React.MouseEvent<HTMLDivElement> | globalThis.MouseEvent) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(percentage * duration);
  }, [duration, onSeek]);

  const seekToMouse = useCallback((clientX: number) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const time = (x / rect.width) * duration;
    onSeek(Math.max(0, Math.min(duration, time)));
  }, [duration, onSeek]);

  const handleSeekStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsSeeking(true);
    handleSeekInteraction(e);
    document.body.style.cursor = 'ew-resize';
  };

  const handleSeekMove = useCallback((e: globalThis.MouseEvent) => {
    if (isSeeking) {
      handleSeekInteraction(e);
    }
  }, [isSeeking, handleSeekInteraction]);

  const handleSeekEnd = useCallback(() => {
    setIsSeeking(false);
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    if (isSeeking) {
      document.addEventListener('mousemove', handleSeekMove);
      document.addEventListener('mouseup', handleSeekEnd);
    }
    return () => {
      document.removeEventListener('mousemove', handleSeekMove);
      document.removeEventListener('mouseup', handleSeekEnd);
    };
  }, [isSeeking, handleSeekMove, handleSeekEnd]);

  // Marker Dragging Logic
  const handleMarkerDragStart = (e: React.MouseEvent<HTMLDivElement>, markerId: string) => {
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setDraggingMarkerId(markerId);
      document.body.style.cursor = 'ew-resize';
    }
  };

  const handleMarkerDragMove = useCallback((e: MouseEvent) => {
    if (draggingMarkerId && rulerRef.current) {
      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newTime = Math.max(0, Math.min(duration, (x / rect.width) * duration));
      props.onUpdateTemplateMarkerTime(draggingMarkerId, newTime);
    }
  }, [draggingMarkerId, duration, props.onUpdateTemplateMarkerTime]);

  const handleMarkerDragEnd = useCallback(() => {
    setDraggingMarkerId(null);
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    if (draggingMarkerId) {
      document.addEventListener('mousemove', handleMarkerDragMove);
      document.addEventListener('mouseup', handleMarkerDragEnd);
    }
    return () => {
      document.removeEventListener('mousemove', handleMarkerDragMove);
      document.removeEventListener('mouseup', handleMarkerDragEnd);
    };
  }, [draggingMarkerId, handleMarkerDragMove, handleMarkerDragEnd]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Helper to find clip under playhead on a specific track
      const findClipAtTime = (trackId: string, time: number) => {
        const track = allTracks.find(t => t.id === trackId);
        if (!track) return null;
        return track.clips.find(c => {
          const clipEnd = c.timelineStart + getClipDuration(c);
          return time >= c.timelineStart && time < clipEnd;
        });
      };

      // Ctrl+Left Arrow: Jump to start of selected clip, then auto-select clip under playhead
      if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (selectedClip) {
          const track = allTracks.find(t => t.id === selectedClip.trackId);
          const clip = track?.clips.find(c => c.id === selectedClip.clipId);
          if (clip) {
            const newTime = clip.timelineStart;
            handleJump(newTime);
            // Auto-select clip under new playhead position on the same track
            const clipAtNewTime = findClipAtTime(selectedClip.trackId, newTime);
            if (clipAtNewTime) {
              onSetSelectedClip({ trackId: selectedClip.trackId, clipId: clipAtNewTime.id });
            }
          }
        } else if (activeTrackId) {
          // No clip selected, but we have an active track - select clip under playhead
          const clipAtTime = findClipAtTime(activeTrackId, currentTime);
          if (clipAtTime) {
            onSetSelectedClip({ trackId: activeTrackId, clipId: clipAtTime.id });
          }
        }
      }

      // Ctrl+Right Arrow: Jump to end of selected clip, then auto-select clip under playhead
      if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (selectedClip) {
          const track = allTracks.find(t => t.id === selectedClip.trackId);
          const clip = track?.clips.find(c => c.id === selectedClip.clipId);
          if (clip) {
            const newTime = clip.timelineStart + getClipDuration(clip);
            handleJump(newTime);
            // Auto-select clip under new playhead position on the same track
            const clipAtNewTime = findClipAtTime(selectedClip.trackId, newTime);
            if (clipAtNewTime) {
              onSetSelectedClip({ trackId: selectedClip.trackId, clipId: clipAtNewTime.id });
            }
          }
        } else if (activeTrackId) {
          // No clip selected, but we have an active track - select clip under playhead
          const clipAtTime = findClipAtTime(activeTrackId, currentTime);
          if (clipAtTime) {
            onSetSelectedClip({ trackId: activeTrackId, clipId: clipAtTime.id });
          }
        }
      }

      // M: Toggle magnet mode
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onToggleMagnetMode();
      }

      // C: Split clip
      if (e.key === 'c' || e.key === 'C') {
        if (selectedClip) {
          e.preventDefault();
          onCut(selectedClip.trackId, selectedClip.clipId);
        }
      }

      // D: Delete clip
      if (e.key === 'd' || e.key === 'D') {
        if (selectedClip) {
          e.preventDefault();
          onDeleteClip();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedClip, activeTrackId, currentTime, allTracks, onToggleMagnetMode, onCut, onDeleteClip, onSetSelectedClip]);


  const handleInternalJumpToStart = () => {
    onJumpToStart();
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  };

  const handleInternalJumpToEnd = () => {
    onJumpToEnd();
    // We need to calculate where the end position is in pixels
    // Find the max end time from all tracks (similar to App.tsx logic)
    let maxEndTime = 0;
    allTracks.forEach(track => {
      track.clips.forEach(clip => {
        const end = clip.timelineStart + getClipDuration(clip);
        if (end > maxEndTime) maxEndTime = end;
      });
    });

    // Convert time to pixels
    const playheadOffset = 136; // 128px header + 8px margin
    const targetX = playheadOffset + (maxEndTime * PIXELS_PER_SECOND);

    if (scrollContainerRef.current) {
      // Center the end point if possible, or just scroll to it
      const container = scrollContainerRef.current;
      const centerOffset = container.clientWidth / 2;
      container.scrollTo({ left: Math.max(0, targetX - centerOffset), behavior: 'smooth' });
    }
  };

  const handleClipContextMenu = (e: React.MouseEvent<HTMLDivElement>, trackId: string, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, trackId, clipId });
  };

  const [templateContextMenu, setTemplateContextMenu] = useState<{ x: number, y: number, markerId: string } | null>(null);

  const handleTemplateMarkerContextMenu = (e: React.MouseEvent<HTMLDivElement>, markerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTemplateContextMenu({ x: e.clientX, y: e.clientY, markerId });
  };

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If clicking on a marker, don't add new one (handled by stopPropagation on marker)
    // But if clicking on empty space, maybe seek?
    // The current implementation has onMouseDown={handleSeekStart} on the ruler.
    // We can add a double click to add marker? Or just use the context menu on the ruler?
    // For now, let's stick to the requirement: "Click on playhead position -> Choose a template"
    // But the requirement says "Click on playhead position", which usually means seeking.
    // Let's implement "Right Click on Ruler -> Add Template Marker"
  };

  const [rulerContextMenu, setRulerContextMenu] = useState<{ x: number, y: number, time: number } | null>(null);

  const handleRulerContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * duration;
    setRulerContextMenu({ x: e.clientX, y: e.clientY, time });
  };

  const handleRulerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (dragState.type === 'template') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleRulerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (dragState.type === 'template' && dragState.templateId) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = (x / rect.width) * duration;
      onAddTemplateMarker(time, dragState.templateId);
    }
  };

  const handleConvertFps = async (trackId: string, clipId: string, speed: number) => {
    const track = allTracks.find(t => t.id === trackId);
    const clip = track?.clips.find(c => c.id === clipId);
    const mediaFile = mediaFiles.find(mf => mf.id === clip?.mediaFileId);

    if (!track || !clip || !mediaFile) return;

    // Update status to processing
    onClipUpdate(trackId, clipId, {
      processingStatus: 'processing',
      processingProgress: 0,
      speed: speed, // Set speed immediately for preview (even if not smooth yet)
      targetFps: 60
    });

    try {
      const processedUrl = await convertFps(
        mediaFile.file,
        60,
        speed,
        (progress) => {
          onClipUpdate(trackId, clipId, { processingProgress: progress });
        }
      );

      // const processedUrl = URL.createObjectURL(processedBlob);

      // Calculate the new duration: original clip duration / speed factor
      // For example: 9 seconds / 0.5 = 18 seconds
      const originalDuration = clip.sourceEnd - clip.sourceStart;
      const newDuration = originalDuration / speed;

      onClipUpdate(trackId, clipId, {
        processingStatus: 'done',
        processedVideoUrl: processedUrl,
        processingProgress: 1,
        // Update the clip to reflect the new processed video duration
        sourceEnd: clip.sourceStart + newDuration,
        speed: 1 // Speed is now baked into the processed video
      });

    } catch (error) {
      console.error("FFmpeg processing failed:", error);
      onClipUpdate(trackId, clipId, { processingStatus: 'error' });
      alert("Video processing failed. Check console for details.");
    }
  };

  const handleJump = (time: number) => {
    onSeek(time);
    // Manually scroll to center the playhead
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const playheadOffset = 136; // 128px header + 8px margin
      const playheadX = playheadOffset + (time * PIXELS_PER_SECOND);
      const { clientWidth } = container;

      container.scrollLeft = Math.max(0, playheadX - (clientWidth / 2));
    }
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;

    const track = allTracks.find(t => t.id === contextMenu.trackId);
    const clip = track?.clips.find(c => c.id === contextMenu.clipId);

    if (!track || !clip) return null;

    const isVideo = track.type === 'video';
    const isAudio = track.type === 'audio';

    // Check if the media file is an image (photos don't support FPS conversion or reframe)
    const mediaFile = mediaFiles.find(mf => mf.id === clip.mediaFileId);
    const isImage = mediaFile?.type === 'image';

    // Calculate position to prevent overflow
    const menuHeight = 300; // Estimated max height
    const windowHeight = window.innerHeight;

    // Adjust top position if it goes below the viewport
    let top = contextMenu.y;
    if (top + menuHeight > windowHeight) {
      top = windowHeight - menuHeight - 10; // 10px padding from bottom
    }

    return (
      <div
        ref={contextMenuRef}
        className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-xl py-1 w-56 overflow-y-auto"
        style={{ top, left: contextMenu.x, maxHeight: '300px' }}
      >
        {/* Mute/Unmute Clip */}
        <button
          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center"
          onClick={() => { onClipMuteToggle(contextMenu.trackId, contextMenu.clipId); setContextMenu(null); }}
        >
          {clip.isMuted ? (
            <>
              <UnmuteIcon className="w-4 h-4 mr-2 text-teal-500" />
              Unmute Clip
            </>
          ) : (
            <>
              <MuteIcon className="w-4 h-4 mr-2 text-gray-500" />
              Mute Clip
            </>
          )}
        </button>
        <div className="h-px bg-gray-700 my-1" />

        {/* Jump to Start/End */}
        <button
          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center"
          onClick={() => { handleJump(clip.timelineStart); setContextMenu(null); }}
        >
          <SkipStartIcon className="w-4 h-4 mr-2 text-gray-400" />
          Jump to Start Of Clip
        </button>
        <button
          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center"
          onClick={() => { handleJump(clip.timelineStart + getClipDuration(clip)); setContextMenu(null); }}
        >
          <SkipEndIcon className="w-4 h-4 mr-2 text-gray-400" />
          Jump to End of Clip
        </button>
        <div className="h-px bg-gray-700 my-1" />

        {isAudio && (
          <>
            <button
              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center"
              onClick={() => { onCut(contextMenu.trackId, contextMenu.clipId); setContextMenu(null); }}
            >
              <ScissorsIcon className="w-4 h-4 mr-2 text-gray-400" />
              Split Clip at Playhead
            </button>
            <div className="h-px bg-gray-700 my-1" />

            <button
              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center"
              onClick={() => { onAnalyzeBeats(contextMenu.trackId, contextMenu.clipId); setContextMenu(null); }}
            >
              <MusicIcon className="w-4 h-4 mr-2 text-teal-500" />
              Analyze Beats
            </button>
            <div className="h-px bg-gray-700 my-1" />
          </>
        )}

        {isVideo && (
          <>
            <button
              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center"
              onClick={() => { onCut(contextMenu.trackId, contextMenu.clipId); setContextMenu(null); }}
            >
              <ScissorsIcon className="w-4 h-4 mr-2 text-gray-400" />
              Split Clip at Playhead
            </button>
            <div className="h-px bg-gray-700 my-1" />

            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Convert to 60fps
            </div>
            <button
              disabled={clip.processingStatus === 'processing' || isImage}
              className={`w - full text - left px - 4 py - 2 text - sm flex items - center ${(clip.processingStatus === 'processing' || isImage) ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:bg-gray-700'} `}
              onClick={() => {
                handleConvertFps(contextMenu.trackId, contextMenu.clipId, 1);
                setContextMenu(null);
              }}
            >
              {clip.speed === 1 && clip.targetFps === 60 && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mr-2" />}
              <span className={clip.speed === 1 && clip.targetFps === 60 ? "" : "ml-3.5"}>Normal Speed (1x)</span>
            </button>
            <button
              disabled={clip.processingStatus === 'processing' || isImage}
              className={`w - full text - left px - 4 py - 2 text - sm flex items - center ${(clip.processingStatus === 'processing' || isImage) ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:bg-gray-700'} `}
              onClick={() => {
                handleConvertFps(contextMenu.trackId, contextMenu.clipId, 0.5);
                setContextMenu(null);
              }}
            >
              {clip.speed === 0.5 && clip.targetFps === 60 && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mr-2" />}
              <span className={clip.speed === 0.5 && clip.targetFps === 60 ? "" : "ml-3.5"}>Slow Mo (0.5x)</span>
            </button>
            <button
              disabled={clip.processingStatus === 'processing' || isImage}
              className={`w - full text - left px - 4 py - 2 text - sm flex items - center ${(clip.processingStatus === 'processing' || isImage) ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:bg-gray-700'} `}
              onClick={() => {
                handleConvertFps(contextMenu.trackId, contextMenu.clipId, 0.25);
                setContextMenu(null);
              }}
            >
              {clip.speed === 0.25 && clip.targetFps === 60 && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mr-2" />}
              <span className={clip.speed === 0.25 && clip.targetFps === 60 ? "" : "ml-3.5"}>Super Slow (0.25x)</span>
            </button>
            <button
              disabled={clip.processingStatus === 'processing' || isImage}
              className={`w - full text - left px - 4 py - 2 text - sm flex items - center ${(clip.processingStatus === 'processing' || isImage) ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:bg-gray-700'} `}
              onClick={() => {
                handleConvertFps(contextMenu.trackId, contextMenu.clipId, 2);
                setContextMenu(null);
              }}
            >
              {clip.speed === 2 && clip.targetFps === 60 && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mr-2" />}
              <span className={clip.speed === 2 && clip.targetFps === 60 ? "" : "ml-3.5"}>Fast (2x)</span>
            </button>
            <div className="h-px bg-gray-700 my-1" />
          </>
        )}

        {isVideo && (
          <>
            <button
              disabled={isImage}
              className={`w - full text - left px - 4 py - 2 text - sm flex items - center ${isImage ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 hover:bg-gray-700'} `}
              onClick={() => { onOpenReframeModal(contextMenu.trackId, contextMenu.clipId); setContextMenu(null); }}
              title={isImage ? 'Reframe not available for images' : 'Reframe this clip'}
            >
              <CropIcon className="w-4 h-4 mr-2 text-orange-500" />
              Reframe Clip...
            </button>
            <div className="h-px bg-gray-700 my-1" />
          </>
        )}
        <button
          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => { onRemoveTransition(contextMenu.trackId, contextMenu.clipId, 'start'); setContextMenu(null); }}
          disabled={!clip.transitionStart}
        >
          Remove Start Transition
        </button>
        <button
          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => { onRemoveTransition(contextMenu.trackId, contextMenu.clipId, 'end'); setContextMenu(null); }}
          disabled={!clip.transitionEnd}
        >
          Remove End Transition
        </button>
        <div className="h-px bg-gray-700 my-1" />
        <button
          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          onClick={() => { onOpenTransitionDurationModal(contextMenu.trackId, contextMenu.clipId); setContextMenu(null); }}
        >
          Set Transition Duration...
        </button>
      </div>
    );
  };

  const renderTemplateContextMenu = () => {
    if (!templateContextMenu) return null;
    const marker = templateMarkers.find(m => m.id === templateContextMenu.markerId);
    if (!marker) return null;

    return (
      <div
        className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-xl py-1 w-56"
        style={{ top: templateContextMenu.y, left: templateContextMenu.x }}
      >
        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Change Template
        </div>
        <button className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700" onClick={() => { onUpdateTemplateMarker(marker.id, 'solo'); setTemplateContextMenu(null); }}>Solo Reel</button>
        <button className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700" onClick={() => { onUpdateTemplateMarker(marker.id, 'duet-vertical'); setTemplateContextMenu(null); }}>Duet Split</button>
        <button className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700" onClick={() => { onUpdateTemplateMarker(marker.id, 'trio-stack'); setTemplateContextMenu(null); }}>Trio Stack</button>

        {marker.time > 0.1 && (
          <>
            <div className="h-px bg-gray-700 my-1" />
            <button
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 flex items-center"
              onClick={() => { onDeleteTemplateMarker(marker.id); setTemplateContextMenu(null); }}
            >
              <TrashIcon className="w-4 h-4 mr-2" />
              Delete Marker
            </button>
          </>
        )}
      </div>
    );
  };

  const renderRulerContextMenu = () => {
    if (!rulerContextMenu) return null;
    return (
      <div
        className="fixed z-50 bg-gray-800 border border-gray-700 rounded-md shadow-xl py-1 w-56"
        style={{ top: rulerContextMenu.y, left: rulerContextMenu.x }}
      >
        <button
          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          onClick={() => { onAddTemplateMarker(rulerContextMenu.time, 'solo'); setRulerContextMenu(null); }}
        >
          Add Template Marker Here
        </button>
      </div>
    );
  };

  const playheadPosition = (currentTime / duration) * 100;
  const snapLineLeft = snapLinePosition !== null ? (snapLinePosition / duration) * timelineWidth : 0;

  return (
    <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50 space-y-4 flex flex-col h-full overflow-hidden">
      <div className="flex items-center space-x-4 flex-shrink-0">
        {/* ... Toolbar controls */}
        <Tooltip text={isPlaying ? "Pause" : "Play"}>
          <button
            onClick={onPlayPause}
            className="p-2 bg-orange-600 text-white rounded-full hover:bg-orange-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-orange-500"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
          </button>
        </Tooltip>

        <Tooltip text="Split Clip">
          <button
            onClick={onCut}
            disabled={!selectedClip}
            className="p-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
            aria-label="Split selected clip at playhead"
          >
            <ScissorsIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <Tooltip text="Delete Clip">
          <button
            onClick={onDeleteClip}
            disabled={!selectedClip}
            className="p-2 bg-gray-700 text-white rounded-full hover:bg-red-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
            aria-label="Delete selected clip"
          >
            <TrashIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <Tooltip text="Crop / Reframe">
          <button
            onClick={() => selectedClip && onOpenReframeModal(selectedClip.trackId, selectedClip.clipId)}
            disabled={!selectedClip}
            className="p-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
            aria-label="Crop / Reframe selected clip"
          >
            <CropIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <div className="w-px h-8 bg-gray-700 mx-2" /> {/* Separator */}

        <Tooltip text={`Undo (${canUndo ? 'U' : 'No history'})`}>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white ${canUndo
              ? 'bg-gray-700 text-white hover:bg-gray-600'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}
            aria-label="Undo"
          >
            <UndoIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <Tooltip text={`Redo (${canRedo ? 'R' : 'No history'})`}>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white ${canRedo
              ? 'bg-gray-700 text-white hover:bg-gray-600'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}
            aria-label="Redo"
          >
            <RedoIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <div className="w-px h-8 bg-gray-700 mx-2" /> {/* Separator */}

        <Tooltip text={isMagnetMode ? "Disable Magnet Mode" : "Enable Magnet Mode"}>
          <button
            onClick={onToggleMagnetMode}
            className={`p-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white ${isMagnetMode
              ? 'bg-orange-600 text-white hover:bg-orange-500'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
              }`}
            aria-label="Toggle Magnet Mode (Ripple Edit)"
          >
            <MagnetIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <Tooltip text="Jump to Start">
          <button
            onClick={handleInternalJumpToStart}
            className="p-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
            aria-label="Jump to Start"
          >
            <SkipStartIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <Tooltip text="Jump to End">
          <button
            onClick={handleInternalJumpToEnd}
            className="p-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
            aria-label="Jump to End"
          >
            <SkipEndIcon className="w-6 h-6" />
          </button>
        </Tooltip>

        <div className="w-px h-8 bg-gray-700 mx-2" /> {/* Separator */}

        <Tooltip text="Previous Frame">
          <button
            onClick={() => onSeek(Math.max(0, currentTime - 1 / 30))}
            className="p-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
            aria-label="Previous Frame"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </Tooltip>

        <Tooltip text="Next Frame">
          <button
            onClick={() => onSeek(currentTime + 1 / 30)}
            className="p-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
            aria-label="Next Frame"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </Tooltip>

        <div className="flex-1 text-center">
          <div className="font-mono text-lg">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          {selectedClip && (() => {
            const track = allTracks.find(t => t.id === selectedClip.trackId);
            const clip = track?.clips.find(c => c.id === selectedClip.clipId);
            if (clip) {
              const clipDuration = getClipDuration(clip);
              return (
                <div className="flex items-center justify-center gap-2 mt-1">
                  <span className="text-xs text-gray-400">Clip:</span>
                  <ClipDurationInput
                    duration={clipDuration}
                    onChange={(newDuration) => {
                      if (props.onClipDurationChange) {
                        props.onClipDurationChange(selectedClip.trackId, selectedClip.clipId, newDuration);
                      }
                    }}
                  />
                  <span className="text-xs text-gray-400">s</span>
                </div>
              );
            }
            return null;
          })()}
        </div>
      </div>

      <div className="relative overflow-auto flex-grow" ref={scrollContainerRef} onClick={() => onSetSelectedClip(null)}>
        <div className="relative min-w-fit pb-4">
          {/* RULER */}
          <div className="flex items-center space-x-2 h-10 mb-2 sticky top-0 z-30">
            <div className="w-32 flex-shrink-0 sticky left-0 z-40 bg-gray-900 h-full" />
            <div
              ref={rulerRef}
              style={{ width: `${timelineWidth}px` }}
              className="flex-shrink-0 h-full bg-gray-900/50 rounded-lg cursor-ew-resize relative border-x-2 border-transparent"
              onMouseDown={handleSeekStart}
              onContextMenu={handleRulerContextMenu}
              onDragOver={handleRulerDragOver}
              onDrop={handleRulerDrop}
            >
              {/* Optional: Render ticks here */}
              {templateMarkers.map(marker => (
                <div
                  key={marker.id}
                  className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 z-50 group cursor-pointer"
                  style={{ left: `${(marker.time / duration) * 100}% ` }}
                  onContextMenu={(e) => handleTemplateMarkerContextMenu(e, marker.id)}
                  onMouseDown={(e) => handleMarkerDragStart(e, marker.id)}
                  onClick={(e) => { e.stopPropagation(); /* Maybe select? */ }}
                  title={`Template: ${marker.templateId} (Shift + Drag to move)`}
                >
                  <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-yellow-500 rounded-full shadow-sm group-hover:scale-125 transition-transform" />
                  <div className="absolute top-4 left-1 text-[10px] text-yellow-500 font-mono opacity-0 group-hover:opacity-100 whitespace-nowrap bg-black/80 px-1 rounded pointer-events-none">
                    {marker.templateId}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TRACKS */}
          <div className="space-y-2">
            {/* Only show video tracks up to the current template's requirement */}
            {videoTracks.slice(0, currentTemplate.videoTracks).map((track, index) => (
              <TrackLane
                key={track.id}
                track={track}
                allTracks={allTracks}
                mediaFiles={mediaFiles}
                duration={duration}
                onMuteToggle={() => onMuteToggle(track.id, 'video')}
                onVolumeChange={(val) => onVolumeChange(track.id, val, 'video')}
                name={`Video ${index + 1} `}
                icon={<FilmIcon className="w-4 h-4 mr-1 text-orange-400" />}
                timelineWidth={timelineWidth}
                onClipUpdate={onClipUpdate}
                onSnap={setSnapLinePosition}
                selectedClip={selectedClip}
                onSetSelectedClip={onSetSelectedClip}
                onAddClip={onAddClip}
                onMoveClip={onMoveClip}
                dragState={dragState}
                onSetDragState={onSetDragState}
                onApplyTransition={onApplyTransition}
                onClipContextMenu={(e, clipId) => handleClipContextMenu(e, track.id, clipId)}
                onSeekToMouse={seekToMouse}
                selectedClips={selectedClips}
                onSetSelectedClips={onSetSelectedClips}
                templateMarkers={templateMarkers}
                onAddTemplateMarker={onAddTemplateMarker}
                onUpdateTemplateMarker={onUpdateTemplateMarker}
                onDeleteTemplateMarker={onDeleteTemplateMarker}
                currentTime={currentTime}
              />
            ))}
            {audioTracks.map((track, index) => (
              <TrackLane
                key={track.id}
                track={track}
                allTracks={allTracks}
                mediaFiles={mediaFiles}
                duration={duration}
                selectedClip={selectedClip}
                onMuteToggle={() => onMuteToggle(track.id, 'audio')}
                onVolumeChange={(vol) => onVolumeChange(track.id, vol, 'audio')}
                name={`Audio ${index + 1} `}
                icon={<MusicIcon className="w-4 h-4 text-teal-400" />}
                timelineWidth={timelineWidth}
                onClipUpdate={onClipUpdate}
                onSnap={setSnapLinePosition}
                onSetSelectedClip={onSetSelectedClip}
                onAddClip={onAddClip}
                onMoveClip={onMoveClip}
                dragState={dragState}
                onSetDragState={onSetDragState}
                onApplyTransition={onApplyTransition}
                onClipContextMenu={(e, clipId) => handleClipContextMenu(e, track.id, clipId)}
                onSeekToMouse={seekToMouse}
                selectedClips={selectedClips}
                onSetSelectedClips={onSetSelectedClips}
                templateMarkers={templateMarkers}
                onAddTemplateMarker={onAddTemplateMarker}
                onUpdateTemplateMarker={onUpdateTemplateMarker}
                onDeleteTemplateMarker={onDeleteTemplateMarker}
                currentTime={currentTime}
              />
            ))}
          </div>

          {/* PLAYHEAD */}
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-30"
            style={{ left: `calc(128px + 0.5rem + ${(currentTime / duration) * timelineWidth}px)` }}
          >
            <div className="w-0.5 h-full bg-white/80 relative">
              <div
                className="absolute top-8 w-4 h-4 bg-white rounded-full border-2 border-gray-800 shadow-sm"
                style={{ left: '50%', transform: 'translateX(-50%)' }}
              />
            </div>
          </div>

          {snapLinePosition !== null && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-30"
              style={{ left: `calc(128px + 0.5rem + ${snapLineLeft}px)` }}
            >
              <div className="w-0.5 h-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.8)]" />
            </div>
          )}
        </div>
      </div>
      {renderContextMenu()}
      {renderTemplateContextMenu()}
      {renderRulerContextMenu()}
    </div>
  );
};
