import React, { useState } from 'react';
import { Clip } from '../types';

interface TransitionDurationModalProps {
  clip: Clip;
  trackId: string;
  onClose: () => void;
  onSave: (trackId: string, clipId: string, startDuration: number | undefined, endDuration: number | undefined) => void;
}

export const TransitionDurationModal: React.FC<TransitionDurationModalProps> = ({ clip, trackId, onClose, onSave }) => {
  const [startDur, setStartDur] = useState<string>(clip.transitionStart ? clip.transitionStart.duration.toString() : '');
  const [endDur, setEndDur] = useState<string>(clip.transitionEnd ? clip.transitionEnd.duration.toString() : '');

  const handleSave = () => {
    const s = parseFloat(startDur);
    const e = parseFloat(endDur);
    
    onSave(
        trackId, 
        clip.id, 
        !isNaN(s) && clip.transitionStart ? s : undefined, 
        !isNaN(e) && clip.transitionEnd ? e : undefined
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl border border-gray-700 w-80" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white mb-4">Transition Duration</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Start Transition (seconds)</label>
            <input 
                type="number" 
                step="0.1" 
                min="0.1"
                disabled={!clip.transitionStart}
                value={startDur}
                onChange={(e) => setStartDur(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder={!clip.transitionStart ? "No transition" : "Duration"}
            />
          </div>
          
          <div>
            <label className="block text-xs text-gray-400 mb-1">End Transition (seconds)</label>
            <input 
                type="number" 
                step="0.1" 
                min="0.1"
                disabled={!clip.transitionEnd}
                value={endDur}
                onChange={(e) => setEndDur(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder={!clip.transitionEnd ? "No transition" : "Duration"}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end space-x-2">
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-500">Save</button>
        </div>
      </div>
    </div>
  );
};