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
    version: '2.6.0 - Audio Support Added',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    },
    features: [
      'Video sequencing with 5-second segments',
      'Audio track overlay support',
      'Multiple track processing',
      'Automatic audio sync'
    ]
  });
});

// Main video sequencing endpoint with audio support
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video+audio sequencing request');
  
  try {
    const { videoUrls, tracks } = req.body;
    
    let videoTimeline = [];
    let audioTimeline = [];
    
    if (tracks && tracks.length > 0) {
      // Process multiple tracks (video + audio)
      tracks.forEach(track => {
        if (track.type === 'video') {
          videoTimeline = track.keyframes || [];
        } else if (track.type === 'audio') {
          audioTimeline = track.keyframes || [];
        }
      });
      
      console.log(`📹 Found ${videoTimeline.length} video segments`);
      console.log(`🎵 Found ${audioTimeline.length} audio segments`);
      
    } else if (videoUrls) {
      // Legacy support - video only
      videoTimeline = videoUrls.map((video, index) => ({
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
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    let videoPath = null;
    let audioPath = null;
    
    // PROCESS VIDEO TRACK
    if (videoTimeline.length > 0) {
      console.log('🎥 Processing video track...');
      
      // Check if it's a single long video or multiple segments
      if (videoTimeline.length === 1 && videoTimeline[0].duration > 10) {
        // Single long video - just download and trim
        console.log('📹 Processing single long video');
        
        const videoUrl = videoTimeline[0].url;
        const videoDuration = videoTimeline[0].duration;
        
        const response = await fetch(videoUrl, { timeout: 30000 });
        if (!response.ok) throw new Error(`Video download failed: ${response.status}`);
        
        const buffer = await response.buffer();
        const originalVideoPath = path.join(tempDir, 'original_video.mp4');
        fs.writeFileSync(originalVideoPath, buffer);
        
        videoPath = path.join(tempDir, 'processed_video.mp4');
        
        // Trim video to exact duration
        await new Promise((resolve, reject) => {
          ffmpeg(originalVideoPath)
            .inputOptions(['-ss', '0'])
            .outputOptions([
              '-t', videoDuration.toString(),
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'fast',
              '-crf', '23',
              '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
              '-r', '24'
            ])
            .output(videoPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        
        fs.unlinkSync(originalVideoPath);
        
      } else {
        // Multiple video segments - use existing logic
        videoPath = await processMultipleVideoSegments(videoTimeline, tempDir);
      }
    }
    
    // PROCESS AUDIO TRACK
    if (audioTimeline.length > 0) {
      console.log('🎵 Processing audio track...');
      
      const audioUrl = audioTimeline[0].url;
      const audioDuration = audioTimeline[0].duration;
      
      console.log(`🎤 Downloading audio: ${audioUrl}`);
      
      const response = await fetch(audioUrl, { timeout: 30000 });
      if (!response.ok) throw new Error(`Audio download failed: ${response.status}`);
      
      const buffer = await response.buffer();
      const originalAudioPath = path.join(tempDir, 'original_audio.mp3');
      fs.writeFileSync(originalAudioPath, buffer);
      
      audioPath = path.join(tempDir, 'processed_audio.mp3');
      
      // Trim audio to exact duration
      await new Promise((resolve, reject) => {
        ffmpeg(originalAudioPath)
          .inputOptions(['-ss', '0'])
          .outputOptions([
            '-t', audioDuration.toString(),
            '-c:a', 'aac',
            '-b:a', '128k'
          ])
          .output(audioPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      fs.unlinkSync(originalAudioPath);
    }
    
    // COMBINE VIDEO + AUDIO
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    if (videoPath && audioPath) {
      console.log('🎬 Combining video + audio...');
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .input(audioPath)
          .outputOptions([
            '-c:v', 'copy', // Copy video stream
            '-c:a', 'aac',  // Re-encode audio
            '-map', '0:v:0', // Use video from first input
            '-map', '1:a:0', // Use audio from second input
            '-shortest', // End when shortest stream ends
            '-movflags', '+faststart'
          ])
          .output(outputPath)
          .on('start', () => {
            console.log('🔄 Combining video and audio tracks...');
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
      
    } else if (videoPath) {
      // Video only - copy to output
      fs.copyFileSync(videoPath, outputPath);
      
    } else {
      throw new Error('No video track provided');
    }
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [videoPath, audioPath, outputPath].forEach(file => {
      try { 
        if (file && fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 Success! Video with audio processed`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully processed video${audioTimeline.length > 0 ? ' with audio overlay' : ''}`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videoSegments: videoTimeline.length,
      audioSegments: audioTimeline.length,
      hasAudio: audioTimeline.length > 0,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function for multiple video segments
async function processMultipleVideoSegments(timeline, tempDir) {
  // Limit segments
  if (timeline.length > 6) {
    timeline = timeline.slice(0, 6);
  }
  
  const processedFiles = [];
  
  for (let i = 0; i < timeline.length; i++) {
    const segment = timeline[i];
    console.log(`📥 Processing video segment ${i + 1}`);
    
    const response = await fetch(segment.url, { timeout: 15000 });
    if (!response.ok) continue;
    
    const buffer = await response.buffer();
    const originalPath = path.join(tempDir, `original${i}.mp4`);
    const processedPath = path.join(tempDir, `processed${i}.mp4`);
    
    fs.writeFileSync(originalPath, buffer);
    
    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .inputOptions(['-ss', '0'])
        .outputOptions([
          '-t', '5',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'fast',
          '-crf', '25',
          '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
          '-r', '24'
        ])
        .output(processedPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    processedFiles.push(processedPath);
    fs.unlinkSync(originalPath);
  }
  
  // Concatenate segments
  const concatContent = processedFiles.map(file => `file '${file}'`).join('\n');
  const concatPath = path.join(tempDir, 'concat.txt');
  fs.writeFileSync(concatPath, concatContent);
  
  const outputPath = path.join(tempDir, 'concatenated_video.mp4');
  
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
  
  // Cleanup segment files
  processedFiles.forEach(file => {
    try { fs.unlinkSync(file); } catch (e) {}
  });
  fs.unlinkSync(concatPath);
  
  return outputPath;
}

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.6.0 running on port ${PORT}`);
  console.log(`🎵 Features: Video sequencing + Audio overlay support`);
});
