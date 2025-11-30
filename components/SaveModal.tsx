import React, { useState } from 'react';

interface SaveModalProps {
  format: 'mp4' | 'mov';
  onClose: () => void;
  onExport: (filename: string, format: 'mp4' | 'mov') => void;
}

export const SaveModal: React.FC<SaveModalProps> = ({ format, onClose, onExport }) => {
  const [filename, setFilename] = useState('my-awesome-reel');

  const handleExportClick = () => {
    if (filename.trim() === '') {
      alert('Please enter a valid filename.');
      return;
    }
    onExport(filename, format);
  };

  return (
    <div
      className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-2xl p-6 border border-gray-700 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-4">Export Project</h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="filename" className="block text-sm font-medium text-gray-300 mb-1">
              Filename
            </label>
            <div className="flex items-center">
              <input
                type="text"
                id="filename"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                className="flex-grow bg-gray-900 border border-gray-600 rounded-l-md p-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition"
              />
              <span className="inline-flex items-center px-3 text-gray-300 bg-gray-700 border border-l-0 border-gray-600 rounded-r-md">
                .{format}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Format
            </label>
            <div className="bg-gray-900 border border-gray-600 rounded-md p-2">
              <p className="text-gray-200">Exporting as <span className="font-bold uppercase">{format}</span> file.</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="py-2 px-4 bg-gray-600 text-white font-semibold rounded-md hover:bg-gray-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExportClick}
            className="py-2 px-4 bg-orange-600 text-white font-semibold rounded-md hover:bg-orange-500 transition-colors"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
};
