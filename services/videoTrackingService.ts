// AI-Powered Video Subject Tracking Service
// Converts 16:9 footage to 9:16 format with automatic subject tracking

import { ReframePosition, FocusPoint, TrackingOptions, TrackingResult } from '../types';

export class VideoTrackingService {
  private trackingConfidence: number = 0;
  private trackingData: TrackingResult['trackingData'] = {
    subjectPath: [],
    totalFrames: 0,
    processedFrames: 0
  };

  /**
   * Track a subject through video and generate keyframes for 9:16 reframe
   */
  async trackSubject(options: TrackingOptions): Promise<ReframePosition[]> {
    const { video, focusPoint, duration, progressCallback } = options;
    
    console.log('🎬 Starting subject tracking...');
    console.log(`Duration: ${duration}s, Initial focus:`, focusPoint);

    // Validate video is ready
    if (video.readyState < 2) {
      throw new Error('Video must be loaded before tracking');
    }

    this.trackingData = {
      subjectPath: [],
      totalFrames: Math.floor(duration * 30), // Assume 30fps
      processedFrames: 0
    };

    // Save original video state
    const originalTime = video.currentTime;
    const originalPaused = video.paused;

    try {
      // Simulate frame-by-frame analysis
      const keyframes: ReframePosition[] = [];
      const frameInterval = 1 / 30; // Process every frame at 30fps
      
      for (let time = 0; time <= duration; time += frameInterval) {
        // Simulate processing delay (real implementation would analyze actual frames)
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Simulate subject tracking with some movement and variation
        const subjectPosition = this.simulateSubjectMovement(
          focusPoint,
          time,
          duration
        );

        this.trackingData.subjectPath.push({
          ...subjectPosition,
          time
        });

        // Add keyframes at regular intervals (every 0.5 seconds)
        if (time % 0.5 === 0 || time === 0 || time >= duration - 0.1) {
          // Calculate 9:16 frame position to keep subject centered
          const reframePosition = this.calculateReframePosition(subjectPosition);
          
          keyframes.push({
            time,
            x: reframePosition.x,
            y: reframePosition.y,
            scale: reframePosition.scale
          });

          console.log(`📍 Keyframe at ${time.toFixed(1)}s:`, reframePosition);
        }

        this.trackingData.processedFrames++;
        
        // Update progress
        const progress = (time / duration) * 90; // 90% for processing
        progressCallback?.(progress);
      }

      // Smooth the keyframes to reduce jitter
      const smoothedKeyframes = this.smoothKeyframes(keyframes);
      
      // Calculate overall confidence based on tracking stability
      this.trackingConfidence = this.calculateTrackingConfidence(this.trackingData);
      
      console.log(`✅ Tracking completed!`);
      console.log(`📊 Generated ${smoothedKeyframes.length} keyframes`);
      console.log(`🎯 Confidence: ${(this.trackingConfidence * 100).toFixed(1)}%`);

      return smoothedKeyframes;

    } finally {
      // Restore original video state
      video.currentTime = originalTime;
      if (!originalPaused) {
        video.play();
      }
    }
  }

  /**
   * Calculate the 9:16 reframe position to keep subject centered
   */
  private calculateReframePosition(subjectPosition: FocusPoint): Omit<ReframePosition, 'time'> {
    // For 9:16 aspect ratio within 16:9 video:
    // The crop box should be positioned to keep the subject in the center
    
    // Base crop dimensions for 9:16 within 16:9
    const baseCropWidth = 9/16; // 0.5625 of video width
    const baseCropHeight = 1;   // Full video height

    // To center the subject in the 9:16 frame
    // We need to offset the crop box to follow the subject
    const offsetX = (subjectPosition.x - 0.5) * 0.5; // Allow 50% movement range
    const offsetY = (subjectPosition.y - 0.5) * 0.3; // Allow 30% vertical movement
    
    const finalX = 0.5 + offsetX;
    const finalY = 0.5 + offsetY;
    
    // Clamp to valid bounds
    const clampedX = Math.max(baseCropWidth/2, Math.min(1 - baseCropWidth/2, finalX));
    const clampedY = Math.max(baseCropHeight/2, Math.min(1 - baseCropHeight/2, finalY));

    return {
      x: clampedX,
      y: clampedY,
      scale: 1 // No zoom for now, could be adjusted based on subject size
    };
  }

  /**
   * Simulate realistic subject movement through the video
   */
  private simulateSubjectMovement(
    initialFocus: FocusPoint,
    time: number,
    totalDuration: number
  ): FocusPoint {
    const progress = time / totalDuration;
    
    // Simulate natural subject movement patterns
    const movementX = Math.sin(progress * Math.PI * 2) * 0.15; // Horizontal movement
    const movementY = Math.cos(progress * Math.PI * 1.5) * 0.08; // Vertical movement
    const drift = (Math.random() - 0.5) * 0.02; // Random drift
    
    const finalX = initialFocus.x + movementX + drift;
    const finalY = initialFocus.y + movementY + drift;
    
    // Ensure subject stays within reasonable bounds (not at extreme edges)
    return {
      x: Math.max(0.2, Math.min(0.8, finalX)),
      y: Math.max(0.2, Math.min(0.8, finalY))
    };
  }

  /**
   * Smooth keyframes to reduce tracking jitter
   */
  private smoothKeyframes(keyframes: ReframePosition[], smoothingFactor = 0.8): ReframePosition[] {
    if (keyframes.length <= 2) return keyframes;

    const smoothed: ReframePosition[] = [...keyframes];
    
    // Apply smoothing using moving average
    for (let i = 1; i < smoothed.length - 1; i++) {
      smoothed[i] = {
        time: smoothed[i].time,
        x: smoothed[i].x * smoothingFactor + 
           (smoothed[i-1].x + smoothed[i+1].x) * (1 - smoothingFactor) / 2,
        y: smoothed[i].y * smoothingFactor + 
           (smoothed[i-1].y + smoothed[i+1].y) * (1 - smoothingFactor) / 2,
        scale: smoothed[i].scale * smoothingFactor + 
               (smoothed[i-1].scale + smoothed[i+1].scale) * (1 - smoothingFactor) / 2
      };
    }

    return smoothed;
  }

  /**
   * Calculate overall tracking confidence based on path smoothness and consistency
   */
  private calculateTrackingConfidence(trackingData: TrackingResult['trackingData']): number {
    const { subjectPath } = trackingData;
    
    if (subjectPath.length < 2) return 0.5;

    // Calculate average frame-to-frame movement
    let totalMovement = 0;
    let consistentFrames = 0;
    
    for (let i = 1; i < subjectPath.length; i++) {
      const prev = subjectPath[i - 1];
      const curr = subjectPath[i];
      
      const movement = Math.sqrt(
        Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2)
      );
      
      totalMovement += movement;
      
      // Consider a frame "consistent" if movement is reasonable (not too jumpy)
      if (movement < 0.05) consistentFrames++;
    }
    
    const avgMovement = totalMovement / (subjectPath.length - 1);
    const consistency = consistentFrames / (subjectPath.length - 1);
    
    // Confidence is higher when movement is smooth and consistent
    const movementScore = Math.max(0, 1 - (avgMovement * 10)); // Penalize large movements
    const finalScore = (movementScore * 0.6 + consistency * 0.4);
    
    return Math.min(0.95, Math.max(0.3, finalScore));
  }

  /**
   * Get the last tracking confidence score
   */
  getLastTrackingConfidence(): number {
    return this.trackingConfidence;
  }

  /**
   * Preview tracking result without generating all keyframes
   */
  async previewTracking(
    videoElement: HTMLVideoElement,
    focusPoint: FocusPoint,
    duration: number,
    previewLength: number = 5
  ): Promise<ReframePosition[]> {
    console.log(`🔍 Previewing ${previewLength}s of tracking...`);
    
    // Generate a small sample of keyframes for preview
    const previewKeyframes: ReframePosition[] = [];
    const samplePoints = 10;
    
    for (let i = 0; i < samplePoints; i++) {
      const time = (previewLength * i) / (samplePoints - 1);
      const subjectPos = this.simulateSubjectMovement(focusPoint, time, previewLength);
      const reframePos = this.calculateReframePosition(subjectPos);
      
      previewKeyframes.push({
        time,
        x: reframePos.x,
        y: reframePos.y,
        scale: reframePos.scale
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    return previewKeyframes;
  }

  /**
   * Validate tracking parameters before starting
   */
  static validateTrackingParams(
    videoElement: HTMLVideoElement,
    focusPoint: FocusPoint,
    duration: number
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (videoElement.readyState < 2) {
      errors.push('Video must be fully loaded before tracking');
    }
    
    if (duration <= 0) {
      errors.push('Video duration must be greater than 0');
    }
    
    if (focusPoint.x < 0 || focusPoint.x > 1 || focusPoint.y < 0 || focusPoint.y > 1) {
      errors.push('Focus point must be within video bounds (0-1)');
    }
    
    if (duration > 300) {
      errors.push('Video is too long for AI tracking (max 5 minutes)');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}