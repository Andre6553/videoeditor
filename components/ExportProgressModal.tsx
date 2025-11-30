import React from 'react';
import { ExportProgress } from '../services/backendExportService';

interface ExportProgressModalProps {
    progress: ExportProgress;
    exportId: string | null;
    onClose: () => void;
    onDownload: () => void;
}

export const ExportProgressModal: React.FC<ExportProgressModalProps> = ({
    progress,
    exportId,
    onClose,
    onDownload
}) => {
    if (!exportId) return null;

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full border border-gray-700">
                <h2 className="text-xl font-bold text-white mb-4">
                    {progress.status === 'processing' && '⏳ Exporting Video...'}
                    {progress.status === 'done' && '✅ Export Complete!'}
                    {progress.status === 'error' && '❌ Export Failed'}
                </h2>

                {progress.status === 'processing' && (
                    <>
                        <div className="mb-4">
                            <div className="flex justify-between text-sm text-gray-300 mb-2">
                                <span>Progress</span>
                                <span>{Math.round(progress.progress)}%</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-3">
                                <div
                                    className="bg-gradient-to-r from-orange-500 to-orange-600 h-3 rounded-full transition-all duration-300"
                                    style={{ width: `${progress.progress}%` }}
                                />
                            </div>
                        </div>

                        <p className="text-sm text-gray-400 mb-4">
                            You can close this and continue editing. The export will continue in the background.
                        </p>

                        <button
                            onClick={onClose}
                            className="w-full px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 text-white"
                        >
                            Continue Editing
                        </button>
                    </>
                )}

                {progress.status === 'done' && (
                    <>
                        <p className="text-gray-300 mb-4">
                            Your video has been exported successfully!
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={onDownload}
                                className="flex-1 px-4 py-2 bg-orange-600 rounded hover:bg-orange-500 text-white font-bold"
                            >
                                Download Video
                            </button>
                            <button
                                onClick={onClose}
                                className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 text-white"
                            >
                                Close
                            </button>
                        </div>
                    </>
                )}

                {progress.status === 'error' && (
                    <>
                        <p className="text-red-400 mb-4">
                            {progress.error || 'An unknown error occurred during export'}
                        </p>
                        <button
                            onClick={onClose}
                            className="w-full px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 text-white"
                        >
                            Close
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};
