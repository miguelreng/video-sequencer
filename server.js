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
    version: '2.6.1 - Simplified Audio Support',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    }
  });
});

// Main video sequencing endpoint with simplified audio
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video+audio request (simplified)');
  
  try {
    const { videoUrls, tracks } = req.body;
    
    let videoTrack = null;
    let audioTrack = null;
    
    // Parse tracks
    if (tracks && tracks.length > 0) {
      tracks.forEach(track => {
        if (track.type === 'video' && track.keyframes && track.keyframes.length > 0) {
          videoTrack = track.keyframes[0]; // Take first video
        } else if (track.type === 'audio' && track.keyframes && track.keyframes.length > 0) {
          audioTrack = track.keyframes[0]; // Take first audio
        }
      });
    } else if (videoUrls) {
      // Legacy video-only support
      videoTrack = {
        url: videoUrls[0].mp4_url || videoUrls[0],
        duration: 30 // Default duration
      };
    }
    
    if (!videoTrack) {
      return res.status(400).json({
        success: false,
        error: 'No video track found'
      });
    }
    
    console.log(`📹 Video: ${videoTrack.url}`);
    if (audioTrack) {
      console.log(`🎵 Audio: ${audioTrack.url}`);
    }
    
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
    const videoInputPath = path.join(tempDir, 'input_video.mp4');
    fs.writeFileSync(videoInputPath, videoBuffer);
    
    console.log(`✅ Video downloaded: ${(videoBuffer.length / 1024).toFixed(2)} KB`);
    
    let audioInputPath = null;
    
    // Download audio if provided
    if (audioTrack) {
      console.log('📥 Downloading audio...');
      const audioResponse = await fetch(audioTrack.url, { timeout: 30000 });
      if (!audioResponse.ok) {
        console.warn(`Audio download failed: ${audioResponse.status}, proceeding without audio`);
      } else {
        const audioBuffer = await audioResponse.buffer();
        audioInputPath = path.join(tempDir, 'input_audio.mp3');
        fs.writeFileSync(audioInputPath, audioBuffer);
        console.log(`✅ Audio downloaded: ${(audioBuffer.length / 1024).toFixed(2)} KB`);
      }
    }
    
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    // Process video with or without audio
    await new Promise((resolve, reject) => {
      let command = ffmpeg(videoInputPath);
      
      // Add audio input if available
      if (audioInputPath) {
        command = command.input(audioInputPath);
      }
      
      // Set duration
      const duration = Math.min(
        videoTrack.duration || 30,
        audioTrack ? audioTrack.duration || 30 : 30
      );
      
      command
        .inputOptions(['-ss', '0']) // Start from beginning
        .outputOptions([
          '-t', duration.toString(), // Set duration
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '25',
          
          // Simple video filter - no complex operations
          '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
          
          '-r', '24',
          '-movflags', '+faststart'
        ]);
      
      // Audio handling
      if (audioInputPath) {
        command.outputOptions([
          '-c:a', 'aac',
          '-b:a', '128k',
          '-map', '0:v:0', // Video from first input
          '-map', '1:a:0', // Audio from second input
          '-shortest' // Stop when shortest stream ends
        ]);
      } else {
        // Video only - copy existing audio if any
        command.outputOptions([
          '-c:a', 'aac'
        ]);
      }
      
      command
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 FFmpeg started (simplified)');
          console.log('Command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ Progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Processing completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg error:', err.message);
          
          // FALLBACK: Video only, no audio
          if (audioInputPath) {
            console.log('🔄 Retrying without audio...');
            
            ffmpeg(videoInputPath)
              .inputOptions(['-ss', '0'])
              .outputOptions([
                '-t', (videoTrack.duration || 30).toString(),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '28',
                '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                '-r', '24',
                '-an' // No audio
              ])
              .output(outputPath)
              .on('end', () => {
                console.log('✅ Fallback completed (video only)');
                resolve();
              })
              .on('error', (fallbackErr) => {
                console.error('❌ Fallback failed:', fallbackErr.message);
                reject(fallbackErr);
              })
              .run();
          } else {
            reject(err);
          }
        })
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [videoInputPath, audioInputPath, outputPath].forEach(file => {
      try { 
        if (file && fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 Success! ${audioTrack ? 'Video+Audio' : 'Video'} processed`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully processed video${audioTrack ? ' with audio' : ''}`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      hasAudio: !!audioTrack,
      duration: videoTrack.duration || 30,
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

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.6.1 running on port ${PORT}`);
  console.log(`🎵 Features: Simplified video+audio processing with fallbacks`);
});
