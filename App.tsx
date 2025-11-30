import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Preview } from './components/VideoPlayer';
import { Timeline } from './components/Timeline';
import { SaveModal } from './components/SaveModal';
import { TransitionDurationModal } from './components/TransitionDurationModal';
import { ReframeModal } from './components/ReframeModal';
import { ExportProgressModal } from './components/ExportProgressModal';
import { Tooltip } from './components/Tooltip';
import { Template, MediaFile, Track, Clip, TemplateLayout, SelectedClip, DragState, TransitionType, ReframeKeyframe, TemplateMarker } from './types';
import { analyzeBeats } from './services/beatDetectionService';

const getClipDuration = (clip: Clip) => {
  return (clip.sourceEnd - clip.sourceStart) / (clip.speed || 1);
};

const TEMPLATES: Template[] = [
  { id: 'solo', name: 'Solo Reel', description: 'One full-screen vertical video.', layout: 'solo', videoTracks: 1 },
  { id: 'duet-vertical', name: 'Duet Split', description: 'Two videos side-by-side.', layout: 'duet-vertical', videoTracks: 2 },
  { id: 'duet-horizontal', name: 'Duet Stack', description: 'Two videos stacked horizontally.', layout: 'duet-horizontal', videoTracks: 2 },
  { id: 'trio-stack', name: 'Trio Stack', description: 'Three videos stacked.', layout: 'trio-stack', videoTracks: 3 },
];

// Helper to save file
const saveFile = async (blob: Blob, filename: string, format: string, fileHandle?: any) => {
  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      console.error('Error writing to file handle:', err);
    }
  }

  // Fallback to download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `${filename}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

// Robust unique ID generator with fallback
const generateId = (): string => {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// Helper to draw images/video with object-fit: cover behavior
const drawCover = (ctx: CanvasRenderingContext2D, img: HTMLVideoElement | HTMLImageElement, x: number, y: number, w: number, h: number) => {
  const sourceWidth = img instanceof HTMLVideoElement ? img.videoWidth : img.naturalWidth;
  const sourceHeight = img instanceof HTMLVideoElement ? img.videoHeight : img.naturalHeight;

  if (!sourceWidth || !sourceHeight) return; // Content not loaded

  const imgRatio = sourceWidth / sourceHeight;
  const targetRatio = w / h;
  let sx, sy, sw, sh;

  if (imgRatio > targetRatio) { // Image is wider than target
    sh = sourceHeight;
    sw = sh * targetRatio;
    sy = 0;
    sx = (sourceWidth - sw) / 2;
  } else { // Image is taller
    sw = sourceWidth;
    sh = sw / targetRatio;
    sx = 0;
    sy = (sourceHeight - sh) / 2;
  }

  try {
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  } catch (e) {
    // ignore errors during draw (e.g. video not ready)
  }
};


const App: React.FC = () => {
  // --- State Definitions ---
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [videoTracks, setVideoTracks] = useState<Track[]>([]);
  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [templateMarkers, setTemplateMarkers] = useState<TemplateMarker[]>([{ id: 'init', time: 0, templateId: TEMPLATES[0].id }]);
  const [activeTemplate, setActiveTemplate] = useState<Template>(TEMPLATES[0]); // Keep for backward compat / easy access, but derived from markers ideally

  // Calculate duration dynamically based on clips
  const duration = useMemo(() => {
    let maxEnd = 0;
    [...videoTracks, ...audioTracks].forEach(track => {
      track.clips.forEach(clip => {
        const clipEnd = clip.timelineStart + getClipDuration(clip);
        if (clipEnd > maxEnd) maxEnd = clipEnd;
      });
    });
    // Return max end time + small buffer, or minimum 1s for empty timeline
    const calculatedDuration = maxEnd > 0 ? maxEnd + 0.1 : 1;
    console.log('Timeline duration calculated:', calculatedDuration, 'Last clip ends at:', maxEnd);
    return calculatedDuration;
  }, [videoTracks, audioTracks]);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedClip, setSelectedClip] = useState<SelectedClip | null>(null);
  const [selectedClips, setSelectedClips] = useState<SelectedClip[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null); // Remember last edited track

  // History stack for undo functionality (max 5 items)
  type HistoryState = {
    videoTracks: Track[];
    audioTracks: Track[];
    templateMarkers: TemplateMarker[];
  };
  const [historyStack, setHistoryStack] = useState<HistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryState[]>([]);

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveFormat, setSaveFormat] = useState<'mp4' | 'mov'>('mp4');
  const [isExporting, setIsExporting] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ status: string, progress: number, error?: string }>({ status: 'processing', progress: 0 });
  const [isMagnetMode, setIsMagnetMode] = useState(false);
  const [defaultTransitionDuration, setDefaultTransitionDuration] = useState<number>(1.0);
  const [defaultAudioTransitionDuration, setDefaultAudioTransitionDuration] = useState<number>(1.0);
  const [editingTransitionClip, setEditingTransitionClip] = useState<{ trackId: string, clip: Clip } | null>(null);

  // Reframe Modal State
  const [reframeModalClip, setReframeModalClip] = useState<{ trackId: string, clip: Clip } | null>(null);



  // Global drag state
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    type: null,
    mediaType: null,
    id: null,
    sourceTrackId: null,
    dragOffsetX: 0
  });

  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number | undefined>(undefined);

  // Force re-render to ensure latest updates are applied
  useEffect(() => {
    console.log("App reloaded with latest features: Reframe, Click-to-Seek, Context Menus.");
  }, []);

  const getTemplateAtTime = useCallback((time: number) => {
    // Find the last marker that is <= time
    const sortedMarkers = [...templateMarkers].sort((a, b) => a.time - b.time);
    const marker = sortedMarkers.reverse().find(m => m.time <= time);
    const templateId = marker ? marker.templateId : TEMPLATES[0].id;
    return TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  }, [templateMarkers]);

  const currentTemplate = getTemplateAtTime(currentTime);

  // Update activeTemplate state whenever currentTemplate changes (for UI consistency)
  useEffect(() => {
    if (currentTemplate.id !== activeTemplate.id) {
      setActiveTemplate(currentTemplate);
    }
  }, [currentTemplate, activeTemplate]);


  const handleTemplateSelect = useCallback((template: Template) => {
    // If we are at 0, update the initial marker.
    // If we are elsewhere, add a new marker or update existing one at this exact time.
    // For simplicity in this step: Update the marker that applies to the current time.

    setTemplateMarkers(prev => {
      const time = currentTime;
      const sorted = [...prev].sort((a, b) => a.time - b.time);

      // Check if there is a marker exactly at this time (or very close)
      const exactMarkerIndex = sorted.findIndex(m => Math.abs(m.time - time) < 0.1);

      let newMarkers = [...prev];

      if (exactMarkerIndex !== -1) {
        // Update existing marker
        newMarkers[exactMarkerIndex] = { ...newMarkers[exactMarkerIndex], templateId: template.id };
      } else {
        // Add new marker
        // But first, check if we are just modifying the segment we are in.
        // The user request says: "Click on playhead position -> Choose a template -> The chosen template becomes active from that point forward"
        // This implies adding a new marker at current time.

        // However, if we are at 0, we should just update the 0 marker.
        if (time < 0.1) {
          const zeroMarkerIndex = newMarkers.findIndex(m => m.time < 0.1);
          if (zeroMarkerIndex !== -1) {
            newMarkers[zeroMarkerIndex] = { ...newMarkers[zeroMarkerIndex], templateId: template.id };
          } else {
            newMarkers.push({ id: generateId(), time: 0, templateId: template.id });
          }
        } else {
          newMarkers.push({ id: generateId(), time: time, templateId: template.id });
        }
      }

      return newMarkers;
    });

    // Ensure we have enough tracks for the max video tracks needed by ANY template
    // Actually, we should probably just ensure we have enough for the NEW template, 
    // but if we switch back to a larger template later, we need those tracks.
    // For now, let's just grow tracks if needed.
    setVideoTracks(currentTracks => {
      const newTrackCount = template.videoTracks;
      if (currentTracks.length < newTrackCount) {
        const additionalTracks = Array.from({ length: newTrackCount - currentTracks.length }, () => ({
          id: generateId(),
          clips: [],
          isMuted: false,
          type: 'video' as const,
          volume: 1,
        }));
        return [...currentTracks, ...additionalTracks];
      }
      return currentTracks;
    });
  }, [currentTime]);

  const handleAddTemplateMarker = (time: number, templateId: string) => {
    setTemplateMarkers(prev => {
      if (prev.some(m => Math.abs(m.time - time) < 0.1)) return prev; // Don't duplicate
      return [...prev, { id: generateId(), time, templateId }];
    });
  };

  const handleUpdateTemplateMarker = (markerId: string, newTemplateId: string) => {
    setTemplateMarkers(prev => prev.map(m => m.id === markerId ? { ...m, templateId: newTemplateId } : m));
  };

  const handleDeleteTemplateMarker = (markerId: string) => {
    setTemplateMarkers(prev => {
      const marker = prev.find(m => m.id === markerId);
      if (marker && marker.time < 0.1) return prev; // Cannot delete initial marker
      return prev.filter(m => m.id !== markerId);
    });
  };

  useEffect(() => {
    // Ensure initial tracks exist
    if (videoTracks.length === 0) {
      handleTemplateSelect(TEMPLATES[0]);
    }
    if (audioTracks.length === 0) {
      setAudioTracks([{ id: generateId(), clips: [], isMuted: false, type: 'audio', volume: 1 }]);
    }
  }, [handleTemplateSelect, videoTracks.length, audioTracks.length]);

  const getMediaDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      if (file.type.startsWith('image')) {
        resolve(5); // Default 5 second duration for images
        return;
      }
      const url = URL.createObjectURL(file);
      const mediaElement = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
      mediaElement.src = url;
      mediaElement.addEventListener('loadedmetadata', () => {
        resolve(mediaElement.duration);
        URL.revokeObjectURL(url);
      });
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    for (const file of Array.from(files) as File[]) {
      const fileDuration = await getMediaDuration(file);
      const fileType = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';

      if (fileType === 'image' && !['image/jpeg', 'image/png'].includes(file.type)) {
        alert('Unsupported image type. Please use JPEG or PNG.');
        continue;
      }

      const newMediaFile: MediaFile = {
        id: generateId(),
        file,
        url: URL.createObjectURL(file),
        duration: fileDuration,
        type: fileType,
      };
      setMediaFiles(prev => [...prev, newMediaFile]);
    }

    // Reset the file input value so the same files can be imported again
    event.target.value = '';
  };

  const handleRemoveMediaFile = (mediaFileId: string) => {
    // Check if media file is used in any track
    const isUsed = [...videoTracks, ...audioTracks].some(track =>
      track.clips.some(clip => clip.mediaFileId === mediaFileId)
    );

    if (isUsed) {
      console.warn('Cannot remove media file that is in use');
      return;
    }

    // Find and revoke the object URL to free memory
    const mediaFile = mediaFiles.find(mf => mf.id === mediaFileId);
    if (mediaFile) {
      URL.revokeObjectURL(mediaFile.url);
    }

    // Remove from mediaFiles state
    setMediaFiles(prev => prev.filter(mf => mf.id !== mediaFileId));
  };



  const handleAddClip = (mediaFileId: string, trackId: string, timelineStart: number) => {
    const mediaFile = mediaFiles.find(mf => mf.id === mediaFileId);
    if (!mediaFile) return;

    const newClip: Clip = {
      id: generateId(),
      mediaFileId,
      sourceStart: 0,
      sourceEnd: mediaFile.duration,
      timelineStart,
    };

    const trackSetter = mediaFile.type === 'audio' ? setAudioTracks : setVideoTracks;
    trackSetter(prev => prev.map(track =>
      track.id === trackId
        ? { ...track, clips: [...track.clips, newClip].sort((a, b) => a.timelineStart - b.timelineStart) }
        : track
    ));
  };

  const handleAddClipToTrack = (mediaFileId: string, trackId: string) => {
    const mediaFile = mediaFiles.find(mf => mf.id === mediaFileId);
    const isVideo = mediaFile?.type === 'video' || mediaFile?.type === 'image';
    const targetTracks = isVideo ? videoTracks : audioTracks;
    const targetTrack = targetTracks.find(t => t.id === trackId);

    if (!mediaFile || !targetTrack) return;

    const lastClip = targetTrack.clips.reduce((latest, current) => {
      const currentEndTime = current.timelineStart + getClipDuration(current);
      return currentEndTime > latest ? currentEndTime : latest;
    }, 0);

    const newTimelineStart = lastClip;

    handleAddClip(mediaFileId, trackId, newTimelineStart);
  };

  const handleMoveClip = (clipId: string, sourceTrackId: string, targetTrackId: string, newTimelineStart: number) => {
    // Save state for undo
    saveToHistory();
    let clipToMove: Clip | undefined;
    let sourceType: 'video' | 'audio' | undefined;

    const allTracks = [...videoTracks, ...audioTracks];
    const sourceTrack = allTracks.find(t => t.id === sourceTrackId);
    if (!sourceTrack) return;
    sourceType = sourceTrack.type;

    const sourceSetter = sourceType === 'video' ? setVideoTracks : setAudioTracks;
    sourceSetter(prev => prev.map(track => {
      if (track.id !== sourceTrackId) return track;
      clipToMove = track.clips.find(c => c.id === clipId);
      return { ...track, clips: track.clips.filter(c => c.id !== clipId) };
    }));

    if (!clipToMove) return;

    const targetTrack = allTracks.find(t => t.id === targetTrackId);
    if (!targetTrack || targetTrack.type !== sourceType) {
      sourceSetter(prev => prev.map(track =>
        track.id === sourceTrackId
          ? { ...track, clips: [...track.clips, clipToMove!].sort((a, b) => a.timelineStart - b.timelineStart) }
          : track
      ));
      return;
    }

    const targetSetter = targetTrack.type === 'video' ? setVideoTracks : setAudioTracks;
    targetSetter(prev => prev.map(track => {
      if (track.id !== targetTrackId) return track;
      const movedClip = { ...clipToMove!, timelineStart: newTimelineStart };
      return { ...track, clips: [...track.clips, movedClip].sort((a, b) => a.timelineStart - b.timelineStart) };
    }));
  }

  const playbackLoop = useCallback((time: number) => {
    if (lastTimeRef.current === undefined) {
      lastTimeRef.current = time;
    }
    const deltaTime = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;

    setCurrentTime(prevTime => {
      const newTime = prevTime + deltaTime;
      if (newTime >= duration) {
        setIsPlaying(false);
        return 0;
      }
      return newTime;
    });

    animationFrameRef.current = requestAnimationFrame(playbackLoop);
  }, [duration]);

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = undefined;
      animationFrameRef.current = requestAnimationFrame(playbackLoop);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, playbackLoop]);

  const handlePlayPause = useCallback(() => {
    setCurrentTime(prevTime => {
      if (prevTime >= duration) {
        return 0;
      }
      return prevTime;
    });
    setIsPlaying(prevIsPlaying => !prevIsPlaying);
  }, [duration]);

  // Save current state to history (max 5 items)
  const saveToHistory = useCallback(() => {
    const snapshot = {
      videoTracks: JSON.parse(JSON.stringify(videoTracks)),
      audioTracks: JSON.parse(JSON.stringify(audioTracks)),
      templateMarkers: JSON.parse(JSON.stringify(templateMarkers)),
    };

    setHistoryStack(prev => {
      const newStack = [...prev, snapshot];
      // Keep only last 5 items
      return newStack.slice(-5);
    });

    // Clear redo stack on new action
    setRedoStack([]);
  }, [videoTracks, audioTracks, templateMarkers]);

  // Undo last action
  const handleUndo = useCallback(() => {
    if (historyStack.length === 0) return;

    const lastState = historyStack[historyStack.length - 1];

    // Save current state to redo stack
    const currentSnapshot = {
      videoTracks: JSON.parse(JSON.stringify(videoTracks)),
      audioTracks: JSON.parse(JSON.stringify(audioTracks)),
      templateMarkers: JSON.parse(JSON.stringify(templateMarkers)),
    };

    setRedoStack(prev => {
      const newStack = [...prev, currentSnapshot];
      return newStack.slice(-5);
    });

    // Restore state
    setVideoTracks(lastState.videoTracks);
    setAudioTracks(lastState.audioTracks);
    setTemplateMarkers(lastState.templateMarkers);

    // Clear selection
    setSelectedClip(null);
    setSelectedClips([]);

    // Remove from history
    setHistoryStack(prev => prev.slice(0, -1));
  }, [historyStack, videoTracks, audioTracks, templateMarkers]);

  // Redo last undone action
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;

    const nextState = redoStack[redoStack.length - 1];

    // Save current state to history stack
    const currentSnapshot = {
      videoTracks: JSON.parse(JSON.stringify(videoTracks)),
      audioTracks: JSON.parse(JSON.stringify(audioTracks)),
      templateMarkers: JSON.parse(JSON.stringify(templateMarkers)),
    };

    setHistoryStack(prev => {
      const newStack = [...prev, currentSnapshot];
      return newStack.slice(-5);
    });

    // Restore state
    setVideoTracks(nextState.videoTracks);
    setAudioTracks(nextState.audioTracks);
    setTemplateMarkers(nextState.templateMarkers);

    // Clear selection
    setSelectedClip(null);
    setSelectedClips([]);

    // Remove from redo stack
    setRedoStack(prev => prev.slice(0, -1));
  }, [redoStack, videoTracks, audioTracks, templateMarkers]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // Ignore Ctrl+Arrow combinations - those are handled by Timeline for clip navigation
      if (e.ctrlKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        return;
      }

      // Helper to find clip under playhead on a specific track
      const findClipAtTime = (trackId: string, time: number) => {
        const allTracks = [...videoTracks, ...audioTracks];
        const track = allTracks.find(t => t.id === trackId);
        if (!track) return null;
        return track.clips.find(c => {
          const clipEnd = c.timelineStart + getClipDuration(c);
          return time >= c.timelineStart && time < clipEnd;
        });
      };

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      } else if (e.code === 'ArrowUp') {
        // Up Arrow: Move to track above
        e.preventDefault();
        if (activeTrackId || selectedClip) {
          const currentTrackId = selectedClip?.trackId || activeTrackId;
          // Build visible track list based on current template
          const visibleVideoTracks = videoTracks.slice(0, currentTemplate.videoTracks);
          const visibleTracks = [...visibleVideoTracks, ...audioTracks];

          const currentIndex = visibleTracks.findIndex(t => t.id === currentTrackId);
          if (currentIndex > 0) {
            const newTrack = visibleTracks[currentIndex - 1];
            const clipAtTime = findClipAtTime(newTrack.id, currentTime);
            if (clipAtTime) {
              setSelectedClip({ trackId: newTrack.id, clipId: clipAtTime.id });
              setSelectedClips([{ trackId: newTrack.id, clipId: clipAtTime.id }]);
              setActiveTrackId(newTrack.id);
            } else {
              // No clip at playhead, just update active track
              setActiveTrackId(newTrack.id);
              setSelectedClip(null);
              setSelectedClips([]);
            }
          }
        }
      } else if (e.code === 'ArrowDown') {
        // Down Arrow: Move to track below
        e.preventDefault();
        if (activeTrackId || selectedClip) {
          const currentTrackId = selectedClip?.trackId || activeTrackId;
          // Build visible track list based on current template
          const visibleVideoTracks = videoTracks.slice(0, currentTemplate.videoTracks);
          const visibleTracks = [...visibleVideoTracks, ...audioTracks];

          const currentIndex = visibleTracks.findIndex(t => t.id === currentTrackId);
          if (currentIndex >= 0 && currentIndex < visibleTracks.length - 1) {
            const newTrack = visibleTracks[currentIndex + 1];
            const clipAtTime = findClipAtTime(newTrack.id, currentTime);
            if (clipAtTime) {
              setSelectedClip({ trackId: newTrack.id, clipId: clipAtTime.id });
              setSelectedClips([{ trackId: newTrack.id, clipId: clipAtTime.id }]);
              setActiveTrackId(newTrack.id);
            } else {
              // No clip at playhead, just update active track
              setActiveTrackId(newTrack.id);
              setSelectedClip(null);
              setSelectedClips([]);
            }
          }
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift + Left Arrow: Jump back 1 frame (approx 30fps)
          const newTime = Math.max(0, currentTime - 1 / 30);
          handleSeek(newTime);

          // Auto-select clip under new playhead position on active track
          if (activeTrackId) {
            const clipAtTime = findClipAtTime(activeTrackId, newTime);
            if (clipAtTime) {
              setSelectedClip({ trackId: activeTrackId, clipId: clipAtTime.id });
              setSelectedClips([{ trackId: activeTrackId, clipId: clipAtTime.id }]);
            }
          }
        } else {
          // Left Arrow: Jump to Start
          handleJumpToStart();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift + Right Arrow: Jump forward 1 frame
          const newTime = Math.min(duration, currentTime + 1 / 30);
          handleSeek(newTime);

          // Auto-select clip under new playhead position on active track
          if (activeTrackId) {
            const clipAtTime = findClipAtTime(activeTrackId, newTime);
            if (clipAtTime) {
              setSelectedClip({ trackId: activeTrackId, clipId: clipAtTime.id });
              setSelectedClips([{ trackId: activeTrackId, clipId: clipAtTime.id }]);
            }
          }
        } else {
          // Right Arrow: Jump to End
          handleJumpToEnd();
        }
      } else if (e.code === 'Home') {
        e.preventDefault();
        handleJumpToStart();
      } else if (e.code === 'KeyU') {
        // U: Undo
        e.preventDefault();
        handleUndo();
      } else if (e.code === 'KeyR') {
        // R: Redo
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, currentTime, duration, activeTrackId, videoTracks, audioTracks, selectedClip, currentTemplate, handleUndo, handleRedo]);

  const handleSeek = (time: number) => {
    setCurrentTime(Math.max(0, Math.min(duration, time)));
    if (isPlaying) setIsPlaying(false);
  };

  const handleMuteToggle = (trackId: string, type: 'video' | 'audio') => {
    const trackSetter = type === 'video' ? setVideoTracks : setAudioTracks;
    trackSetter(prev => prev.map(track => track.id === trackId ? { ...track, isMuted: !track.isMuted } : track));
  };

  const handleVolumeChange = (trackId: string, volume: number, type: 'video' | 'audio') => {
    const trackSetter = type === 'video' ? setVideoTracks : setAudioTracks;
    trackSetter(prev => prev.map(track => track.id === trackId ? { ...track, volume } : track));
  };

  const handleJumpToStart = () => {
    setCurrentTime(0);
    if (isPlaying) setIsPlaying(false);
  };

  const handleJumpToEnd = () => {
    const allTracks = [...videoTracks, ...audioTracks];
    let maxEndTime = 0;
    allTracks.forEach(track => {
      track.clips.forEach(clip => {
        const end = clip.timelineStart + getClipDuration(clip);
        if (end > maxEndTime) maxEndTime = end;
      });
    });
    setCurrentTime(Math.min(duration, maxEndTime));
    if (isPlaying) setIsPlaying(false);
  }


  const handleCut = (trackId?: string, clipId?: string) => {
    let targets: SelectedClip[] = [];

    if (trackId && clipId) {
      targets = [{ trackId, clipId }];
    } else {
      targets = selectedClips;
    }

    if (targets.length === 0) return;

    // Save state for undo
    saveToHistory();

    const cutTime = currentTime;
    if (cutTime <= 0 || cutTime >= duration) return;

    const updatedVideoTracks = videoTracks.map(track => {
      const clipsToCut = targets.filter(s => s.trackId === track.id);
      if (clipsToCut.length === 0) return track;

      const newClips: Clip[] = [];
      let trackWasModified = false;

      track.clips.forEach(clip => {
        const isSelected = clipsToCut.some(s => s.clipId === clip.id);
        if (!isSelected) {
          newClips.push(clip);
          return;
        }

        const clipDuration = getClipDuration(clip);
        const clipEndTime = clip.timelineStart + clipDuration;

        if (cutTime > clip.timelineStart && cutTime < clipEndTime) {
          trackWasModified = true;
          const timeInClip = cutTime - clip.timelineStart;
          const sourceCutTime = clip.sourceStart + timeInClip * (clip.speed || 1);

          const clipA: Clip = { ...clip, sourceEnd: sourceCutTime };

          const clipB: Clip = {
            ...clip, // Inherit all properties (colorGrading, volume, speed, etc.)
            id: generateId(),
            sourceStart: sourceCutTime,
            sourceEnd: clip.sourceEnd,
            timelineStart: cutTime,
          };

          if (clipA.sourceEnd > clipA.sourceStart) newClips.push(clipA);
          if (clipB.sourceEnd > clipB.sourceStart) newClips.push(clipB);
        } else {
          newClips.push(clip);
        }
      });

      if (trackWasModified) {
        const sorted = newClips.sort((a, b) => a.timelineStart - b.timelineStart);
        if (isMagnetMode) {
          let time = 0;
          const compacted = sorted.map(c => {
            const dur = getClipDuration(c);
            const newC = { ...c, timelineStart: time };
            time += dur;
            return newC;
          });
          return { ...track, clips: compacted };
        }
        return { ...track, clips: sorted };
      }
      return track;
    });

    const updatedAudioTracks = audioTracks.map(track => {
      const clipsToCut = targets.filter(s => s.trackId === track.id);
      if (clipsToCut.length === 0) return track;

      const newClips: Clip[] = [];
      let trackWasModified = false;

      track.clips.forEach(clip => {
        const isSelected = clipsToCut.some(s => s.clipId === clip.id);
        if (!isSelected) {
          newClips.push(clip);
          return;
        }

        const clipDuration = getClipDuration(clip);
        const clipEndTime = clip.timelineStart + clipDuration;

        if (cutTime > clip.timelineStart && cutTime < clipEndTime) {
          trackWasModified = true;
          const timeInClip = cutTime - clip.timelineStart;
          const sourceCutTime = clip.sourceStart + timeInClip * (clip.speed || 1);

          const clipA: Clip = { ...clip, sourceEnd: sourceCutTime };

          const clipB: Clip = {
            ...clip, // Inherit all properties (colorGrading, volume, speed, etc.)
            id: generateId(),
            sourceStart: sourceCutTime,
            sourceEnd: clip.sourceEnd,
            timelineStart: cutTime,
          };

          if (clipA.sourceEnd > clipA.sourceStart) newClips.push(clipA);
          if (clipB.sourceEnd > clipB.sourceStart) newClips.push(clipB);
        } else {
          newClips.push(clip);
        }
      });

      if (trackWasModified) {
        const sorted = newClips.sort((a, b) => a.timelineStart - b.timelineStart);
        if (isMagnetMode) {
          let time = 0;
          const compacted = sorted.map(c => {
            const dur = getClipDuration(c);
            const newC = { ...c, timelineStart: time };
            time += dur;
            return newC;
          });
          return { ...track, clips: compacted };
        }
        return { ...track, clips: sorted };
      }
      return track;
    });

    setVideoTracks(updatedVideoTracks);
    setAudioTracks(updatedAudioTracks);

    // Auto-select the clip to the right of the cut on the active track
    if (targets.length > 0) {
      const firstTarget = targets[0];
      const allUpdatedTracks = [...updatedVideoTracks, ...updatedAudioTracks];
      const updatedTrack = allUpdatedTracks.find(t => t.id === firstTarget.trackId);

      if (updatedTrack) {
        // Find the clip that starts at or after the cut time (clipB)
        const clipAfterCut = updatedTrack.clips.find(c =>
          Math.abs(c.timelineStart - cutTime) < 0.01 || c.timelineStart > cutTime
        );

        if (clipAfterCut) {
          setSelectedClip({ trackId: updatedTrack.id, clipId: clipAfterCut.id });
          setSelectedClips([{ trackId: updatedTrack.id, clipId: clipAfterCut.id }]);
          setActiveTrackId(updatedTrack.id);
        } else {
          setSelectedClip(null);
          setSelectedClips([]);
        }
      }
    } else {
      setSelectedClip(null);
      setSelectedClips([]);
    }
  };

  const handleClipUpdate = (trackId: string, clipId: string, updates: Partial<Clip>) => {
    const allTracks = [...videoTracks, ...audioTracks];
    const targetTrack = allTracks.find(t => t.id === trackId);
    const targetClip = targetTrack?.clips.find(c => c.id === clipId);
    const mediaFile = mediaFiles.find(mf => mf.id === targetClip?.mediaFileId);

    if (!targetTrack || !targetClip || !mediaFile) return;

    const updatedClip = { ...targetClip, ...updates };

    // Allow update if it's a processed video (which might be longer than original)
    const isProcessedVideo = !!updatedClip.processedVideoUrl;

    const isImage = mediaFile.type === 'image';

    if (
      !isProcessedVideo && !isImage && (
        updatedClip.sourceStart < 0 ||
        updatedClip.sourceEnd > mediaFile.duration ||
        updatedClip.sourceEnd > mediaFile.duration + 0.1
      ) ||
      updatedClip.sourceStart >= updatedClip.sourceEnd ||
      updatedClip.timelineStart < 0
    ) {
      return;
    }

    const trackSetter = targetTrack.type === 'video' ? setVideoTracks : setAudioTracks;
    trackSetter(prev =>
      prev.map(track => {
        if (track.id !== trackId) return track;

        const updatedClips = track.clips.map(c =>
          c.id === clipId ? { ...c, ...updates } : c
        );

        if (!isMagnetMode) {
          return { ...track, clips: updatedClips };
        }

        // Magnet Mode: Compact Track
        const sorted = updatedClips.sort((a, b) => a.timelineStart - b.timelineStart);
        let time = 0;
        const compacted = sorted.map(c => {
          const dur = getClipDuration(c);
          const newC = { ...c, timelineStart: time };
          time += dur;
          return newC;
        });
        return { ...track, clips: compacted };
      })
    );
  };

  // Ref to track last duration change to prevent rapid duplicate calls
  const lastDurationChangeRef = useRef<{ clipId: string; timestamp: number; duration: number } | null>(null);

  const handleClipDurationChange = (trackId: string, clipId: string, newDuration: number) => {
    // Prevent duplicate calls within 100ms for the same clip and duration
    const now = Date.now();
    if (lastDurationChangeRef.current &&
      lastDurationChangeRef.current.clipId === clipId &&
      lastDurationChangeRef.current.duration === newDuration &&
      now - lastDurationChangeRef.current.timestamp < 100) {
      console.log('Ignoring duplicate call');
      return;
    }
    lastDurationChangeRef.current = { clipId, timestamp: now, duration: newDuration };
    const allTracks = [...videoTracks, ...audioTracks];
    const targetTrack = allTracks.find(t => t.id === trackId);
    const targetClip = targetTrack?.clips.find(c => c.id === clipId);
    const mediaFile = mediaFiles.find(mf => mf.id === targetClip?.mediaFileId);

    if (!targetTrack || !targetClip || !mediaFile) return;

    // Validate: ensure new duration doesn't exceed media source (unless it's an image or processed video)
    const isProcessedVideo = !!targetClip.processedVideoUrl;
    const isImage = mediaFile.type === 'image';
    const maxSourceDuration = isProcessedVideo || isImage ? Infinity : mediaFile.duration;
    const maxDurationFromSource = maxSourceDuration - targetClip.sourceStart;

    if (newDuration <= 0) {
      console.warn(`Invalid duration: ${newDuration}s. Must be greater than 0.`);
      return;
    }

    // Find the next clip on the same track to prevent overlap
    const sortedClips = [...targetTrack.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    const currentClipIndex = sortedClips.findIndex(c => c.id === clipId);
    const nextClip = sortedClips[currentClipIndex + 1];

    // Calculate maximum allowed duration
    let maxAllowedDuration = maxDurationFromSource;

    // Only apply overlap prevention if magnet mode is OFF
    // With magnet mode ON, clips will shift so we don't need to clamp
    if (!isMagnetMode && nextClip) {
      const maxDurationBeforeOverlap = nextClip.timelineStart - targetClip.timelineStart;
      maxAllowedDuration = Math.min(maxAllowedDuration, maxDurationBeforeOverlap);
    }

    // Clamp the new duration to the maximum allowed
    const clampedDuration = Math.min(newDuration, maxAllowedDuration);

    if (clampedDuration < newDuration) {
      console.warn(`Duration clamped from ${newDuration}s to ${clampedDuration}s to prevent overlap.`);
    }

    // Calculate the change in duration for magnet mode
    const currentDuration = targetClip.sourceEnd - targetClip.sourceStart;
    const delta = clampedDuration - currentDuration;

    const trackSetter = targetTrack.type === 'video' ? setVideoTracks : setAudioTracks;
    trackSetter(prev =>
      prev.map(track => {
        if (track.id !== trackId) return track;

        const updatedClips = track.clips.map(c => {
          if (c.id === clipId) {
            // Update the clip's sourceEnd with the clamped duration
            return { ...c, sourceEnd: c.sourceStart + clampedDuration };
          }
          // If magnet mode is ON, shift all clips after this one to close/open gaps
          if (isMagnetMode && c.timelineStart > targetClip.timelineStart) {
            return { ...c, timelineStart: c.timelineStart + delta };
          }
          return c;
        });

        return { ...track, clips: updatedClips };
      })
    );
  };


  const handleDeleteClip = () => {
    if (selectedClips.length === 0) return;

    // Save state for undo
    saveToHistory();

    // Remember the active track before deletion
    const deletedTrackId = selectedClips[0]?.trackId || activeTrackId;
    const trackIdsToUpdate = new Set(selectedClips.map(s => s.trackId));

    // Compute new track states
    const computeNewTracks = (tracks: Track[]) => {
      return tracks.map(track => {
        if (!trackIdsToUpdate.has(track.id)) return track;

        const clipIdsToDelete = new Set(selectedClips.filter(s => s.trackId === track.id).map(s => s.clipId));
        const remainingClips = track.clips.filter(c => !clipIdsToDelete.has(c.id));

        if (!isMagnetMode) {
          return { ...track, clips: remainingClips };
        }

        // Magnet Mode: Compact Track
        const sorted = remainingClips.sort((a, b) => a.timelineStart - b.timelineStart);
        let time = 0;
        const compacted = sorted.map(c => {
          const dur = getClipDuration(c);
          const newC = { ...c, timelineStart: time };
          time += dur;
          return newC;
        });
        return { ...track, clips: compacted };
      });
    };

    // Compute new states
    const newVideoTracks = computeNewTracks(videoTracks);
    const newAudioTracks = computeNewTracks(audioTracks);

    // Find clip to select in the NEW state
    let clipToSelect: { trackId: string; clipId: string } | null = null;

    if (deletedTrackId) {
      const allNewTracks = [...newVideoTracks, ...newAudioTracks];
      const track = allNewTracks.find(t => t.id === deletedTrackId);

      if (track) {
        const clipAtPlayhead = track.clips.find(c => {
          const clipEnd = c.timelineStart + getClipDuration(c);
          return currentTime >= c.timelineStart && currentTime < clipEnd;
        });

        if (clipAtPlayhead) {
          clipToSelect = { trackId: deletedTrackId, clipId: clipAtPlayhead.id };
        }
      }
    }

    // Update all state at once
    setVideoTracks(newVideoTracks);
    setAudioTracks(newAudioTracks);

    if (clipToSelect) {
      setSelectedClip(clipToSelect);
      setSelectedClips([clipToSelect]);
    } else {
      setSelectedClip(null);
      setSelectedClips([]);
    }
  };

  const handleApplyTransition = (trackId: string, clipId: string, type: TransitionType, location: 'start' | 'end') => {
    // Check if this is an audio transition
    const isAudioTransition = type === 'fade-in' || type === 'fade-out';
    const duration = isAudioTransition ? defaultAudioTransitionDuration : defaultTransitionDuration;

    const trackSetter = videoTracks.some(t => t.id === trackId) ? setVideoTracks : setAudioTracks;
    trackSetter(prev => prev.map(track => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map(c => {
          if (c.id !== clipId) return c;
          const updates: Partial<Clip> = {};
          if (location === 'start') {
            updates.transitionStart = { type, duration };
          } else {
            updates.transitionEnd = { type, duration };
          }
          return { ...c, ...updates };
        })
      }
    }));
  }

  const handleRemoveTransition = (trackId: string, clipId: string, location: 'start' | 'end') => {
    const trackSetter = videoTracks.some(t => t.id === trackId) ? setVideoTracks : setAudioTracks;
    trackSetter(prev => prev.map(track => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map(c => {
          if (c.id !== clipId) return c;
          const updates: Partial<Clip> = {};
          if (location === 'start') {
            updates.transitionStart = undefined;
          } else {
            updates.transitionEnd = undefined;
          }
          return { ...c, ...updates };
        })
      }
    }));
  }

  const handleOpenTransitionDurationModal = (trackId: string, clipId: string) => {
    const track = [...videoTracks, ...audioTracks].find(t => t.id === trackId);
    const clip = track?.clips.find(c => c.id === clipId);
    if (track && clip) {
      setEditingTransitionClip({ trackId, clip });
    }
  }

  const handleUpdateTransitionDuration = (trackId: string, clipId: string, startDuration?: number, endDuration?: number) => {
    const trackSetter = videoTracks.some(t => t.id === trackId) ? setVideoTracks : setAudioTracks;
    trackSetter(prev => prev.map(track => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map(c => {
          if (c.id !== clipId) return c;
          const updates: Partial<Clip> = {};
          if (startDuration !== undefined && c.transitionStart) {
            updates.transitionStart = { ...c.transitionStart, duration: startDuration };
          }
          if (endDuration !== undefined && c.transitionEnd) {
            updates.transitionEnd = { ...c.transitionEnd, duration: endDuration };
          }
          return { ...c, ...updates };
        })
      }
    }));
  }

  // Reframe Logic
  const handleOpenReframeModal = (trackId: string, clipId: string) => {
    const track = videoTracks.find(t => t.id === trackId);
    const clip = track?.clips.find(c => c.id === clipId);
    if (track && clip) {
      setReframeModalClip({ trackId, clip });
      setIsPlaying(false); // Pause main timeline
    }
  };

  const handleSaveReframe = (keyframes: ReframeKeyframe[]) => {
    if (!reframeModalClip) return;
    const { trackId, clip } = reframeModalClip;

    setVideoTracks(prev => prev.map(track => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map(c => {
          if (c.id !== clip.id) return c;
          return { ...c, reframeKeyframes: keyframes };
        })
      }
    }));
    setReframeModalClip(null);
  };

  const handleClipMuteToggle = (trackId: string, clipId: string) => {
    const trackSetter = videoTracks.some(t => t.id === trackId) ? setVideoTracks : setAudioTracks;
    trackSetter(prev => prev.map(track => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map(c => {
          if (c.id !== clipId) return c;
          return { ...c, isMuted: !c.isMuted };
        })
      }
    }));
  };

  const onMergeClips = () => {
    if (selectedClips.length < 2) return;

    // Group selected clips by track
    const clipsByTrack: { [trackId: string]: Clip[] } = {};
    const allTracks = [...videoTracks, ...audioTracks];

    selectedClips.forEach(selected => {
      const track = allTracks.find(t => t.id === selected.trackId);
      const clip = track?.clips.find(c => c.id === selected.clipId);
      if (clip) {
        if (!clipsByTrack[selected.trackId]) {
          clipsByTrack[selected.trackId] = [];
        }
        clipsByTrack[selected.trackId].push(clip);
      }
    });

    for (const trackId in clipsByTrack) {
      const clipsToMerge = clipsByTrack[trackId].sort((a, b) => a.timelineStart - b.timelineStart);

      if (clipsToMerge.length < 2) continue; // Need at least two clips to merge

      const firstClip = clipsToMerge[0];
      const lastClip = clipsToMerge[clipsToMerge.length - 1];

      // Check if all clips are from the same media file and are contiguous in source
      const allSameMediaFile = clipsToMerge.every(c => c.mediaFileId === firstClip.mediaFileId);
      const areContiguousInSource = clipsToMerge.slice(0, -1).every((c, i) => {
        const nextClip = clipsToMerge[i + 1];
        // Check if the end of current clip's source is the start of the next clip's source
        // Allowing for small floating point inaccuracies
        return Math.abs(c.sourceEnd - nextClip.sourceStart) < 0.001;
      });

      if (!allSameMediaFile || !areContiguousInSource) {
        console.warn("Cannot merge clips: They must be from the same media file and contiguous in source time.");
        continue;
      }

      // Create a new merged clip
      const mergedClip: Clip = {
        ...firstClip, // Take properties from the first clip
        id: generateId(), // New ID for the merged clip
        sourceEnd: lastClip.sourceEnd, // End at the source end of the last clip
        timelineStart: firstClip.timelineStart, // Start at the timeline start of the first clip
        // Clear transitions as they might not make sense after merge
        transitionStart: undefined,
        transitionEnd: undefined,
      };

      const trackSetter = videoTracks.some(t => t.id === trackId) ? setVideoTracks : setAudioTracks;
      trackSetter(prev => prev.map(track => {
        if (track.id !== trackId) return track;

        // Filter out all merged clips and add the new one
        const remainingClips = track.clips.filter(c => !clipsToMerge.some(mc => mc.id === c.id));
        const newClips = [...remainingClips, mergedClip].sort((a, b) => a.timelineStart - b.timelineStart);

        if (isMagnetMode) {
          let time = 0;
          const compacted = newClips.map(c => {
            const dur = getClipDuration(c);
            const newC = { ...c, timelineStart: time };
            time += dur;
            return newC;
          });
          return { ...track, clips: compacted };
        }
        return { ...track, clips: newClips };
      }));
    }

    setSelectedClip(null);
    setSelectedClips([]);
  };


  const handleOpenSaveModal = (format: 'mp4' | 'mov') => {
    setSaveFormat(format);
    setIsSaveModalOpen(true);
  };

  const handleExport = async (filename: string, format: 'mp4' | 'mov') => {
    setIsSaveModalOpen(false);
    setIsExporting(true);
    setIsPlaying(false);

    try {
      // 1. Prepare Timeline Data
      const timelineData = {
        videoTracks,
        audioTracks,
        duration,
        template: activeTemplate
      };

      // 2. Prepare Form Data
      const formData = new FormData();
      formData.append('timeline', JSON.stringify(timelineData));
      formData.append('filename', filename);
      formData.append('format', format);

      // 3. Append Media Files
      // We need to upload the actual files so the server can process them
      // We rename them to include the ID so the server can match them
      mediaFiles.forEach(mf => {
        // Append file with ID in name: "ID_OriginalName"
        formData.append('videos', mf.file, `${mf.id}_${mf.file.name}`);
      });

      console.log('Starting backend export...');

      // 4. Send Export Request
      const response = await fetch('http://localhost:3001/export', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      const { exportId: id } = await response.json();
      console.log(`Export started with ID: ${id}`);
      setExportId(id);
      setExportProgress({ status: 'processing', progress: 0 });

      // 5. Poll for Progress
      // 5. Subscribe to Progress Updates (SSE)
      const eventSource = new EventSource(`http://localhost:3001/export-progress/${id}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.status === 'error') {
            eventSource.close();
            setIsExporting(false);
            setExportProgress({ status: 'error', progress: 0, error: data.error });
          } else if (data.status === 'done') {
            eventSource.close();
            setExportProgress({ status: 'done', progress: 100 });

            // 6. Download Result
            const downloadUrl = `http://localhost:3001/download-export/${id}`;
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `${filename}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            console.log('Export complete and downloaded');
          } else {
            // Update progress
            setExportProgress({ status: 'processing', progress: data.progress || 0 });
            console.log(`Export progress: ${data.progress}%`);
          }
        } catch (err) {
          console.error('Error parsing progress event:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.error('EventSource error:', err);
        eventSource.close();
        setIsExporting(false);
        setExportProgress({ status: 'error', progress: 0, error: 'Connection lost' });
      };

    } catch (error: any) {
      console.error('Export error:', error);
      setIsExporting(false);
    }
  };


  const handleAnalyzeBeats = async (trackId: string, clipId: string) => {
    const track = audioTracks.find(t => t.id === trackId); // Assuming audioTracks is the correct source for audio clips
    const clip = track?.clips.find(c => c.id === clipId);
    const mediaFile = mediaFiles.find(f => f.id === clip?.mediaFileId);

    if (!track || !clip || !mediaFile || mediaFile.type !== 'audio') return;

    // Set processing status
    handleClipUpdate(trackId, clipId, { processingStatus: 'processing', processingProgress: 0 });

    try {
      const beats = await analyzeBeats(mediaFile.url);
      handleClipUpdate(trackId, clipId, {
        beats,
        processingStatus: 'done',
        processingProgress: 1
      });
    } catch (error) {
      console.error('Beat detection failed:', error);
      handleClipUpdate(trackId, clipId, { processingStatus: 'error' });
    }
  };

  const handleUpdateTemplateMarkerTime = (markerId: string, newTime: number) => {
    setTemplateMarkers(prev => {
      // Ensure we don't move the initial marker (time 0)
      const marker = prev.find(m => m.id === markerId);
      if (marker && marker.time < 0.1 && newTime > 0.1) return prev;

      // Also ensure we don't move a marker to 0 if there is already one there (unless it's the same one)
      if (newTime < 0.1 && marker && marker.time > 0.1) return prev;

      return prev.map(m => m.id === markerId ? { ...m, time: Math.max(0, newTime) } : m);
    });
  };

  // Calculate if there are any clips on any track
  const hasClips = useMemo(() => {
    const hasVideoClips = videoTracks.some(track => track.clips.length > 0);
    const hasAudioClips = audioTracks.some(track => track.clips.length > 0);
    return hasVideoClips || hasAudioClips;
  }, [videoTracks, audioTracks]);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-300 font-sans">
      <Header onSave={handleOpenSaveModal} hasClips={hasClips} />
      <div className="flex flex-grow overflow-hidden">
        <Sidebar
          mediaFiles={mediaFiles}
          onFileChange={handleFileChange}
          activeTemplate={currentTemplate}
          onTemplateSelect={handleTemplateSelect}
          videoTracks={videoTracks}
          audioTracks={audioTracks}
          onAddClipToTrack={handleAddClipToTrack}
          setDragState={setDragState}
          defaultTransitionDuration={defaultTransitionDuration}
          onDefaultTransitionDurationChange={setDefaultTransitionDuration}
          defaultAudioTransitionDuration={defaultAudioTransitionDuration}
          onDefaultAudioTransitionDurationChange={setDefaultAudioTransitionDuration}
          selectedClips={selectedClips}
          onSetSelectedClips={setSelectedClips}
          onMergeClips={onMergeClips}
          onClipUpdate={handleClipUpdate}
          currentTime={currentTime}
          onRemoveMediaFile={handleRemoveMediaFile}
        />
        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 flex flex-col p-4 md:p-6 lg:p-8 space-y-4 overflow-hidden">
            <Timeline
              mediaFiles={mediaFiles}
              videoTracks={videoTracks}
              audioTracks={audioTracks}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              selectedClip={selectedClip}
              selectedClips={selectedClips}
              activeTrackId={activeTrackId}
              dragState={dragState}
              isMagnetMode={isMagnetMode}
              onSetDragState={setDragState}
              onSetSelectedClip={(clip) => {
                setSelectedClip(clip);
                if (clip) setActiveTrackId(clip.trackId);
              }}
              onSetSelectedClips={setSelectedClips}
              onSetActiveTrackId={setActiveTrackId}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              onMuteToggle={handleMuteToggle}
              onVolumeChange={handleVolumeChange}
              onCut={handleCut}
              onDeleteClip={handleDeleteClip}
              onClipUpdate={handleClipUpdate}
              onClipDurationChange={handleClipDurationChange}
              onAddClip={handleAddClip}
              onMoveClip={handleMoveClip}
              onJumpToStart={handleJumpToStart}
              onJumpToEnd={handleJumpToEnd}
              onToggleMagnetMode={() => setIsMagnetMode(prev => !prev)}
              onUndo={handleUndo}
              canUndo={historyStack.length > 0}
              onRedo={handleRedo}
              canRedo={redoStack.length > 0}
              onApplyTransition={handleApplyTransition}
              onRemoveTransition={handleRemoveTransition}
              onOpenTransitionDurationModal={handleOpenTransitionDurationModal}
              onOpenReframeModal={handleOpenReframeModal}
              onClipMuteToggle={handleClipMuteToggle}
              onAnalyzeBeats={handleAnalyzeBeats}
              onMergeClips={onMergeClips}
              templateMarkers={templateMarkers}
              onAddTemplateMarker={handleAddTemplateMarker}
              onUpdateTemplateMarker={handleUpdateTemplateMarker}
              onUpdateTemplateMarkerTime={handleUpdateTemplateMarkerTime}
              onDeleteTemplateMarker={handleDeleteTemplateMarker}
              currentTemplate={currentTemplate}
            />
          </main>
          <aside className="flex-shrink-0 p-4 md:p-6 lg:p-8 w-[360px] flex items-center justify-center">
            <Preview
              mediaFiles={mediaFiles}
              videoTracks={videoTracks}
              audioTracks={audioTracks}
              template={currentTemplate}
              currentTime={currentTime}
              isPlaying={isPlaying}
            />
          </aside>
        </div>
      </div>
      {isSaveModalOpen && (
        <SaveModal
          format={saveFormat}
          onClose={() => setIsSaveModalOpen(false)}
          onExport={handleExport}
        />
      )}
      {editingTransitionClip && (
        <TransitionDurationModal
          clip={editingTransitionClip.clip}
          trackId={editingTransitionClip.trackId}
          onClose={() => setEditingTransitionClip(null)}
          onSave={handleUpdateTransitionDuration}
        />
      )}
      {reframeModalClip && (
        <ReframeModal
          clip={reframeModalClip.clip}
          mediaFile={mediaFiles.find(m => m.id === reframeModalClip.clip.mediaFileId)!}
          onClose={() => setReframeModalClip(null)}
          onSave={handleSaveReframe}
        />
      )}
      {exportId && (
        <ExportProgressModal
          progress={exportProgress}
          exportId={exportId}
          onClose={() => {
            setIsExporting(false);
            setExportId(null);
            setExportProgress({ status: 'processing', progress: 0 });
          }}
          onDownload={() => {
            // Download is handled automatically in handleExport when status is 'done'
            setIsExporting(false);
            setExportId(null);
            setExportProgress({ status: 'processing', progress: 0 });
          }}
        />
      )}
    </div>
  );
};

export default App;