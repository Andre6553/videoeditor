import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export const initFFmpeg = async () => {
    if (ffmpeg) return ffmpeg;

    ffmpeg = new FFmpeg();

    // Load ffmpeg.wasm from a CDN or local public folder
    // Using unpkg for simplicity in this environment, but in production should be local
    const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
    });

    return ffmpeg;
};
export const convertFps = async (
    file: File,
    targetFps: number,
    speed: number,
    onProgress: (progress: number) => void
): Promise<string> => {
    // Initialize FFmpeg (not used anymore, but kept for compatibility)
    await initFFmpeg();

    const formData = new FormData();
    formData.append('video', file);
    formData.append('targetFps', targetFps.toString());
    formData.append('speed', speed.toString());

    console.log('Uploading video to server for processing...');
    console.log('Target FPS:', targetFps, 'Speed:', speed);

    try {
        // 1. Start the job
        const startResponse = await fetch('http://localhost:3001/process-video', {
            method: 'POST',
            body: formData
        });

        if (!startResponse.ok) {
            throw new Error(`Server error: ${startResponse.statusText}`);
        }

        const { jobId } = await startResponse.json();
        console.log(`Job started: ${jobId}`);

        // 2. Listen for progress updates via SSE
        return new Promise((resolve, reject) => {
            const eventSource = new EventSource(`http://localhost:3001/progress/${jobId}`);

            eventSource.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                console.log('SSE Update:', data);

                if (data.status === 'processing') {
                    const progress = data.progress / 100;
                    onProgress(Math.min(progress, 0.99));
                } else if (data.status === 'done') {
                    eventSource.close();
                    onProgress(1);

                    // 3. Return the direct URL
                    const videoUrl = `http://localhost:3001/download/${jobId}`;
                    console.log('Video processed successfully! URL:', videoUrl);
                    resolve(videoUrl);

                } else if (data.status === 'error') {
                    eventSource.close();
                    reject(new Error(data.error || 'Unknown processing error'));
                }
            };

            eventSource.onerror = (err) => {
                console.error('SSE Error:', err);
                eventSource.close();
                reject(new Error('Connection to progress stream failed'));
            };
        });

    } catch (error) {
        console.error('Failed to process video:', error);
        throw error;
    }
};
