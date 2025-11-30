const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Set ffmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();
const PORT = 3001;

// Enable CORS and Security Headers
app.use(cors());
app.use(express.json({ limit: '50mb' })); // For timeline data
app.use((req, res, next) => {
    res.header("Cross-Origin-Opener-Policy", "same-origin");
    res.header("Cross-Origin-Embedder-Policy", "require-corp");
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    next();
});

// Create uploads, outputs, and exports directories
const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');
const exportsDir = path.join(__dirname, 'exports');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir);
if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ storage });

// In-memory job store
const jobs = new Map();

// Process video endpoint - Starts the job
app.post('/process-video', upload.single('video'), (req, res) => {
    const { targetFps, speed } = req.body;
    const inputPath = req.file.path;
    const jobId = Date.now().toString();
    const outputFilename = `processed-${jobId}.mp4`;
    const outputPath = path.join(outputsDir, outputFilename);

    console.log(`Starting job ${jobId}: ${inputPath}`);

    // Initialize job
    jobs.set(jobId, {
        status: 'processing',
        progress: 0,
        outputPath,
        inputPath,
        filename: outputFilename
    });

    // Start processing asynchronously
    (async () => {
        try {
            // Get input video duration first
            ffmpeg.ffprobe(inputPath, async (err, metadata) => {
                if (err) {
                    console.error('Error reading metadata:', err);
                    const job = jobs.get(jobId);
                    if (job) {
                        job.status = 'error';
                        job.error = 'Failed to read video metadata';
                        jobs.set(jobId, job);
                    }
                    return;
                }

                const duration = metadata.format.duration;
                const expectedDuration = duration / parseFloat(speed);

                const setptsVal = (1 / parseFloat(speed)).toFixed(2);
                const fps = parseInt(targetFps);

                // Two-step approach: 
                // 1. Interpolate to target FPS 
                // 2. Apply slow-motion timing (setpts)
                // This prevents black frames by ensuring enough frames are generated first
                const videoFilter = `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff,setpts=${setptsVal}*PTS`;

                let audioFilter = '';
                const speedNum = parseFloat(speed);
                if (speedNum === 0.5) audioFilter = 'atempo=0.5';
                else if (speedNum === 0.25) audioFilter = 'atempo=0.5,atempo=0.5';
                else if (speedNum === 2) audioFilter = 'atempo=2.0';
                else if (speedNum < 0.5) audioFilter = 'atempo=0.5,atempo=0.5';
                else if (speedNum > 2) audioFilter = 'atempo=2.0';
                else audioFilter = `atempo=${speedNum}`;

                // Add safeguards to audio processing
                audioFilter += ',volume=0.98,aresample=48000:async=1';

                await new Promise((resolve, reject) => {
                    ffmpeg(inputPath)
                        .videoFilters(videoFilter)
                        .audioFilters(audioFilter)
                        .outputOptions([
                            '-c:v', 'libx264',      // Force H.264 codec
                            '-pix_fmt', 'yuv420p',  // Force YUV420p pixel format (required for broad browser support)
                            '-movflags', '+faststart', // Optimize for web playback
                            '-max_muxing_queue_size', '9999',
                            '-ac', '2',             // Force 2 audio channels
                            '-ar', '48000',         // Force 48kHz audio sample rate
                            '-c:a', 'aac',          // Force AAC codec
                            '-b:a', '320k',         // High bitrate
                            '-threads', Math.max(1, require('os').cpus().length - 1).toString()
                        ])
                        .output(outputPath)
                        .on('progress', (progress) => {
                            const job = jobs.get(jobId);
                            if (job && job.status !== 'done' && job.status !== 'error') {
                                // Calculate progress based on time mark and expected duration
                                if (progress.timemark) {
                                    const timeParts = progress.timemark.split(':');
                                    const seconds = (+timeParts[0]) * 60 * 60 + (+timeParts[1]) * 60 + (+timeParts[2]);
                                    const percent = (seconds / expectedDuration) * 100;
                                    job.progress = Math.max(0, Math.min(99, percent));
                                    jobs.set(jobId, job);
                                }
                            }
                        })
                        .on('end', () => {
                            const job = jobs.get(jobId);
                            if (job) {
                                job.status = 'done';
                                job.progress = 100;
                                jobs.set(jobId, job);
                            }
                            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                            resolve();
                        })
                        .on('error', (err) => {
                            const job = jobs.get(jobId);
                            if (job) {
                                job.status = 'error';
                                job.error = err.message;
                                jobs.set(jobId, job);
                            }
                            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                            reject(err);
                        })
                        .run();
                });
            });

        } catch (error) {
            console.error(`Job ${jobId} error:`, error);
            const job = jobs.get(jobId);
            if (job) {
                job.status = 'error';
                job.error = error.message;
                jobs.set(jobId, job);
            }
        }
    })();

    // Return Job ID immediately
    res.json({ jobId });
});

// SSE Endpoint for progress updates
app.get('/progress/:jobId', (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendUpdate = () => {
        const job = jobs.get(jobId);
        if (!job) {
            res.write(`data: ${JSON.stringify({ status: 'error', error: 'Job not found' })}\n\n`);
            res.end();
            return;
        }

        res.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress })}\n\n`);

        if (job.status === 'done' || job.status === 'error') {
            res.end();
        }
    };

    // Send initial update
    sendUpdate();

    // Poll for updates every 500ms
    const interval = setInterval(sendUpdate, 500);

    req.on('close', () => {
        clearInterval(interval);
    });
});

// Download endpoint
app.get('/download/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job || job.status !== 'done' || !fs.existsSync(job.outputPath)) {
        return res.status(404).send('File not ready or not found');
    }

    res.setHeader('Content-Disposition', `inline; filename="${job.filename}"`);
    res.sendFile(job.outputPath);
});

// Helper: Process a single clip into a standardized intermediate chunk
const processClipForExport = (clip, sourcePath, outputDir, index, volume = 1) => {
    return new Promise((resolve, reject) => {
        const chunkFilename = `chunk_${index}_${Date.now()}.mov`;
        const chunkPath = path.join(outputDir, chunkFilename);

        // Calculate trim duration
        const duration = clip.sourceEnd - clip.sourceStart;
        const paddedDuration = duration + 0.133;

        // Build filters
        const videoFilters = [];
        const audioFilters = [];

        // 1. Trimming
        videoFilters.push(`trim=start=${clip.sourceStart}:duration=${paddedDuration}`);
        videoFilters.push(`setpts=PTS-STARTPTS`);
        // Note: setpts moved to after fps filter for better stability

        audioFilters.push(`atrim=start=${clip.sourceStart}:duration=${paddedDuration}`);
        audioFilters.push(`asetpts=PTS-STARTPTS`);
        audioFilters.push(`apad=pad_dur=0.133`);

        // 2. Scaling & Cropping (Standardize to 1080x1920)
        videoFilters.push(`scale=1080:1920:force_original_aspect_ratio=increase`);
        videoFilters.push(`crop=1080:1920:(iw-1080)/2:(ih-1920)/2`);
        videoFilters.push(`setsar=1`);

        // 3. Frame Rate (Standardize to 30fps)
        // This ensures all chunks are identical for concatenation
        videoFilters.push(`fps=30`);
        // FORCE RE-TIMESTAMPS: Generate perfect timestamps after frame rate conversion
        videoFilters.push(`setpts=N/30/TB`);

        // 4. Color Grading (if present)
        if (clip.colorGrading) {
            const { brightness, contrast, saturation, exposure, sharpness } = clip.colorGrading;

            // Calculate effective brightness (combine brightness + exposure)
            // Frontend: brightness 0-2 (1=normal), exposure -1 to 1 (0=normal)
            // FFmpeg eq: brightness -1 to 1 (0=normal)
            const effectiveBrightness = (brightness - 1) + (exposure * 0.5);
            const effectiveContrast = contrast;
            const effectiveSaturation = saturation;

            // Build eq filter parameters
            const eqParams = [];
            if (effectiveBrightness !== 0) eqParams.push(`brightness=${effectiveBrightness.toFixed(3)}`);
            if (effectiveContrast !== 1) eqParams.push(`contrast=${effectiveContrast.toFixed(3)}`);
            if (effectiveSaturation !== 1) eqParams.push(`saturation=${effectiveSaturation.toFixed(3)}`);

            if (eqParams.length > 0) {
                videoFilters.push(`eq=${eqParams.join(':')}`);
            }

            // Sharpness
            if (sharpness && sharpness > 0) {
                const amount = (sharpness * 1.5).toFixed(2);
                videoFilters.push(`unsharp=5:5:${amount}:5:5:0.0`);
            }
        }

        // 5. Audio Volume & Normalization
        audioFilters.push(`aresample=48000`);
        // Apply user volume
        if (volume !== 1) {
            audioFilters.push(`volume=${volume}`);
        }
        // Soft Limiter to prevent clipping (instead of aggressive loudnorm)
        audioFilters.push(`alimiter=limit=0.95:attack=5:release=50:asc=1`);

        // Build the command
        const command = ffmpeg(sourcePath)
            .videoFilters(videoFilters.join(','))
            .outputOptions([
                '-r', '30',             // Force exact 30 fps output
                '-vsync', 'cfr',        // Force constant frame rate
                '-c:v', 'prores_ks',    // ProRes codec (lossless/intermediate)
                '-profile:v', '3',      // ProRes 422 HQ
                '-pix_fmt', 'yuv422p10le', // 10-bit color depth
                '-vendor', 'ap10'       // Apple compatibility
            ]);
        // Check if source has audio by probing
        ffmpeg.ffprobe(sourcePath, (err, metadata) => {
            if (err) {
                reject(err);
                return;
            }

            const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

            if (hasAudio) {
                // Source has audio - process it normally
                command
                    .audioFilters(audioFilters.join(','))
                    .outputOptions([
                        '-c:a', 'pcm_s16le',    // Uncompressed PCM audio
                        '-ac', '2',
                        '-ar', '48000'
                    ])
                    .output(chunkPath)
                    .on('end', () => resolve(chunkPath))
                    .on('error', (err) => reject(err))
                    .run();
            } else {
                // Source has no audio (e.g., image) - generate silent audio
                // We need to use filter_complex to add silent audio stream
                const silentAudioFilter = `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${paddedDuration}`;
                const complexFilter = `${videoFilters.join(',')};${silentAudioFilter}[a]`;

                ffmpeg(sourcePath)
                    .complexFilter(complexFilter)
                    .outputOptions([
                        '-map', '[v]',          // Map the processed video
                        '-map', '[a]',          // Map the generated silent audio
                        '-r', '30',
                        '-vsync', 'cfr',
                        '-c:v', 'prores_ks',    // ProRes codec
                        '-profile:v', '3',      // ProRes 422 HQ
                        '-pix_fmt', 'yuv422p10le',
                        '-vendor', 'ap10',
                        '-c:a', 'pcm_s16le',
                        '-ac', '2',
                        '-ar', '48000',
                        '-shortest'             // Match video duration
                    ])
                    .output(chunkPath)
                    .on('end', () => resolve(chunkPath))
                    .on('error', (err) => reject(err))
                    .run();
            }
        });
    });
};

// Export video endpoint - Background rendering
app.post('/export', upload.fields([
    { name: 'timeline', maxCount: 1 },
    { name: 'videos', maxCount: 50 }
]), async (req, res) => {
    try {
        const exportId = Date.now().toString();
        const timelineData = JSON.parse(req.body.timeline);
        const { videoTracks, duration, template } = timelineData;

        // Get filename from request, or use default
        const userFilename = req.body.filename || 'export';
        const format = req.body.format || 'mp4';
        const outputFilename = `${userFilename}.${format}`;
        const outputPath = path.join(exportsDir, outputFilename);

        // Create a temp directory for this export job
        const jobTempDir = path.join(uploadsDir, `export-temp-${exportId}`);
        if (!fs.existsSync(jobTempDir)) fs.mkdirSync(jobTempDir);

        console.log(`Starting export ${exportId} (Advanced Workflow)`);

        // Initialize export job
        jobs.set(exportId, {
            status: 'processing',
            progress: 0,
            outputPath,
            filename: outputFilename,
            type: 'export'
        });

        // Return export ID immediately
        res.json({ exportId });

        // Start export asynchronously
        (async () => {
            try {
                // Phase 1: Solo layout only (single video track)
                if (template.layout !== 'solo' || videoTracks.length !== 1) {
                    throw new Error('Phase 1 only supports solo layout with one video track');
                }

                const track = videoTracks[0];
                if (track.clips.length === 0) {
                    throw new Error('No clips to export');
                }

                const totalClips = track.clips.length;
                const inputData = []; // Store input path and metadata
                const inputs = []; // For music tracks
                const filterComplex = [];
                let currentOffset = 0;

                // Helper to get video path
                const getVideoPath = (clip) => {
                    if (clip.processedVideoUrl) {
                        const jobId = clip.processedVideoUrl.split('/download/')[1];
                        const processJob = jobs.get(jobId);
                        if (processJob && fs.existsSync(processJob.outputPath)) {
                            return processJob.outputPath;
                        }
                    }
                    const uploadedFile = req.files?.videos?.find(f => f.filename && f.filename.includes(clip.mediaFileId));
                    return uploadedFile ? uploadedFile.path : null;
                };

                // Step 1: Prepare Inputs and Basic Filters (Trim, Scale, FPS)
                for (let i = 0; i < totalClips; i++) {
                    const clip = track.clips[i];
                    const videoPath = getVideoPath(clip);
                    if (!videoPath) throw new Error(`Video file not found for clip ${clip.id}`);

                    // Check if input is an image
                    const isImage = /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(videoPath);
                    const duration = clip.sourceEnd - clip.sourceStart;

                    inputData.push({
                        path: videoPath,
                        isImage: isImage,
                        duration: duration
                    });

                    console.log(`Clip ${i}: Start=${clip.sourceStart}, End=${clip.sourceEnd}, Duration=${duration}, IsImage=${isImage}`);


                    // Video Filter Chain for this clip
                    // Start with trim and setpts
                    let vFilter = `[${i}:v]trim=start=${clip.sourceStart}:duration=${duration},setpts=PTS-STARTPTS`;

                    // Apply reframe keyframes if they exist (horizontal pan only, no zoom)
                    if (clip.reframeKeyframes && clip.reframeKeyframes.length > 0) {
                        console.log(`Clip ${i}: Applying ${clip.reframeKeyframes.length} reframe keyframes (pan only)`);

                        // Scale to maintain quality
                        vFilter += `,scale=1080:1920:force_original_aspect_ratio=increase`;

                        // Calculate average X position from keyframes (ignore zoom/scale and Y)
                        const keyframes = clip.reframeKeyframes;
                        let avgX = 0;
                        keyframes.forEach(kf => {
                            avgX += kf.x;
                        });
                        avgX /= keyframes.length;

                        // Fixed crop size (no zoom) - always 1080x1920
                        const cropWidth = 1080;
                        const cropHeight = 1920;

                        // avgX is the normalized center point (0-1) from the frontend
                        // We want to center the crop window on this point
                        // Center of crop window = avgX * iw
                        // Top-left of crop window = (avgX * iw) - (cropWidth / 2)

                        // We must clamp the crop to be within the video bounds [0, iw - cropWidth]
                        // FFmpeg expression: max(0, min(iw - cropWidth, (avgX * iw) - (cropWidth / 2)))
                        // IMPORTANT: Commas must be escaped with backslash because comma is a filter separator
                        const cropXExpr = `max(0\\,min(iw-${cropWidth}\\,(${avgX}*iw)-(${cropWidth}/2)))`;

                        // Center vertically always (remove spaces to be safe)
                        const cropYExpr = `(ih-${cropHeight})/2`;

                        // Apply crop with calculated X position, fixed size, centered Y
                        vFilter += `,crop=${cropWidth}:${cropHeight}:${cropXExpr}:${cropYExpr}`;
                    } else {
                        // No reframe keyframes - use fixed center crop
                        vFilter += `,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2`;
                    }

                    // Continue with standard filters
                    vFilter += `,setsar=1,fps=30,format=yuv420p`;

                    // Color Grading
                    if (clip.colorGrading) {
                        const { brightness, contrast, saturation, exposure, sharpness } = clip.colorGrading;

                        // 1. EQ Filter (Brightness, Contrast, Saturation, Exposure)
                        const effectiveBrightness = (brightness - 1) + (exposure * 0.5);
                        const eqParams = [];

                        // Only add parameters if they deviate from default
                        if (Math.abs(effectiveBrightness) > 0.001) eqParams.push(`brightness=${effectiveBrightness.toFixed(3)}`);
                        if (Math.abs(contrast - 1) > 0.001) eqParams.push(`contrast=${contrast.toFixed(3)}`);
                        if (Math.abs(saturation - 1) > 0.001) eqParams.push(`saturation=${saturation.toFixed(3)}`);

                        if (eqParams.length > 0) vFilter += `,eq=${eqParams.join(':')}`;

                        // 2. Unsharp Filter (Sharpness)
                        // Map 0-1 range to reasonable unsharp amount (0 to 1.5)
                        if (sharpness && sharpness > 0) {
                            const amount = (sharpness * 1.5).toFixed(2);
                            vFilter += `,unsharp=5:5:${amount}:5:5:0.0`;
                        }
                    }
                    vFilter += `[v${i}]`;
                    filterComplex.push(vFilter);

                    // Audio Filter Chain for this clip
                    const trackVolume = track.volume ?? 1;
                    const clipVolume = clip.volume ?? 1;
                    const finalVolume = trackVolume * clipVolume;

                    let aFilter;
                    if (isImage) {
                        // Generate silent audio for images
                        aFilter = `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${duration}[a${i}_raw];[a${i}_raw]volume=${finalVolume}[a${i}]`;
                    } else {
                        // Process existing audio for videos
                        aFilter = `[${i}:a]atrim=start=${clip.sourceStart}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,volume=${finalVolume}[a${i}]`;
                    }
                    filterComplex.push(aFilter);
                }

                // Step 2: Build Xfade/Acrossfade Chain
                let lastV = 'v0';
                let lastA = 'a0';

                // Track the end time of the current chain
                let currentChainEnd = track.clips[0].sourceEnd - track.clips[0].sourceStart;
                console.log(`Initial Chain End: ${currentChainEnd}`);

                // --- HANDLE START TRANSITION (Fade In) ---
                if (track.clips[0].transitionStart && track.clips[0].transitionStart.duration > 0) {
                    const t = track.clips[0].transitionStart;
                    console.log(`Applying Start Transition: ${t.type}, Duration=${t.duration}`);

                    let fadeColor = 'black';
                    if (t.type === 'dip-to-white') fadeColor = 'white';

                    filterComplex.push(`[${lastV}]fade=t=in:st=0:d=${t.duration}:color=${fadeColor}[v0_faded]`);
                    filterComplex.push(`[${lastA}]afade=t=in:st=0:d=${t.duration}[a0_faded]`);

                    lastV = 'v0_faded';
                    lastA = 'a0_faded';
                }

                // --- HANDLE MIDDLE TRANSITIONS (Xfade) ---
                for (let i = 0; i < totalClips - 1; i++) {
                    const clip = track.clips[i];
                    const nextClip = track.clips[i + 1];

                    let transitionType = 'none';
                    let transitionDuration = 0;

                    // Check both current clip's end and next clip's start for transition
                    if (clip.transitionEnd && clip.transitionEnd.duration > 0) {
                        transitionType = clip.transitionEnd.type;
                        transitionDuration = clip.transitionEnd.duration;
                    } else if (nextClip.transitionStart && nextClip.transitionStart.duration > 0) {
                        transitionType = nextClip.transitionStart.type;
                        transitionDuration = nextClip.transitionStart.duration;
                    }

                    console.log(`Transition ${i} -> ${i + 1}: Type=${transitionType}, Duration=${transitionDuration}`);

                    const xfadeMap = {
                        'cross-dissolve': 'fade',
                        'additive-dissolve': 'fade',
                        'blur-dissolve': 'pixelize',
                        'non-additive-dissolve': 'fade',
                        'smooth-cut': 'fade',
                        'dip-to-black': 'fadeblack',
                        'dip-to-white': 'fadewhite',
                        'fade-in': 'fade',
                        'fade-out': 'fade'
                    };

                    const ffmpegTransition = xfadeMap[transitionType] || 'fade';

                    if (transitionDuration > 0 && transitionType !== 'none') {
                        // Offset is the end of the current chain minus the transition overlap
                        const offset = currentChainEnd - transitionDuration;

                        // Ensure offset is positive
                        if (offset < 0) {
                            console.warn(`Warning: Transition offset is negative (${offset}). Clip duration might be shorter than transition.`);
                            // Fallback to concat
                            filterComplex.push(`[${lastV}][v${i + 1}]concat=n=2:v=1:a=0[vm${i + 1}]`);
                            filterComplex.push(`[${lastA}][a${i + 1}]concat=n=2:v=0:a=1[am${i + 1}]`);

                            const nextDur = nextClip.sourceEnd - nextClip.sourceStart;
                            currentChainEnd += nextDur;
                        } else {
                            filterComplex.push(`[${lastV}][v${i + 1}]xfade=transition=${ffmpegTransition}:duration=${transitionDuration}:offset=${offset}[vm${i + 1}]`);
                            lastV = `vm${i + 1}`;

                            filterComplex.push(`[${lastA}][a${i + 1}]acrossfade=d=${transitionDuration}:c1=tri:c2=tri[am${i + 1}]`);
                            lastA = `am${i + 1}`;

                            // The new chain end is: offset + next clip duration
                            const nextDur = nextClip.sourceEnd - nextClip.sourceStart;
                            currentChainEnd = offset + nextDur;
                        }
                    } else {
                        // No transition: simple concat
                        filterComplex.push(`[${lastV}][v${i + 1}]concat=n=2:v=1:a=0[vm${i + 1}]`);
                        lastV = `vm${i + 1}`;

                        filterComplex.push(`[${lastA}][a${i + 1}]concat=n=2:v=0:a=1[am${i + 1}]`);
                        lastA = `am${i + 1}`;

                        const nextDur = nextClip.sourceEnd - nextClip.sourceStart;
                        currentChainEnd += nextDur;
                    }
                }

                // --- HANDLE END TRANSITION (Fade Out) ---
                const lastClip = track.clips[totalClips - 1];
                if (lastClip.transitionEnd && lastClip.transitionEnd.duration > 0) {
                    const t = lastClip.transitionEnd;
                    console.log(`Applying End Transition: ${t.type}, Duration=${t.duration}`);

                    // Calculate start time for fade out
                    const fadeOutStart = currentChainEnd - t.duration;

                    let fadeColor = 'black';
                    if (t.type === 'dip-to-white') fadeColor = 'white';

                    if (fadeOutStart > 0) {
                        filterComplex.push(`[${lastV}]fade=t=out:st=${fadeOutStart}:d=${t.duration}:color=${fadeColor}[v_final_faded]`);
                        filterComplex.push(`[${lastA}]afade=t=out:st=${fadeOutStart}:d=${t.duration}[a_final_faded]`);
                        lastV = 'v_final_faded';
                        lastA = 'a_final_faded';
                    }
                }

                filterComplex.push(`[${lastV}]null[v_final]`);
                filterComplex.push(`[${lastA}]aresample=48000[a_final]`);

                // Step 3: Mix Music Tracks
                const audioInputs = ['[a_final]'];
                let inputIndex = totalClips;

                if (timelineData.audioTracks && timelineData.audioTracks.length > 0) {
                    timelineData.audioTracks.forEach((track) => {
                        track.clips.forEach((clip) => {
                            const uploadedFile = req.files?.videos?.find(f => f.filename && f.filename.includes(clip.mediaFileId));
                            if (uploadedFile) {
                                inputs.push(uploadedFile.path);

                                const duration = clip.sourceEnd - clip.sourceStart;
                                const delay = clip.timelineStart * 1000;

                                const filterChain = [
                                    `[${inputIndex}:a]atrim=start=${clip.sourceStart}:duration=${duration}[a${inputIndex}_trim]`,
                                    `[a${inputIndex}_trim]adelay=${delay}|${delay}[a${inputIndex}_delay]`,
                                    `[a${inputIndex}_delay]volume=${(track.volume ?? 1) * (clip.volume ?? 1)}[a${inputIndex}_vol]`,
                                    `[a${inputIndex}_vol]aresample=48000[a${inputIndex}_out]`
                                ];

                                filterComplex.push(...filterChain);
                                audioInputs.push(`[a${inputIndex}_out]`);
                                inputIndex++;
                            }
                        });
                    });
                }

                if (audioInputs.length > 1) {
                    filterComplex.push(`${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=first:dropout_transition=2[a_mixed]`);
                } else {
                    filterComplex.push(`[a_final]anull[a_mixed]`);
                }

                // Execute FFmpeg
                await new Promise((resolve, reject) => {
                    const cmd = ffmpeg();

                    // Add video inputs with options
                    inputData.forEach(data => {
                        cmd.input(data.path);
                        if (data.isImage) {
                            cmd.inputOption('-loop 1');
                            cmd.inputOption(`-t ${data.duration + 0.5}`); // Add buffer to ensure enough frames
                        }
                    });

                    // Add music track inputs (starting from index = totalClips)
                    // The inputs array already contains music tracks added in Step 3
                    // We need to add them to the command.
                    // Note: inputs array was populated in Step 3, but we switched to inputData for videos.
                    // We need to handle the music inputs correctly.

                    // Let's check where music inputs are added.
                    // In Step 3, we did: inputs.push(uploadedFile.path);
                    // We need to make sure we add those to the cmd as well.

                    // Filter out video inputs from 'inputs' array since we added them via inputData
                    // Actually, let's just iterate the remaining inputs in 'inputs' array which are music tracks.
                    // The 'inputs' array currently contains ONLY music tracks because we didn't push video paths to it in Step 1 anymore.
                    // Wait, in Step 1 I removed inputs.push(videoPath).
                    // So 'inputs' array is empty until Step 3.

                    inputs.forEach(i => cmd.input(i));

                    cmd.complexFilter(filterComplex)
                        .outputOptions([
                            '-map', '[v_final]',
                            '-map', '[a_mixed]',
                            '-c:v', 'libx264',
                            '-preset', 'medium',
                            '-crf', '18',
                            '-maxrate', '15M',
                            '-bufsize', '30M',
                            '-profile:v', 'high',
                            '-level', '4.2',
                            '-pix_fmt', 'yuv420p',
                            '-g', '60',
                            '-movflags', '+faststart',
                            '-c:a', 'aac',
                            '-b:a', '320k',
                            '-ar', '48000',
                            '-ac', '2'
                        ])
                        .output(outputPath)
                        .on('start', (commandLine) => {
                            console.log('Spawned Ffmpeg with command: ' + commandLine);
                        })
                        .on('progress', (progress) => {
                            const job = jobs.get(exportId);
                            if (job) {
                                job.progress = progress.percent || 50;
                                jobs.set(exportId, job);
                            }
                        })
                        .on('end', resolve)
                        .on('error', reject)
                        .run();
                });

                console.log(`Export ${exportId} completed`);
                const finalJob = jobs.get(exportId);
                if (finalJob) {
                    finalJob.status = 'done';
                    finalJob.progress = 100;
                    jobs.set(exportId, finalJob);
                }

            } catch (error) {
                console.error(`Export ${exportId} error:`, error);
                const job = jobs.get(exportId);
                if (job) {
                    job.status = 'error';
                    job.error = error.message;
                    jobs.set(exportId, job);
                }
                if (fs.existsSync(jobTempDir)) {
                    try { fs.rmSync(jobTempDir, { recursive: true, force: true }); } catch (e) { }
                }
            }
        })();

    } catch (error) {
        console.error('Export request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export progress endpoint (SSE)
app.get('/export-progress/:exportId', (req, res) => {
    const { exportId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendUpdate = () => {
        const job = jobs.get(exportId);
        if (!job || job.type !== 'export') {
            res.write(`data: ${JSON.stringify({ status: 'error', error: 'Export not found' })}\n\n`);
            res.end();
            return;
        }

        res.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress })}\n\n`);

        if (job.status === 'done' || job.status === 'error') {
            res.end();
        }
    };

    // Send initial update
    sendUpdate();

    // Poll for updates every 500ms
    const interval = setInterval(sendUpdate, 500);

    req.on('close', () => {
        clearInterval(interval);
    });
});

// Download export endpoint
app.get('/download-export/:exportId', (req, res) => {
    const { exportId } = req.params;
    const job = jobs.get(exportId);

    if (!job || job.type !== 'export' || job.status !== 'done' || !fs.existsSync(job.outputPath)) {
        return res.status(404).send('Export not ready or not found');
    }

    res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
    res.sendFile(job.outputPath);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Cache status endpoint - checks if there are files to clear
app.get('/cache-status', (req, res) => {
    try {
        let fileCount = 0;

        if (fs.existsSync(outputsDir)) {
            fileCount += fs.readdirSync(outputsDir).length;
        }
        if (fs.existsSync(exportsDir)) {
            fileCount += fs.readdirSync(exportsDir).length;
        }
        if (fs.existsSync(uploadsDir)) {
            fileCount += fs.readdirSync(uploadsDir).length;
        }

        res.json({ hasCache: fileCount > 0, fileCount });
    } catch (error) {
        console.error('Error checking cache status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Clear cache endpoint - deletes all processed videos and exports
app.post('/clear-cache', (req, res) => {
    try {
        let deletedCount = 0;

        // Helper function to delete files and directories
        const deleteItem = (itemPath) => {
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
                fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(itemPath);
            }
            deletedCount++;
        };

        // Clear outputs directory (processed slow-mo videos)
        if (fs.existsSync(outputsDir)) {
            const outputFiles = fs.readdirSync(outputsDir);
            outputFiles.forEach(file => {
                const filePath = path.join(outputsDir, file);
                deleteItem(filePath);
            });
        }

        // Clear exports directory (rendered final videos)
        if (fs.existsSync(exportsDir)) {
            const exportFiles = fs.readdirSync(exportsDir);
            exportFiles.forEach(file => {
                const filePath = path.join(exportsDir, file);
                deleteItem(filePath);
            });
        }

        // Clear uploads directory (temporary uploaded files and temp directories)
        if (fs.existsSync(uploadsDir)) {
            const uploadFiles = fs.readdirSync(uploadsDir);
            uploadFiles.forEach(file => {
                const filePath = path.join(uploadsDir, file);
                deleteItem(filePath);
            });
        }

        // Clear in-memory job store
        jobs.clear();

        console.log(`Cache cleared: ${deletedCount} files deleted`);
        res.json({ success: true, filesDeleted: deletedCount });
    } catch (error) {
        console.error('Error clearing cache:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.send('AI Reel Editor Video Processing Server is running');
});

app.listen(PORT, () => {
    console.log(`Video processing server running on http://localhost:${PORT}`);
    console.log('Ready to process videos!');
});
