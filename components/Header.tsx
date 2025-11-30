import React, { useState, useEffect } from 'react';
import { FilmIcon, DownloadIcon, TrashIcon } from './Icons';

interface HeaderProps {
  onSave: (format: 'mp4' | 'mov') => void;
  hasClips: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onSave, hasClips }) => {
  const [isClearing, setIsClearing] = useState(false);
  const [hasCache, setHasCache] = useState(false);
  const [cacheFileCount, setCacheFileCount] = useState(0);

  // Check cache status on mount and after clearing
  const checkCacheStatus = async () => {
    try {
      const response = await fetch('http://localhost:3001/cache-status');
      const result = await response.json();
      setHasCache(result.hasCache);
      setCacheFileCount(result.fileCount);
    } catch (error) {
      console.error('Error checking cache status:', error);
    }
  };

  useEffect(() => {
    checkCacheStatus();
    // Check periodically (every 30 seconds)
    const interval = setInterval(checkCacheStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleClearCache = async () => {
    if (!confirm('Are you sure you want to clear all cached processed videos? This will delete all slow-motion videos and exports from the server.')) {
      return;
    }

    setIsClearing(true);
    try {
      const response = await fetch('http://localhost:3001/clear-cache', {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        alert(`Cache cleared successfully! ${result.filesDeleted} files deleted.`);
        // Refresh cache status
        await checkCacheStatus();
      } else {
        alert(`Error clearing cache: ${result.error}`);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      alert('Failed to clear cache. Make sure the server is running.');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <header className="flex-shrink-0 bg-gray-900/80 backdrop-blur-sm border-b border-gray-700/50 shadow-lg z-20">
      <div className="container mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <FilmIcon className="w-8 h-8 text-orange-500" />
          <h1 className="text-xl md:text-2xl font-bold text-gray-100 tracking-wider">
            Instagram Reel Editor
          </h1>
        </div>

        <div className="flex items-center space-x-3">
          {/* Clear Cache Button */}
          <button
            onClick={handleClearCache}
            disabled={isClearing || !hasCache}
            className="flex items-center space-x-2 bg-red-600 text-white font-bold py-2 px-4 rounded-md hover:bg-red-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            title={hasCache ? `Clear ${cacheFileCount} cached file(s)` : 'No cached files to clear'}
          >
            <TrashIcon className="w-5 h-5" />
            <span className="hidden md:inline">{isClearing ? 'Clearing...' : 'Clear Cache'}</span>
          </button>


          {/* Export Button */}
          <button
            onClick={() => onSave('mp4')}
            disabled={!hasClips}
            className="flex items-center space-x-2 bg-orange-600 text-white font-bold py-2 px-4 rounded-md hover:bg-orange-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!hasClips ? 'Add clips to enable export' : 'Export project as MP4'}
          >
            <DownloadIcon className="w-5 h-5" />
            <span>Save Project</span>
          </button>
        </div>
      </div>
    </header>
  );
};
