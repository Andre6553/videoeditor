
export interface MediaFile {
  id: string;
  file: File;
  url: string;
  duration: number;
  type: 'video' | 'audio' | 'image';
}

export type TransitionType =
  | 'cross-dissolve'
  | 'additive-dissolve'
  | 'blur-dissolve'
  | 'non-additive-dissolve'
  | 'smooth-cut'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'fade-in'
  | 'fade-out';

export interface ReframeKeyframe {
  time: number; // Time relative to the clip's source start
  x: number;    // Center X position (0 to 1) relative to video width
  y: number;    // Center Y position (0 to 1) relative to video height
  scale: number;// Scale factor (1 = fit height)
}

export interface Clip {
  id: string;
  mediaFileId: string;
  // Times relative to the media file's own duration
  sourceStart: number;
  sourceEnd: number;
  // Time relative to the main timeline
  timelineStart: number;
  transitionStart?: { type: TransitionType; duration: number };
  transitionEnd?: { type: TransitionType; duration: number };
  reframeKeyframes?: ReframeKeyframe[];
  isMuted?: boolean; // Per-clip mute (independent of track mute)
  volume?: number; // Per-clip volume (0 to 1, multiplied with track volume, default 1)
  speed?: number; // Playback speed multiplier (default 1)
  targetFps?: number; // Target FPS for the clip (e.g. 60)
  processingStatus?: 'idle' | 'processing' | 'done' | 'error';
  processedVideoUrl?: string;
  processingProgress?: number;
  beats?: number[]; // Array of timestamps (in seconds) where beats occur
  colorGrading?: ColorGrading;
}

export interface ColorGrading {
  brightness: number;   // 0-2 (1 = normal)
  contrast: number;     // 0-2 (1 = normal)
  saturation: number;   // 0-2 (1 = normal)
  exposure: number;     // -1 to 1 (0 = normal)
  sharpness: number;    // 0-1 (0 = none)
}

export interface Track {
  id: string;
  clips: Clip[];
  isMuted: boolean;
  type: 'video' | 'audio';
  volume: number; // 0 to 1
}

export type TemplateLayout = 'solo' | 'duet-vertical' | 'duet-horizontal' | 'trio-stack';

export interface Template {
  id: string;
  name: string;
  description: string;
  layout: TemplateLayout;
  videoTracks: number;
}

export interface TemplateMarker {
  id: string;
  time: number;
  templateId: string;
}

export interface SelectedClip {
  trackId: string;
  clipId: string;
}

export interface DragState {
  isDragging: boolean;
  type: 'new' | 'move' | 'transition' | 'template' | null;
  mediaType: 'video' | 'audio' | 'image' | null;
  transitionType?: TransitionType;
  id: string | null; // mediaFileId or clipId
  sourceTrackId: string | null;
  dragOffsetX: number;
  templateId?: string;
}

// Video Tracking Service Types
export interface FocusPoint {
  x: number;
  y: number;
}

export interface ReframePosition {
  time: number;
  x: number;
  y: number;
  scale: number;
}

export interface TrackingOptions {
  video: HTMLVideoElement;
  focusPoint: FocusPoint;
  duration: number;
  progressCallback?: (progress: number) => void;
}

export interface TrackingResult {
  keyframes: ReframePosition[];
  confidence: number;
  trackingData: {
    subjectPath: { x: number; y: number; time: number }[];
    totalFrames: number;
    processedFrames: number;
  };
}

export interface VideoTrackingService {
  trackSubject(options: TrackingOptions): Promise<ReframePosition[]>;
  getLastTrackingConfidence(): number;
}