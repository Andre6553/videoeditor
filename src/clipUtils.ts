// src/clipUtils.ts

import type { Clip, Track } from '../types';

/**
 * Determine if two clips are adjacent on the same track.
 * Adjacent means the end time of the earlier clip equals the start time of the later clip.
 */
export function areClipsAdjacent(track: Track, clipA: Clip, clipB: Clip): boolean {
    const getClipDuration = (clip: Clip) => (clip.sourceEnd - clip.sourceStart) / (clip.speed || 1);
    const aEnd = clipA.timelineStart + getClipDuration(clipA);
    const bStart = clipB.timelineStart;
    const bEnd = clipB.timelineStart + getClipDuration(clipB);
    const aStart = clipA.timelineStart;
    // Check both orders for adjacency
    if (Math.abs(aEnd - bStart) < 0.001) return true;
    if (Math.abs(bEnd - aStart) < 0.001) return true;
    return false;
}

/**
 * Merge two adjacent clips into a single clip.
 * Assumes clips are adjacent and belong to the same track.
 * Preserves source start from the earlier clip and source end from the later clip.
 * Keeps transitionStart from the earlier and transitionEnd from the later.
 * Other properties (volume, speed, reframeKeyframes, etc.) are taken from the first clip.
 */
export function mergeTwoClips(track: Track, clipA: Clip, clipB: Clip): Clip {
    // Determine order based on timelineStart
    const [first, second] = clipA.timelineStart <= clipB.timelineStart ? [clipA, clipB] : [clipB, clipA];
    const merged: Clip = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`,
        mediaFileId: first.mediaFileId,
        sourceStart: first.sourceStart,
        sourceEnd: second.sourceEnd,
        timelineStart: first.timelineStart,
        // Preserve transitions
        transitionStart: first.transitionStart,
        transitionEnd: second.transitionEnd,
        // Preserve other optional fields from the first clip where appropriate
        reframeKeyframes: first.reframeKeyframes,
        isMuted: first.isMuted,
        volume: first.volume,
        speed: first.speed,
        targetFps: first.targetFps,
        processingStatus: first.processingStatus,
        processedVideoUrl: first.processedVideoUrl,
        processingProgress: first.processingProgress,
        beats: first.beats,
    };
    return merged;
}
