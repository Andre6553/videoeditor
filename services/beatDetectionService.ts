
export const analyzeBeats = async (url: string): Promise<number[]> => {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const beats: number[] = [];

        // 1. Divide into small windows (e.g., 0.05s) to get an "envelope" of peaks
        const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
        const peaks: { time: number, volume: number }[] = [];

        for (let i = 0; i < channelData.length; i += windowSize) {
            let maxVol = 0;
            for (let j = 0; j < windowSize && i + j < channelData.length; j++) {
                const vol = Math.abs(channelData[i + j]);
                if (vol > maxVol) maxVol = vol;
            }
            peaks.push({ time: i / sampleRate, volume: maxVol });
        }

        // 2. Calculate dynamic threshold using a moving average
        // We look at ~1 second of context to determine if a peak is significant
        const contextSize = 20; // 20 * 50ms = 1 second

        for (let i = 0; i < peaks.length; i++) {
            const currentPeak = peaks[i];

            // Calculate local average (surrounding 1 second)
            let sum = 0;
            let count = 0;
            const start = Math.max(0, i - contextSize / 2);
            const end = Math.min(peaks.length, i + contextSize / 2);

            for (let j = start; j < end; j++) {
                sum += peaks[j].volume;
                count++;
            }
            const localAverage = sum / count;

            // Threshold: The peak must be significantly higher than the local average
            // AND it must be a local maximum in its immediate vicinity
            const thresholdRatio = 1.3; // Tunable: 1.3 means 30% louder than average

            if (currentPeak.volume > localAverage * thresholdRatio && currentPeak.volume > 0.1) {
                // Check if it's the highest point in immediate neighbors to avoid double detection
                const isLocalMax =
                    (i === 0 || currentPeak.volume >= peaks[i - 1].volume) &&
                    (i === peaks.length - 1 || currentPeak.volume >= peaks[i + 1].volume);

                if (isLocalMax) {
                    // Debounce: Ensure beats aren't too close (e.g., 0.25s)
                    if (beats.length === 0 || currentPeak.time - beats[beats.length - 1] > 0.25) {
                        beats.push(currentPeak.time);
                    }
                }
            }
        }

        await audioContext.close();
        return beats;
    } catch (error) {
        console.error("Error analyzing beats:", error);
        return [];
    }
};
