import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Template, Track, MediaFile, Clip } from '../types';
import { ColorGradeFilter } from './ColorGradeFilter';

// Helper component for Track rendering to handle ResizeObserver
const TrackRenderer: React.FC<{
  track: Track;
  index: number;
  activeClip: Clip | undefined;
  mediaFile: MediaFile | undefined;
  currentTime: number;
  onVideoRef: (el: HTMLVideoElement | null, index: number) => void;
  videoRefs: React.MutableRefObject<(HTMLVideoElement | null)[]>;
  getTransitionStyles: (clip: Clip, time: number) => any;
  getReframeTransform: (clip: Clip, time: number) => any;
}> = ({ track, index, activeClip, mediaFile, currentTime, onVideoRef, videoRefs, getTransitionStyles, getReframeTransform }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [videoNaturalSize, setVideoNaturalSize] = useState({ width: 0, height: 0 });

  // Stable ref callback for the video element
  const handleVideoRef = useCallback((el: HTMLVideoElement | null) => {
    onVideoRef(el, index);
  }, [onVideoRef, index]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Update natural size whenever active clip changes or video loads
  useEffect(() => {
    const videoEl = videoRefs.current[index];
    if (videoEl) {
      if (videoEl.readyState >= 1) {
        setVideoNaturalSize({ width: videoEl.videoWidth, height: videoEl.videoHeight });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip, mediaFile, index, videoRefs]);

  const isImage = mediaFile?.type === 'image';
  const isVideo = mediaFile?.type === 'video';
  const styles = activeClip ? getTransitionStyles(activeClip, currentTime) : { opacity: 0, filter: '', mixBlendMode: 'normal' as const, transform: '', overlayWhiteOpacity: 0 };
  const reframeStyle = activeClip ? getReframeTransform(activeClip, currentTime) : {};

  // Unique ID for the SVG filter
  const filterId = activeClip ? `filter-${activeClip.id}` : undefined;
  const hasColorGrading = activeClip?.colorGrading && (
    activeClip.colorGrading.brightness !== 1 ||
    activeClip.colorGrading.contrast !== 1 ||
    activeClip.colorGrading.saturation !== 1 ||
    activeClip.colorGrading.exposure !== 0 ||
    activeClip.colorGrading.sharpness !== 0
  );

  // Combine transition filters (blur) with color grading filter
  const combinedFilter = [
    styles.filter,
    (isVideo && hasColorGrading) ? `url(#${filterId})` : ''
  ].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} className="bg-black w-full h-full overflow-hidden relative">
      {/* Render the SVG Filter Definition (Invisible) */}
      {isVideo && activeClip && (
        <ColorGradeFilter id={filterId!} grading={activeClip.colorGrading} />
      )}

      {activeClip && styles.overlayWhiteOpacity > 0 && (
        <div
          className="absolute inset-0 bg-white z-20 pointer-events-none"
          style={{ opacity: styles.overlayWhiteOpacity }}
        />
      )}

      {isImage && (
        <img
          src={mediaFile.url}
          alt=""
          className="absolute transition-none"
          style={{
            ...reframeStyle,
            opacity: styles.opacity,
            filter: styles.filter,
            mixBlendMode: styles.mixBlendMode,
            transform: `${reframeStyle.transform} ${styles.transform}`
          }}
        />
      )}

      <video
        ref={handleVideoRef}
        className="absolute transition-none"
        onLoadedMetadata={(e) => {
          const v = e.target as HTMLVideoElement;
          setVideoNaturalSize({ width: v.videoWidth, height: v.videoHeight });
        }}
        style={{
          visibility: 'visible', // Always visible now
          ...reframeStyle,
          opacity: styles.opacity,
          filter: combinedFilter, // Apply SVG filter here
          mixBlendMode: styles.mixBlendMode,
          transform: `${reframeStyle.transform} ${styles.transform}`
        }}
        onError={(e) => {
          const target = e.target as HTMLVideoElement;
          console.error('Video playback error:', target.error);
          console.error('Video src:', target.src);
        }}
      />

      {/* Show 9:16 indicator only when reframe is active */}
      {activeClip && activeClip.reframeKeyframes && activeClip.reframeKeyframes.length > 0 && (
        <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded z-30">
          📱 9:16 Horizontal Pan
        </div>
      )}
    </div>
  );
};



interface PreviewProps {
  mediaFiles: MediaFile[];
  videoTracks: Track[];
  audioTracks: Track[];
  template: Template;
  currentTime: number;
  isPlaying: boolean;
}

const findMediaFile = (id: string, files: MediaFile[]) => files.find(f => f.id === id);

export const Preview: React.FC<PreviewProps> = ({
  mediaFiles,
  videoTracks,
  audioTracks,
  template,
  currentTime,
  isPlaying,
}) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);

  // Refs for RAF loop access
  const videoTracksRef = useRef(videoTracks);
  const mediaFilesRef = useRef(mediaFiles);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => {
    videoTracksRef.current = videoTracks;
    mediaFilesRef.current = mediaFiles;
    currentTimeRef.current = currentTime;
  }, [videoTracks, mediaFiles, currentTime]);

  useEffect(() => {
    videoRefs.current = videoRefs.current.slice(0, videoTracks.length);
    audioRefs.current = audioRefs.current.slice(0, audioTracks.length);
  }, [videoTracks, audioTracks]);

  const getTransitionStyles = (clip: Clip, currentTime: number) => {
    const timeInClip = currentTime - clip.timelineStart;
    const clipDuration = clip.sourceEnd - clip.sourceStart;
    let opacity = 1;
    let filter = '';
    let mixBlendMode: React.CSSProperties['mixBlendMode'] = 'normal';
    let transform = '';
    let overlayWhiteOpacity = 0;

    // Start Transition
    if (clip.transitionStart) {
      const dur = clip.transitionStart.duration;
      if (timeInClip < dur) {
        const progress = timeInClip / dur; // 0 to 1
        switch (clip.transitionStart.type) {
          case 'cross-dissolve': opacity = progress; break;
          case 'dip-to-black': opacity = progress; break;
          case 'dip-to-white': overlayWhiteOpacity = 1 - progress; break;
          case 'blur-dissolve': filter = `blur(${(1 - progress) * 10}px)`; opacity = progress; break;
          case 'additive-dissolve': mixBlendMode = 'plus-lighter'; opacity = progress; break;
          case 'non-additive-dissolve': opacity = progress; break;
          case 'smooth-cut': transform = `scale(${1.1 - (progress * 0.1)})`; opacity = progress; break;
        }
      }
    }

    // End Transition
    if (clip.transitionEnd) {
      const timeLeft = clipDuration - timeInClip;
      const dur = clip.transitionEnd.duration;
      if (timeLeft < dur) {
        const progress = timeLeft / dur; // 1 down to 0
        switch (clip.transitionEnd.type) {
          case 'cross-dissolve': opacity = progress; break;
          case 'dip-to-black': opacity = progress; break;
          case 'dip-to-white': overlayWhiteOpacity = 1 - progress; break;
          case 'blur-dissolve': filter = `blur(${(1 - progress) * 10}px)`; opacity = progress; break;
          case 'additive-dissolve': mixBlendMode = 'plus-lighter'; opacity = progress; break;
          case 'non-additive-dissolve': opacity = progress; break;
          case 'smooth-cut': transform = `scale(${1 + ((1 - progress) * 0.1)})`; opacity = progress; break;
        }
      }
    }

    return { opacity, filter, mixBlendMode, transform, overlayWhiteOpacity };
  };

  // Helper to calculate reframe values (x, y, scale)
  const calculateReframeValues = (clip: Clip, relTime: number) => {
    if (!clip.reframeKeyframes || clip.reframeKeyframes.length === 0) {
      return { x: 0.5, y: 0.5, scale: 1 };
    }

    const sorted = [...clip.reframeKeyframes].sort((a, b) => a.time - b.time);
    let x = 0.5, y = 0.5, scale = 1;

    if (relTime <= sorted[0].time) {
      ({ x, y, scale } = sorted[0]);
    } else if (relTime >= sorted[sorted.length - 1].time) {
      ({ x, y, scale } = sorted[sorted.length - 1]);
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const k1 = sorted[i];
        const k2 = sorted[i + 1];
        if (relTime >= k1.time && relTime < k2.time) {
          const t = (relTime - k1.time) / (k2.time - k1.time);
          const easedT = t * t * (3 - 2 * t); // Smoothstep
          x = k1.x + (k2.x - k1.x) * easedT;
          y = k1.y + (k2.y - k1.y) * easedT;
          scale = k1.scale + (k2.scale - k1.scale) * easedT;
          break;
        }
      }
    }
    return { x, y, scale };
  };

  const getReframeTransform = (clip: Clip, currentTime: number): React.CSSProperties => {
    const relTime = currentTime - clip.timelineStart;
    const { x, y, scale } = calculateReframeValues(clip, relTime);

    const shiftX = (0.5 - x) * 100;
    const shiftY = (0.5 - y) * 100;

    return {
      height: '100%',
      width: 'auto',
      maxWidth: 'none',
      maxHeight: 'none',
      left: '50%',
      top: '50%',
      transform: `translate(-50%, -50%) scale(${scale}) translate(${shiftX}%, ${shiftY}%)`,
      transformOrigin: 'center center'
    }
  }

  // RAF Loop for smooth playback
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;

    const updateLoop = () => {
      const tracks = videoTracksRef.current;
      const files = mediaFilesRef.current;
      const curTime = currentTimeRef.current; // Fallback if needed, but we use videoEl time

      tracks.forEach((track, index) => {
        const videoEl = videoRefs.current[index];
        if (!videoEl || videoEl.paused) return;

        // Find the active clip for this track
        const activeClip = track.clips.find(c => curTime >= c.timelineStart && curTime < c.timelineStart + (c.sourceEnd - c.sourceStart));

        if (activeClip && activeClip.reframeKeyframes && activeClip.reframeKeyframes.length > 0) {
          // Use ACTUAL video time for smoothness
          const relTime = videoEl.currentTime - activeClip.sourceStart;
          const { x, y, scale } = calculateReframeValues(activeClip, relTime);

          const shiftX = (0.5 - x) * 100;
          const shiftY = (0.5 - y) * 100;

          // Apply directly to DOM
          videoEl.style.transform = `translate(-50%, -50%) scale(${scale}) translate(${shiftX}%, ${shiftY}%)`;
        }
      });

      animationFrameId = requestAnimationFrame(updateLoop);
    };

    animationFrameId = requestAnimationFrame(updateLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying]); // Only re-run when play state changes

  const getClipDuration = (clip: Clip) => (clip.sourceEnd - clip.sourceStart) / (clip.speed || 1);

  const syncVideoMedia = () => {
    videoTracks.forEach((track, index) => {
      const videoEl = videoRefs.current[index];
      const activeClip = track.clips.find(
        c => currentTime >= c.timelineStart && currentTime < c.timelineStart + getClipDuration(c)
      );
      const mediaFile = activeClip ? findMediaFile(activeClip.mediaFileId, mediaFiles) : null;

      if (videoEl && mediaFile?.type === 'video') {
        const isClipMuted = activeClip?.isMuted ?? false;
        videoEl.muted = track.isMuted || isClipMuted;
        videoEl.volume = track.volume ?? 1;

        // Determine source URL: processed video takes precedence
        const targetSrc = activeClip.processedVideoUrl || mediaFile.url;
        if (videoEl.src !== targetSrc) {
          videoEl.src = targetSrc;
        }

        // If using processed video, playback rate is 1 (video is already slow)
        // If using original, apply speed
        videoEl.playbackRate = activeClip.processedVideoUrl ? 1 : (activeClip.speed || 1);

        // Calculate media time
        let mediaTime;
        if (activeClip.processedVideoUrl) {
          // Processed video is longer, map 1:1 from start
          mediaTime = (currentTime - activeClip.timelineStart);
        } else {
          // Original video, map using speed
          mediaTime = (currentTime - activeClip.timelineStart) * (activeClip.speed || 1) + activeClip.sourceStart;
        }

        if (Math.abs(videoEl.currentTime - mediaTime) > 0.15) {
          videoEl.currentTime = mediaTime;
        }

        if (isPlaying && videoEl.paused) {
          videoEl.play().catch(e => console.error("Play error:", e));
        } else if (!isPlaying && !videoEl.paused) {
          videoEl.pause();
        }

        videoEl.style.display = 'block';
      } else if (videoEl && !videoEl.paused) {
        videoEl.pause();
        videoEl.style.display = 'none';
      }
    });
  };

  const syncAudioMedia = () => {
    audioTracks.forEach((track, index) => {
      const audioEl = audioRefs.current[index];
      if (!audioEl) return;

      const activeClip = track.clips.find(
        c => currentTime >= c.timelineStart && currentTime < c.timelineStart + (c.sourceEnd - c.sourceStart)
      );
      const isClipMuted = activeClip?.isMuted ?? false;

      audioEl.muted = track.isMuted || isClipMuted;

      // Calculate base volume from track settings, then multiply by clip volume
      let baseVolume = track.volume ?? 1;
      // Apply per-clip volume (multiplicative - clip volume never exceeds track volume)
      if (activeClip) {
        baseVolume *= (activeClip.volume ?? 1);
      }

      if (activeClip) {
        const mediaFile = findMediaFile(activeClip.mediaFileId, mediaFiles);
        if (mediaFile && audioEl.src !== mediaFile.url) {
          audioEl.src = mediaFile.url;
        }

        audioEl.playbackRate = activeClip.speed || 1;

        const mediaTime = (currentTime - activeClip.timelineStart) * (activeClip.speed || 1) + activeClip.sourceStart;
        if (Math.abs(audioEl.currentTime - mediaTime) > 0.15) {
          audioEl.currentTime = mediaTime;
        }

        // Apply fade-in and fade-out transitions
        const timeInClip = currentTime - activeClip.timelineStart;
        const clipDuration = activeClip.sourceEnd - activeClip.sourceStart;

        // Handle transition at START of clip
        if (activeClip.transitionStart) {
          const fadeDuration = activeClip.transitionStart.duration;
          if (timeInClip < fadeDuration) {
            if (activeClip.transitionStart.type === 'fade-in') {
              // Fade IN: 0 → current volume
              const fadeProgress = timeInClip / fadeDuration; // 0 to 1
              baseVolume *= fadeProgress;
            } else if (activeClip.transitionStart.type === 'fade-out') {
              // Fade OUT: current volume → 0
              const fadeProgress = 1 - (timeInClip / fadeDuration); // 1 to 0
              baseVolume *= fadeProgress;
            }
          } else {
            // After fade completes
            if (activeClip.transitionStart.type === 'fade-out') {
              // Keep volume at 0 after fade-out completes
              baseVolume = 0;
            }
            // For fade-in, volume stays at full (no change needed)
          }
        }

        // Handle transition at END of clip
        if (activeClip.transitionEnd) {
          const fadeDuration = activeClip.transitionEnd.duration;
          const timeLeft = clipDuration - timeInClip;
          if (timeLeft < fadeDuration) {
            if (activeClip.transitionEnd.type === 'fade-in') {
              // Fade IN: 0 → current volume
              const fadeProgress = 1 - (timeLeft / fadeDuration); // 0 to 1 (as time left decreases)
              baseVolume *= fadeProgress;
            } else if (activeClip.transitionEnd.type === 'fade-out') {
              // Fade OUT: current volume → 0
              const fadeProgress = timeLeft / fadeDuration; // 1 to 0
              baseVolume *= fadeProgress;
            }
          } else {
            // Before fade starts
            if (activeClip.transitionEnd.type === 'fade-in') {
              // Keep volume at 0 before fade-in starts
              baseVolume = 0;
            }
            // For fade-out, volume stays at full (no change needed)
          }
        }

        // Apply the calculated volume
        audioEl.volume = baseVolume;

        if (isPlaying && audioEl.paused) {
          audioEl.play().catch(e => console.error("Play error:", e));
        } else if (!isPlaying && !audioEl.paused) {
          audioEl.pause();
        }
      } else {
        if (!audioEl.paused) audioEl.pause();
      }
    });
  }

  useEffect(() => {
    syncVideoMedia();
    syncAudioMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, isPlaying, videoTracks, audioTracks, mediaFiles]);


  // Stable ref callback
  const setVideoRef = useCallback((el: HTMLVideoElement | null, index: number) => {
    videoRefs.current[index] = el;
  }, []);

  const setAudioRef = useCallback((el: HTMLAudioElement | null, index: number) => {
    audioRefs.current[index] = el;
  }, []);

  const layoutClasses: Record<Template['layout'], string> = {
    'solo': 'grid grid-cols-1 grid-rows-1 gap-0',
    'duet-vertical': 'grid grid-cols-2 grid-rows-1 gap-0',
    'duet-horizontal': 'grid grid-cols-1 grid-rows-2 gap-0',
    'trio-stack': 'grid grid-cols-1 grid-rows-3 gap-0',
  };

  return (
    <div className="h-full w-full bg-black rounded-lg flex items-center justify-center overflow-hidden shadow-2xl ring-1 ring-gray-700 aspect-[9/16]">
      {mediaFiles.length > 0 ? (
        <div className={`w-full h-full ${layoutClasses[template.layout]}`}>
          {videoTracks.map((track, index) => {
            const activeClip = track.clips.find(c => currentTime >= c.timelineStart && currentTime < c.timelineStart + (c.sourceEnd - c.sourceStart));
            const mediaFile = activeClip ? findMediaFile(activeClip.mediaFileId, mediaFiles) : null;
            const isImage = mediaFile?.type === 'image';
            const isVideo = mediaFile?.type === 'video';

            const styles = activeClip ? getTransitionStyles(activeClip, currentTime) : { opacity: 0, filter: '', mixBlendMode: 'normal' as const, transform: '', overlayWhiteOpacity: 0 };
            const reframeStyle = activeClip ? getReframeTransform(activeClip, currentTime) : {};

            return (
              <TrackRenderer
                key={track.id}
                track={track}
                index={index}
                activeClip={activeClip}
                mediaFile={mediaFile}
                currentTime={currentTime}
                onVideoRef={setVideoRef}
                videoRefs={videoRefs}
                getTransitionStyles={getTransitionStyles}
                getReframeTransform={getReframeTransform}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-gray-500 text-center p-8">
          <h3 className="text-xl font-semibold">Welcome to the Reel Editor</h3>
          <p className="mt-2">Upload a file to get started.</p>
        </div>
      )}
      {/* Audio elements are not visible */}
      {audioTracks.map((track, index) => (
        <audio key={track.id} ref={(el) => setAudioRef(el, index)} />
      ))}
    </div>
  );
};