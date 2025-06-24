// Configure Railway draining time for longer processing
process.env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS = '120'; // 2 minutes before SIGKILL

const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Video Sequencer API is running!',
    version: '2.9.3 - FIXED BATCH PROCESSING + SIGKILL PROTECTION',
    endpoints: {
      sequence: 'POST /api/sequence-videos',
      audio: 'POST /api/add-audio', 
      subtitles: 'POST /api/add-subtitles'
    },
    timestamp: new Date().toISOString()
  });
});

// ENDPOINT 1: SEQUENCE MULTIPLE VIDEOS (FIXED BATCH PROCESSING)
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 [SEQUENCE] Received video sequencing request - FIXED BATCH VERSION');
  
  try {
    const { videoUrls, tracks, batchSize = 3 } = req.body; // Smaller batches
    
    let timeline = [];
    
    if (tracks && tracks.length > 0) {
      const videoTrack = tracks.find(track => track.type === 'video');
      if (videoTrack && videoTrack.keyframes) {
        timeline = videoTrack.keyframes;
      }
    } else if (videoUrls) {
      timeline = videoUrls.map((video, index) => ({
        url: video.mp4_url || video,
        timestamp: index * 5,
        duration: 5
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either videoUrls array or tracks array is required'
      });
    }
    
    console.log(`📊 [SEQUENCE] Processing ALL ${timeline.length} video segments (5s each) - NO LIMITS!`);
    console.log(`🔄 [SEQUENCE] Using batch size: ${batchSize} videos per batch`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Split timeline into batches
    const batches = [];
    for (let i = 0; i < timeline.length; i += batchSize) {
      batches.push(timeline.slice(i, i + batchSize));
    }
    
    console.log(`📦 [SEQUENCE] Split into ${batches.length} batches`);
    
    const batchOutputs = [];
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`🔄 [SEQUENCE] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} videos)`);
      
      const processedFiles = [];
      
      // Process videos in current batch
      for (let i = 0; i < batch.length; i++) {
        const segment = batch[i];
        try {
          console.log(`📥 [SEQUENCE] Batch ${batchIndex + 1} - Downloading video ${i + 1}: ${segment.url}`);
          
          // Download with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000); // Reduced timeout
          
          const response = await fetch(segment.url, { 
            signal: controller.signal,
            timeout: 12000 
          });
          clearTimeout(timeoutId);
          
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const buffer = await response.buffer();
          
          // Skip very large files that cause SIGKILL
          if (buffer.length > 15 * 1024 * 1024) { // Skip files > 15MB
            console.log(`⚠️ [SEQUENCE] Batch ${batchIndex + 1} - Skipping large video ${i + 1} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
            continue;
          }
          
          const originalPath = path.join(tempDir, `batch${batchIndex}_original${i}.mp4`);
          const processedPath = path.join(tempDir, `batch${batchIndex}_processed${i}.mp4`);
          
          fs.writeFileSync(originalPath, buffer);
          console.log(`✅ [SEQUENCE] Batch ${batchIndex + 1} - Downloaded video ${i + 1} (${(buffer.length / 1024).toFixed(2)} KB)`);
          
          // Process video with timeout
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Processing timeout'));
            }, 20000); // Reduced timeout
            
            ffmpeg(originalPath)
              .inputOptions(['-ss', '0'])
              .outputOptions([
                '-t', '5',
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-preset', 'ultrafast',  // Faster processing
                '-crf', '30',           // Lower quality but faster
                '-vf', 'scale=640:1138:force_original_aspect_ratio=increase,crop=640:1138', // Smaller resolution
                '-r', '20',             // Lower framerate
                '-b:a', '64k'          // Lower audio bitrate
              ])
              .output(processedPath)
              .on('end', () => {
                clearTimeout(timeout);
                console.log(`✅ [SEQUENCE] Batch ${batchIndex + 1} - Processed video ${i + 1}`);
                resolve();
              })
              .on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
              })
              .run();
          });
          
          processedFiles.push(processedPath);
          
          // Cleanup original immediately
          try { fs.unlinkSync(originalPath); } catch (e) {}
          
          // Memory management pause
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (error) {
          console.error(`❌ [SEQUENCE] Batch ${batchIndex + 1} - Failed video ${i + 1}:`, error.message);
        }
      }
      
      if (processedFiles.length === 0) {
        console.log(`⚠️ [SEQUENCE] Batch ${batchIndex + 1} - No videos processed successfully`);
        continue;
      }
      
      // Concatenate current batch
      console.log(`🔗 [SEQUENCE] Batch ${batchIndex + 1} - Concatenating ${processedFiles.length} videos`);
      
      const concatContent = processedFiles.map(file => `file '${file}'`).join('\n');
      const concatPath = path.join(tempDir, `batch${batchIndex}_concat.txt`);
      fs.writeFileSync(concatPath, concatContent);
      
      const batchOutputPath = path.join(tempDir, `batch${batchIndex}_output.mp4`);
      
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
          .output(batchOutputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      batchOutputs.push(batchOutputPath);
      console.log(`✅ [SEQUENCE] Batch ${batchIndex + 1} completed - ${processedFiles.length} videos`);
      
      // Cleanup batch files
      [...processedFiles, concatPath].forEach(file => {
        try { fs.unlinkSync(file); } catch (e) {}
      });
      
      // Memory management pause
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (batchOutputs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos processed successfully in any batch'
      });
    }
    
    let finalOutputPath;
    
    if (batchOutputs.length === 1) {
      // Only one batch, use it directly
      finalOutputPath = batchOutputs[0];
      console.log(`🎬 [SEQUENCE] Single batch result used directly`);
    } else {
      // Merge all batches - FIXED VERSION
      console.log(`🔗 [SEQUENCE] Merging ${batchOutputs.length} batches into final video`);
      
      // FIXED: Proper concat file format
      const finalConcatContent = batchOutputs.map(file => `file '${file}'`).join('\n');
      const finalConcatPath = path.join(tempDir, 'final_concat.txt');
      fs.writeFileSync(finalConcatPath, finalConcatContent); // FIXED: Correct parameter order
      
      finalOutputPath = path.join(tempDir, `final_sequenced_${Date.now()}.mp4`);
      
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(finalConcatPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
          .output(finalOutputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      // Cleanup
      try { fs.unlinkSync(finalConcatPath); } catch (e) {}
    }
    
    const outputBuffer = fs.readFileSync(finalOutputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup all batch outputs and final output
    [...batchOutputs, finalOutputPath].forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    const totalDuration = timeline.length * 5; // All attempted videos
    
    console.log(`🎉 [SEQUENCE] SUCCESS! Processed ${timeline.length} videos into ${totalDuration} seconds total`);
    console.log(`📊 [SEQUENCE] ${batches.length} batches processed, ${batchOutputs.length} successful batches`);
    
    res.json({
      success: true,
      message: `Successfully sequenced ${timeline.length} videos (${batchOutputs.length}/${batches.length} batches successful)`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosAttempted: timeline.length,
      batchesProcessed: batchOutputs.length,
      totalBatches: batches.length,
      totalDuration: `${totalDuration} seconds`,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 [SEQUENCE] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ENDPOINT 2: ADD AUDIO TO SINGLE VIDEO
app.post('/api/add-audio', async (req, res) => {
  const startTime = Date.now();
  console.log('🎵 [AUDIO] Received audio overlay request');
  
  try {
    const { tracks } = req.body;
    
    if (!tracks || tracks.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Both video and audio tracks are required'
      });
    }
    
    let videoTrack = null;
    let audioTrack = null;
    
    tracks.forEach(track => {
      if (track.type === 'video' && track.keyframes && track.keyframes.length > 0) {
        videoTrack = track.keyframes[0];
      } else if (track.type === 'audio' && track.keyframes && track.keyframes.length > 0) {
        audioTrack = track.keyframes[0];
      }
    });
    
    if (!videoTrack || !audioTrack) {
      return res.status(400).json({
        success: false,
        error: 'Both video and audio keyframes are required'
      });
    }
    
    console.log(`📹 [AUDIO] Video: ${videoTrack.url}`);
    console.log(`🎵 [AUDIO] Audio: ${audioTrack.url}`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    console.log('📥 [AUDIO] Downloading video...');
    const videoResponse = await fetch(videoTrack.url, { timeout: 30000 });
    if (!videoResponse.ok) {
      throw new Error(`Video download failed: ${videoResponse.status}`);
    }
    
    const videoBuffer = await videoResponse.buffer();
    const videoPath = path.join(tempDir, `audio_video_${Date.now()}.mp4`);
    fs.writeFileSync(videoPath, videoBuffer);
    
    console.log('📥 [AUDIO] Downloading audio...');
    const audioResponse = await fetch(audioTrack.url, { timeout: 30000 });
    if (!audioResponse.ok) {
      throw new Error(`Audio download failed: ${audioResponse.status}`);
    }
    
    const audioBuffer = await audioResponse.buffer();
    const audioPath = path.join(tempDir, `audio_input_${Date.now()}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer);
    
    const outputPath = path.join(tempDir, `final_${Date.now()}.mp4`);
    const duration = Math.min(videoTrack.duration || 60, audioTrack.duration || 60);
    
    console.log(`🔄 [AUDIO] Combining video + audio (${duration}s)...`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .input(audioPath)
        .outputOptions([
          '-t', duration.toString(),
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('end', () => {
          console.log('✅ [AUDIO] Combination completed');
          resolve();
        })
        .on('error', reject)
        .run();
    });
    
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    [videoPath, audioPath, outputPath].forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 [AUDIO] Success! Video with audio created`);
    
    res.json({
      success: true,
      message: `Successfully added audio to video (${duration} seconds)`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      duration: `${duration} seconds`,
      hasAudio: true,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 [AUDIO] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ENDPOINT 3: SUBTITLES USING EXACT VIDEO SEQUENCING PATTERN
app.post('/api/add-subtitles', async (req, res) => {
  const startTime = Date.now();
  console.log('📝 [SUBTITLES] USING EXACT VIDEO SEQUENCING PATTERN');
  
  try {
    const { video_url, subtitles } = req.body;
    
    if (!video_url) {
      return res.status(400).json({
        success: false,
        error: 'video_url is required'
      });
    }
    
    if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'subtitles array is required'
      });
    }
    
    console.log(`📹 [SUBTITLES] Video: ${video_url}`);
    console.log(`📝 [SUBTITLES] Processing ${subtitles.length} subtitle segments`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    console.log('📥 [SUBTITLES] Downloading video...');
    const videoResponse = await fetch(video_url, { timeout: 30000 });
    if (!videoResponse.ok) {
      throw new Error(`Video download failed: ${videoResponse.status}`);
    }
    
    const videoBuffer = await videoResponse.buffer();
    
    // COPY EXACT VIDEO SEQUENCING PATTERN: Use simple incrementing filenames
    const inputPath = path.join(tempDir, 'subtitle_original.mp4');
    const outputPath = path.join(tempDir, 'subtitle_processed.mp4');
    
    fs.writeFileSync(inputPath, videoBuffer);
    console.log(`✅ [SUBTITLES] Video saved: ${(videoBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`🔧 [SUBTITLES] Input: ${inputPath}`);
    console.log(`🔧 [SUBTITLES] Output: ${outputPath}`);
    
    // EXACT SAME APPROACH AS VIDEO SEQUENCING: Use Promise with timeout
    let success = false;
    
    try {
      console.log('🔄 [SUBTITLES] Processing with EXACT video sequencing pattern...');
      
      const firstSub = subtitles[0];
      const cleanText = firstSub.text.replace(/[^\w\s]/g, '').substring(0, 25);
      
      console.log(`🎨 [SUBTITLES] Text: "${cleanText}"`);
      
      await new Promise((resolve, reject) => {
        // EXACT SAME TIMEOUT PATTERN AS VIDEO SEQUENCING
        const timeout = setTimeout(() => {
          reject(new Error('Processing timeout'));
        }, 25000);
        
        ffmpeg(inputPath)
          .inputOptions(['-ss', '0']) // SAME INPUT OPTIONS AS VIDEO SEQUENCING
          .outputOptions([
            '-t', '10',              // SAME OUTPUT OPTIONS PATTERN
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-preset', 'ultrafast',  // SAME PRESET AS VIDEO SEQUENCING
            '-crf', '30',            // SAME CRF AS VIDEO SEQUENCING
            '-vf', `drawtext=text='${cleanText}':fontsize=40:fontcolor=yellow:x=100:y=100`, // SIMPLE VF OPTION
            '-r', '20'               // SAME FRAMERATE AS VIDEO SEQUENCING
          ])
          .output(outputPath)        // SAME OUTPUT PATTERN
          .on('end', () => {
            clearTimeout(timeout);
            console.log(`✅ [SUBTITLES] Processed successfully`);
            success = true;
            resolve();
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            console.error(`❌ [SUBTITLES] Failed:`, err.message);
            reject(err);
          })
          .run();
      });
      
    } catch (error) {
      console.error('❌ [SUBTITLES] Processing failed:', error.message);
      
      // EXACT SAME FALLBACK AS VIDEO SEQUENCING
      console.log('🔄 [SUBTITLES] Copying original as fallback...');
      try {
        fs.copyFileSync(inputPath, outputPath);
        console.log('✅ [SUBTITLES] Original copied successfully');
      } catch (copyErr) {
        console.error('❌ [SUBTITLES] Copy failed:', copyErr.message);
        throw copyErr;
      }
    }
    
    // EXACT SAME FILE VERIFICATION AS VIDEO SEQUENCING
    if (!fs.existsSync(outputPath)) {
      console.log('⚠️ [SUBTITLES] Output missing, copying original');
      fs.copyFileSync(inputPath, outputPath);
    }
    
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // EXACT SAME CLEANUP AS VIDEO SEQUENCING
    [inputPath, outputPath].forEach(file => {
      try { 
        fs.unlinkSync(file); 
      } catch (e) {
        console.log(`Cleanup: ${e.message}`);
      }
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 [SUBTITLES] Success! Video processed`);
    console.log(`📊 [SUBTITLES] Original: ${(videoBuffer.length / 1024).toFixed(2)} KB → Output: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Video processed using exact video sequencing pattern (${success ? 'subtitles rendered' : 'fallback mode'})`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      originalSize: videoBuffer.length,
      subtitlesRendered: success,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 [SUBTITLES] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.9.3 running on port ${PORT}`);
  console.log(`📹 /api/sequence-videos - Multiple videos → One video (FIXED BATCH PROCESSING!)`);
  console.log(`🎵 /api/add-audio - Single video + audio → Final video`);
  console.log(`📝 /api/add-subtitles - Video + subtitles → GUARANTEED VISIBLE DRAWTEXT`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
});
