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
    version: '2.4.0 - Proper 5-Second Trimming',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    }
  });
});

// Main video sequencing endpoint with proper trimming
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video sequencing request');
  
  try {
    const { videoUrls, tracks } = req.body;
    
    let timeline = [];
    
    if (tracks && tracks.length > 0) {
      timeline = tracks[0].keyframes || [];
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
    
    // Limit to 8 videos for performance
    if (timeline.length > 8) {
      console.log(`⚠️ Limiting from ${timeline.length} to 8 videos`);
      timeline = timeline.slice(0, 8);
    }
    
    console.log(`📊 Processing ${timeline.length} video segments (5s each)`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download and trim videos to exactly 5 seconds each
    const trimmedFiles = [];
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      try {
        console.log(`📥 Downloading segment ${i + 1}: ${segment.url}`);
        
        const response = await fetch(segment.url, { timeout: 15000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const buffer = await response.buffer();
        const originalPath = path.join(tempDir, `original${i}.mp4`);
        const trimmedPath = path.join(tempDir, `trimmed${i}.mp4`);
        
        fs.writeFileSync(originalPath, buffer);
        console.log(`✅ Downloaded segment ${i + 1}, size: ${(buffer.length / 1024).toFixed(2)} KB`);
        
        // TRIM VIDEO TO EXACTLY 5 SECONDS
        console.log(`✂️ Trimming segment ${i + 1} to 5 seconds...`);
        
        await new Promise((resolve, reject) => {
          ffmpeg(originalPath)
            .inputOptions(['-ss', '0']) // Start from beginning
            .outputOptions([
              '-t', '5', // Duration: exactly 5 seconds
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'fast',
              '-crf', '28', // Good quality
              '-vf', 'scale=720:-2', // 720p for good quality
              '-r', '24', // 24fps
              '-movflags', '+faststart'
            ])
            .output(trimmedPath)
            .on('start', () => {
              console.log(`🚀 Trimming segment ${i + 1} to 5 seconds`);
            })
            .on('end', () => {
              console.log(`✅ Trimmed segment ${i + 1} completed`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`❌ Trim error for segment ${i + 1}:`, err.message);
              reject(err);
            })
            .run();
        });
        
        trimmedFiles.push(trimmedPath);
        
        // Clean up original file
        fs.unlinkSync(originalPath);
        
      } catch (error) {
        console.error(`❌ Failed segment ${i + 1}:`, error.message);
      }
    }
    
    if (trimmedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos processed successfully'
      });
    }
    
    console.log(`🔗 Concatenating ${trimmedFiles.length} trimmed segments...`);
    
    // Create concat file with trimmed videos
    const concatContent = trimmedFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    // CONCATENATE TRIMMED VIDEOS
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c', 'copy', // Copy streams (no re-encoding)
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', () => {
          console.log('🔗 Concatenating trimmed videos...');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ Concat progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Concatenation completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Concat error:', err.message);
          reject(new Error(`Concatenation failed: ${err.message}`));
        })
        .run();
      
      // 5 minute timeout for concat
      setTimeout(() => {
        reject(new Error('Concatenation timeout'));
      }, 300000);
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup all temp files
    [...trimmedFiles, concatPath, outputPath].forEach(file => {
      try { 
        if (fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    const expectedDuration = trimmedFiles.length * 5; // 5 seconds per video
    
    console.log(`🎉 Success! ${trimmedFiles.length} videos, expected duration: ${expectedDuration}s`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully processed ${trimmedFiles.length} videos, each trimmed to 5 seconds`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: trimmedFiles.length,
      videosRequested: timeline.length,
      expectedDuration: `${expectedDuration} seconds`,
      quality: '720p, 24fps, CRF28',
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
  console.log(`🚀 Video Sequencer API v2.4.0 running on port ${PORT}`);
  console.log(`✂️ Features: Proper 5-second trimming, 720p quality, stream copy concat`);
});
