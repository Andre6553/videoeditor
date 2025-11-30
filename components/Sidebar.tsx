import React, { useState, useEffect, useRef } from 'react';
import type { Template, MediaFile, Track, DragState, TransitionType, SelectedClip, Clip } from '../types';
import { TemplateCard } from './TemplateCard';
import { UploadIcon, FilmIcon, MusicIcon, ImageIcon, WandIcon, AdjustmentsHorizontalIcon } from './Icons';
import { ColorGradingPanel } from './ColorGradingPanel';
import { ColorGradingPreviewModal } from './ColorGradingPreviewModal';
import { Tooltip } from './Tooltip';

const TEMPLATES: Template[] = [
  { id: 'solo', name: 'Solo Reel', description: 'One full-screen vertical video.', layout: 'solo', videoTracks: 1 },
  { id: 'duet-vertical', name: 'Duet Split', description: 'Two videos side-by-side.', layout: 'duet-vertical', videoTracks: 2 },
  { id: 'duet-horizontal', name: 'Duet Stack', description: 'Two videos stacked horizontally.', layout: 'duet-horizontal', videoTracks: 2 },
  { id: 'trio-stack', name: 'Trio Stack', description: 'Three videos stacked.', layout: 'trio-stack', videoTracks: 3 },
];

const TRANSITIONS: { type: TransitionType; label: string }[] = [
  { type: 'cross-dissolve', label: 'Cross Dissolve' },
  { type: 'additive-dissolve', label: 'Additive Dissolve' },
  { type: 'blur-dissolve', label: 'Blur Dissolve' },
  { type: 'non-additive-dissolve', label: 'Non-Additive Dissolve' },
  { type: 'smooth-cut', label: 'Smooth Cut' },
  { type: 'dip-to-black', label: 'Dip to Black' },
  { type: 'dip-to-white', label: 'Dip to White' },
];


interface ContextMenuState {
  x: number;
  y: number;
  visible: boolean;
  mediaFile: MediaFile | null;
}

interface SidebarProps {
  mediaFiles: MediaFile[];
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  activeTemplate: Template;
  onTemplateSelect: (template: Template) => void;
  videoTracks: Track[];
  audioTracks: Track[];
  onAddClipToTrack: (mediaFileId: string, trackId: string) => void;
  setDragState: (state: DragState) => void;
  defaultTransitionDuration: number;
  onDefaultTransitionDurationChange: (duration: number) => void;
  defaultAudioTransitionDuration: number;
  onDefaultAudioTransitionDurationChange: (duration: number) => void;
  selectedClips: SelectedClip[];
  onSetSelectedClips: (clips: SelectedClip[]) => void;
  onMergeClips: () => void;
  onClipUpdate: (trackId: string, clipId: string, updates: Partial<Clip>) => void;
  currentTime: number;
  onRemoveMediaFile: (mediaFileId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mediaFiles,
  onFileChange,
  activeTemplate,
  onTemplateSelect,
  videoTracks,
  audioTracks,
  onAddClipToTrack,
  setDragState,
  defaultTransitionDuration,
  onDefaultTransitionDurationChange,
  defaultAudioTransitionDuration,
  onDefaultAudioTransitionDurationChange,
  selectedClips,
  onSetSelectedClips,
  onMergeClips,
  onClipUpdate,
  currentTime,
  onRemoveMediaFile,
}) => {
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'media' | 'color'>('media');
  const [selectedPreviewMedia, setSelectedPreviewMedia] = useState<MediaFile | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ x: 0, y: 0, visible: false, mediaFile: null });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Determine which media files are used in any track
  const usedMediaIds = new Set<string>();
  [...videoTracks, ...audioTracks].forEach(track => {
    track.clips.forEach(clip => usedMediaIds.add(clip.mediaFileId));
  });

  const getMediaIcon = (type: MediaFile['type']) => {
    switch (type) {
      case 'video': return <FilmIcon className="w-4 h-4 mr-2 text-orange-400" />;
      case 'audio': return <MusicIcon className="w-4 h-4 mr-2 text-teal-400" />;
      case 'image': return <ImageIcon className="w-4 h-4 mr-2 text-indigo-400" />;
      default: return null;
    }
  }

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, mediaFile: MediaFile) => {
    e.dataTransfer.setData('new-media-id', mediaFile.id);
    e.dataTransfer.setData('media-type', mediaFile.type);
    e.dataTransfer.effectAllowed = 'copy';

    setDragState({
      isDragging: true,
      type: 'new',
      mediaType: mediaFile.type,
      id: mediaFile.id,
      sourceTrackId: null,
      dragOffsetX: 0
    });
  };

  const handleTransitionDragStart = (e: React.DragEvent<HTMLDivElement>, type: TransitionType) => {
    e.dataTransfer.effectAllowed = 'copy';
    setDragState({
      isDragging: true,
      type: 'transition',
      transitionType: type,
      mediaType: null,
      id: null,
      sourceTrackId: null,
      dragOffsetX: 0
    });
  }

  const handleDragEnd = () => {
    setDragState({
      isDragging: false,
      type: null,
      mediaType: null,
      id: null,
      sourceTrackId: null,
      dragOffsetX: 0
    });
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>, mediaFile: MediaFile) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, visible: true, mediaFile });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenu.visible && contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu.visible]);

  const lastClickTimeRef = useRef<number>(0);

  const handleDoubleClick = (mediaFile: MediaFile) => {
    if (activeTemplate.layout === 'solo') {
      if (mediaFile.type === 'video' || mediaFile.type === 'image') {
        if (videoTracks.length > 0) {
          onAddClipToTrack(mediaFile.id, videoTracks[0].id);
        }
      } else if (mediaFile.type === 'audio') {
        if (audioTracks.length > 0) {
          onAddClipToTrack(mediaFile.id, audioTracks[0].id);
        }
      }
    }
  };

  const handleMediaClick = (mediaFile: MediaFile) => {
    // Single click sets preview
    setSelectedPreviewMedia(mediaFile);

    // Double-click detection
    const now = Date.now();
    if (now - lastClickTimeRef.current < 300) {
      handleDoubleClick(mediaFile);
    }
    lastClickTimeRef.current = now;
  };

  // Auto-play video when preview media changes
  useEffect(() => {
    if (selectedPreviewMedia && selectedPreviewMedia.type === 'video' && previewVideoRef.current) {
      previewVideoRef.current.src = selectedPreviewMedia.url;
      previewVideoRef.current.play().catch(() => { });
    }
  }, [selectedPreviewMedia]);

  // Clear preview if the selected media file no longer exists
  useEffect(() => {
    if (selectedPreviewMedia && !mediaFiles.find(mf => mf.id === selectedPreviewMedia.id)) {
      setSelectedPreviewMedia(null);
    }
  }, [mediaFiles, selectedPreviewMedia]);

  const handleTemplateDragStart = (e: React.DragEvent<HTMLDivElement>, templateId: string) => {
    e.dataTransfer.effectAllowed = 'copy';
    setDragState({
      isDragging: true,
      type: 'template',
      templateId: templateId,
      mediaType: null,
      id: null,
      sourceTrackId: null,
      dragOffsetX: 0
    });
  };

  return (
    <aside className="w-64 lg:w-80 flex-shrink-0 bg-gray-800/50 border-r border-gray-700/50 flex flex-col overflow-hidden">
      {/* Sidebar Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('media')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center transition-colors ${activeTab === 'media'
            ? 'text-orange-500 border-b-2 border-orange-500 bg-gray-800'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
        >
          <FilmIcon className="w-4 h-4 mr-2" />
          Media
        </button>
        <button
          onClick={() => setActiveTab('color')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center transition-colors ${activeTab === 'color'
            ? 'text-orange-500 border-b-2 border-orange-500 bg-gray-800'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
        >
          <AdjustmentsHorizontalIcon className="w-4 h-4 mr-2" />
          Color
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeTab === 'media' ? (
          <>
            <div>
              <h2 className="text-lg font-semibold text-gray-200 mb-3">Media Bin</h2>

              {/* Preview Window */}
              <div className="bg-gray-900 rounded-lg border border-gray-700 mb-3 flex items-center justify-center" style={{ minHeight: '150px', maxHeight: '250px' }}>
                {selectedPreviewMedia ? (
                  selectedPreviewMedia.type === 'video' ? (
                    <video
                      ref={previewVideoRef}
                      className="max-w-full max-h-full object-contain bg-black"
                      loop
                      muted
                      style={{ maxHeight: '250px' }}
                    />
                  ) : selectedPreviewMedia.type === 'image' ? (
                    <img
                      src={selectedPreviewMedia.url}
                      alt={selectedPreviewMedia.file.name}
                      className="max-w-full max-h-full object-contain bg-black"
                      style={{ maxHeight: '250px' }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500" style={{ minHeight: '150px' }}>
                      <MusicIcon className="w-12 h-12" />
                    </div>
                  )
                ) : (
                  <div className="w-full flex flex-col items-center justify-center text-gray-500 py-12">
                    <FilmIcon className="w-12 h-12 mb-2 opacity-30" />
                    <span className="text-xs">Select media to preview</span>
                  </div>
                )}
              </div>

              {/* Media Files List */}
              <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                  {mediaFiles.map(mf => {
                    const isUsed = usedMediaIds.has(mf.id);
                    return (
                      <div
                        key={mf.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, mf)}
                        onDragEnd={handleDragEnd}
                        onContextMenu={(e) => handleContextMenu(e, mf)}
                        onClick={() => handleMediaClick(mf)}
                        className={`relative flex items-center bg-gray-800 p-2 rounded-md text-xs cursor-grab active:cursor-grabbing group hover:bg-gray-750 select-none ${selectedPreviewMedia?.id === mf.id ? 'border border-orange-500' : 'border border-transparent'}`}
                      >
                        {isUsed && (
                          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border border-gray-900 shadow-sm z-10" title="Used in timeline" />
                        )}
                        {getMediaIcon(mf.type)}
                        <span className="truncate flex-1" title={mf.file.name}>{mf.file.name}</span>
                        <span className="ml-2 text-gray-400">{mf.duration.toFixed(1)}s</span>
                      </div>
                    );
                  })}
                </div>

                {/* Upload Button - Now at bottom */}
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex items-center justify-center gap-2 text-center text-gray-400 hover:text-orange-400 hover:bg-gray-800 transition-colors py-2 px-3 rounded border border-dashed border-gray-600 hover:border-orange-400 text-sm"
                >
                  <UploadIcon className="w-4 h-4" />
                  <span className="font-medium">Upload Media</span>
                </label>
                <input id="file-upload" name="file-upload" type="file" className="sr-only" accept="video/*,audio/*,image/jpeg,image/png" onChange={onFileChange} multiple />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-200 flex items-center">
                  <WandIcon className="w-5 h-5 mr-2 text-purple-400" />
                  Transitions
                </h2>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5.0"
                  value={defaultTransitionDuration}
                  onChange={(e) => onDefaultTransitionDurationChange(parseFloat(e.target.value) || 1.0)}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:ring-1 focus:ring-orange-500"
                  title="Default Duration (seconds)"
                />
              </div>
              <div className="bg-gray-900 rounded-lg p-2 border border-gray-700 grid grid-cols-2 gap-2">
                {TRANSITIONS.map(t => (
                  <div
                    key={t.type}
                    draggable
                    onDragStart={(e) => handleTransitionDragStart(e, t.type)}
                    onDragEnd={handleDragEnd}
                    className="bg-gray-800 p-2 rounded text-xs text-center cursor-grab hover:bg-gray-700 border border-transparent hover:border-purple-500 transition-colors"
                  >
                    {t.label}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-200 flex items-center">
                  <WandIcon className="w-5 h-5 mr-2 text-teal-400" />
                  Audio Transitions
                </h2>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5.0"
                  value={defaultAudioTransitionDuration}
                  onChange={(e) => onDefaultAudioTransitionDurationChange(parseFloat(e.target.value) || 1.0)}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:ring-1 focus:ring-teal-500"
                  title="Default Duration (seconds)"
                />
              </div>
              <div className="bg-gray-900 rounded-lg p-2 border border-gray-700 grid grid-cols-2 gap-2">
                <div
                  draggable
                  onDragStart={(e) => handleTransitionDragStart(e, 'fade-in')}
                  onDragEnd={handleDragEnd}
                  className="bg-gray-800 p-2 rounded text-xs text-center cursor-grab hover:bg-gray-700 border border-transparent hover:border-teal-500 transition-colors"
                >
                  Fade In
                </div>
                <div
                  draggable
                  onDragStart={(e) => handleTransitionDragStart(e, 'fade-out')}
                  onDragEnd={handleDragEnd}
                  className="bg-gray-800 p-2 rounded text-xs text-center cursor-grab hover:bg-gray-700 border border-transparent hover:border-teal-500 transition-colors"
                >
                  Fade Out
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-200 mb-3">Templates</h2>
              <div className="space-y-2">
                {TEMPLATES.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isActive={activeTemplate?.id === template.id}
                    onClick={() => onTemplateSelect(template)}
                    onDragStart={(e) => handleTemplateDragStart(e, template.id)}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="h-full">
            {selectedClips.length === 1 ? (
              (() => {
                const selected = selectedClips[0];
                const track = [...videoTracks, ...audioTracks].find(t => t.id === selected.trackId);
                const clip = track?.clips.find(c => c.id === selected.clipId);

                if (clip && track?.type === 'video') {
                  const mediaFile = mediaFiles.find(m => m.id === clip.mediaFileId);
                  return (
                    <>
                      <ColorGradingPanel
                        colorGrading={clip.colorGrading}
                        onChange={(grading) => onClipUpdate(selected.trackId, selected.clipId, { colorGrading: grading })}
                        onPreview={() => setPreviewModalOpen(true)}
                      />
                      {previewModalOpen && mediaFile && (
                        <ColorGradingPreviewModal
                          clip={clip}
                          mediaFile={mediaFile}
                          currentTime={currentTime}
                          onSave={(grading) => {
                            onClipUpdate(selected.trackId, selected.clipId, { colorGrading: grading });
                            setPreviewModalOpen(false);
                          }}
                          onCancel={() => setPreviewModalOpen(false)}
                        />
                      )}
                    </>
                  );
                } else {
                  return (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500 text-center">
                      <p>Selected clip is not a video.</p>
                      <p className="text-xs mt-2">Color grading is only available for video clips.</p>
                    </div>
                  );
                }
              })()
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500 text-center">
                <AdjustmentsHorizontalIcon className="w-12 h-12 mb-4 opacity-20" />
                <p>Select a single video clip</p>
                <p className="text-xs mt-1">to adjust color grading</p>
              </div>
            )}
          </div>
        )}
      </div>

      {contextMenu.visible && contextMenu.mediaFile && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-gray-800 rounded-md shadow-lg border border-gray-700 overflow-hidden text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="p-2 border-b border-gray-700 text-gray-400 truncate">
            {contextMenu.mediaFile.file.name}
          </div>
          <ul>
            {(contextMenu.mediaFile.type === 'video' || contextMenu.mediaFile.type === 'image') && videoTracks.map((track, index) => (
              <li key={track.id}>
                <button
                  onClick={() => {
                    onAddClipToTrack(contextMenu.mediaFile!.id, track.id);
                    setContextMenu(prev => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-700 transition-colors"
                >
                  Add to Video {index + 1}
                </button>
              </li>
            ))}
            {contextMenu.mediaFile.type === 'audio' && audioTracks.map((track, index) => (
              <li key={track.id}>
                <button
                  onClick={() => {
                    onAddClipToTrack(contextMenu.mediaFile!.id, track.id);
                    setContextMenu(prev => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-700 transition-colors"
                >
                  Add to Audio {index + 1}
                </button>
              </li>
            ))}
            {/* Separator */}
            {((contextMenu.mediaFile.type === 'video' || contextMenu.mediaFile.type === 'image') && videoTracks.length > 0) || (contextMenu.mediaFile.type === 'audio' && audioTracks.length > 0) ? (
              <li className="border-t border-gray-700"></li>
            ) : null}
            {/* Remove Clip Option */}
            <li>
              <button
                onClick={() => {
                  if (!usedMediaIds.has(contextMenu.mediaFile!.id)) {
                    onRemoveMediaFile(contextMenu.mediaFile!.id);
                    setContextMenu(prev => ({ ...prev, visible: false }));
                  }
                }}
                disabled={usedMediaIds.has(contextMenu.mediaFile!.id)}
                className={`w-full text-left px-4 py-2 transition-colors ${usedMediaIds.has(contextMenu.mediaFile!.id)
                  ? 'text-gray-500 cursor-not-allowed'
                  : 'text-red-400 hover:bg-gray-700 hover:text-red-300'
                  }`}
                title={usedMediaIds.has(contextMenu.mediaFile!.id) ? 'Cannot remove clip that is in use' : 'Remove clip from media bin'}
              >
                Remove Clip
              </button>
            </li>
          </ul>
        </div>
      )}
    </aside>
  );
};