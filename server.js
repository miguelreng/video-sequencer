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
    version: '2.7.1 - Fixed Audio File Writing',
    endpoints: {
      sequence: 'POST /api/sequence-videos (multiple videos → one video)',
      audio: 'POST /api/add-audio (single video + audio → final video)'
    }
  });
});

// ENDPOINT 1: SEQUENCE MULTIPLE VIDEOS (Your original function)
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video sequencing request (multiple videos → one)');
  
  try {
    const { videoUrls, tracks } = req.body;
    
    let timeline = [];
    
    if (tracks && tracks.length > 0) {
      // Find video track
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
    
    // Limit to 6 videos for reliability
    if (timeline.length > 6) {
      console.log(`⚠️ Limiting from ${timeline.length} to 6 videos`);
      timeline = timeline.slice(0, 6);
    }
    
    console.log(`📊 Sequencing ${timeline.length} video segments (5s each)`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download and process videos
    const processedFiles = [];
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      try {
        console.log(`📥 Downloading segment ${i + 1}: ${segment.url}`);
        
        const response = await fetch(segment.url, { timeout: 15000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const buffer = await response.buffer();
        const originalPath = path.join(tempDir, `original${i}.mp4`);
        const processedPath = path.join(tempDir, `processed${i}.mp4`);
        
        fs.writeFileSync(originalPath, buffer);
        console.log(`✅ Downloaded segment ${i + 1}`);
        
        // Process each video to 5 seconds
        await new Promise((resolve, reject) => {
          ffmpeg(originalPath)
            .inputOptions(['-ss', '0'])
            .outputOptions([
              '-t', '5', // Exactly 5 seconds
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'fast',
              '-crf', '25',
              '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
              '-r', '24'
            ])
            .output(processedPath)
            .on('end', () => {
              console.log(`✅ Processed segment ${i + 1}`);
              resolve();
            })
            .on('error', reject)
            .run();
        });
        
        processedFiles.push(processedPath);
        fs.unlinkSync(originalPath);
        
      } catch (error) {
        console.error(`❌ Failed segment ${i + 1}:`, error.message);
      }
    }
    
    if (processedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos processed successfully'
      });
    }
    
    // Concatenate all segments
    console.log(`🔗 Concatenating ${processedFiles.length} segments...`);
    
    const concatContent = processedFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    const outputPath = path.join(tempDir, `sequenced_${Date.now()}.mp4`);
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [...processedFiles, concatPath, outputPath].forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    const totalDuration = processedFiles.length * 5;
    
    console.log(`🎉 Sequenced ${processedFiles.length} videos = ${totalDuration} seconds total`);
    
    res.json({
      success: true,
      message: `Successfully sequenced ${processedFiles.length} videos into ${totalDuration} seconds`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: processedFiles.length,
      totalDuration: `${totalDuration} seconds`,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 Sequencing error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ENDPOINT 2: ADD AUDIO TO SINGLE VIDEO (FIXED)
app.post('/api/add-audio', async (req, res) => {
  const startTime = Date.now();
  console.log('🎵 Received audio overlay request (video + audio → final)');
  
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
    
    console.log(`📹 Video: ${videoTrack.url}, Duration: ${videoTrack.duration}s`);
    console.log(`🎵 Audio: ${audioTrack.url}, Duration: ${audioTrack.duration}s`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download video
    console.log('📥 Downloading video...');
    const videoResponse = await fetch(videoTrack.url, { timeout: 30000 });
    if (!videoResponse.ok) {
      throw new Error(`Video download failed: ${videoResponse.status}`);
    }
    
    const videoBuffer = await videoResponse.buffer();
    const videoPath = path.join(tempDir, `input_video_${Date.now()}.mp4`);
    fs.writeFileSync(videoPath, videoBuffer); // FIXED: Correct order
    console.log(`✅ Video saved: ${(videoBuffer.length / 1024).toFixed(2)} KB`);
    
    // Download audio
    console.log('📥 Downloading audio...');
    const audioResponse = await fetch(audioTrack.url, { timeout: 30000 });
    if (!audioResponse.ok) {
      throw new Error(`Audio download failed: ${audioResponse.status}`);
    }
    
    const audioBuffer = await audioResponse.buffer();
    const audioPath = path.join(tempDir, `input_audio_${Date.now()}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer); // FIXED: Correct order (path, buffer)
    console.log(`✅ Audio saved: ${(audioBuffer.length / 1024).toFixed(2)} KB`);
    
    // Combine video + audio
    const outputPath = path.join(tempDir, `final_${Date.now()}.mp4`);
    const duration = Math.min(videoTrack.duration || 60, audioTrack.duration || 60);
    
    console.log(`🔄 Combining video + audio (${duration}s)...`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .input(audioPath)
        .outputOptions([
          '-t', duration.toString(),
          '-c:v', 'copy', // Copy video (no re-encoding)
          '-c:a', 'aac',  // Re-encode audio
          '-b:a', '128k', // Audio bitrate
          '-map', '0:v:0', // Video from first input
          '-map', '1:a:0', // Audio from second input
          '-shortest',
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 FFmpeg combining video + audio...');
          console.log('Command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ Combining progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Video + audio combination completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Combination error:', err.message);
          reject(err);
        })
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [videoPath, audioPath, outputPath].forEach(file => {
      try { 
        if (fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {
        console.warn('Cleanup warning:', e.message);
      }
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 Final video with audio created (${duration}s)`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
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
    console.error('💥 Audio overlay error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.7.1 running on port ${PORT}`);
  console.log(`📹 /api/sequence-videos - Multiple videos → One video`);
  console.log(`🎵 /api/add-audio - Single video + audio → Final video`);
});
