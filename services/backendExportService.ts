// Backend export service
const API_URL = 'http://localhost:3001';

export interface ExportRequest {
    timeline: {
        videoTracks: any[];
        audioTracks: any[];
        duration: number;
        template: any;
    };
    mediaFiles: Map<string, File>;
}

export interface ExportProgress {
    status: 'processing' | 'done' | 'error';
    progress: number;
    error?: string;
}

export const backendExportService = {
    async startExport(request: ExportRequest, progressCallback: (progress: ExportProgress) => void): Promise<string> {
        const formData = new FormData();

        // Add timeline data as JSON string
        formData.append('timeline', JSON.stringify(request.timeline));

        // Add video files
        for (const [mediaFileId, file] of request.mediaFiles.entries()) {
            formData.append('videos', file, mediaFileId);
        }

        // Start export
        const response = await fetch(`${API_URL}/export`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Export failed: ${response.statusText}`);
        }

        const { exportId } = await response.json();

        // Listen for progress updates via SSE
        const eventSource = new EventSource(`${API_URL}/export-progress/${exportId}`);

        eventSource.onmessage = (event) => {
            const data: ExportProgress = JSON.parse(event.data);
            progressCallback(data);

            if (data.status === 'done' || data.status === 'error') {
                eventSource.close();
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            progressCallback({
                status: 'error',
                progress: 0,
                error: 'Connection to server lost'
            });
        };

        return exportId;
    },

    getDownloadUrl(exportId: string): string {
        return `${API_URL}/download-export/${exportId}`;
    },

    async downloadExport(exportId: string, filename: string): Promise<void> {
        const url = this.getDownloadUrl(exportId);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
};
