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
    version: '2.5.1 - Consistent Slow Zoom-In',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    },
    effects: [
      'Consistent slow zoom-in effect for all videos',
      'Smooth cinematic movement',
      '5-second segments with gradual zoom'
    ]
  });
});

// Main video sequencing endpoint with consistent zoom-in
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video sequencing request with slow zoom-in');
  
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
    
    console.log(`📊 Processing ${timeline.length} video segments with slow zoom-in`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // CONSISTENT SLOW ZOOM-IN EFFECT
    // Starts at 1.0x and slowly zooms to 1.3x over 5 seconds
    const zoomInEffect = 'scale=1.5*iw:1.5*ih,zoompan=z=\'1+0.06*t/5\':d=125:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)';
    
    // Download and process videos with consistent zoom-in
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
        console.log(`✅ Downloaded segment ${i + 1}, size: ${(buffer.length / 1024).toFixed(2)} KB`);
        
        console.log(`🔍 Applying slow zoom-in to segment ${i + 1}`);
        
        // APPLY SLOW ZOOM-IN AND TRIM TO 5 SECONDS
        await new Promise((resolve, reject) => {
          ffmpeg(originalPath)
            .inputOptions(['-ss', '0']) // Start from beginning
            .outputOptions([
              '-t', '5', // Duration: exactly 5 seconds
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'medium', // Good quality
              '-crf', '23', // Higher quality (lower number = better quality)
              '-vf', `${zoomInEffect},scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280`, // Apply zoom + resize
              '-r', '30', // 30fps for smooth motion
              '-movflags', '+faststart',
              '-pix_fmt', 'yuv420p'
            ])
            .output(processedPath)
            .on('start', (commandLine) => {
              console.log(`🚀 Processing segment ${i + 1} with slow zoom-in`);
            })
            .on('progress', (progress) => {
              if (progress.percent) {
                console.log(`⚡ Segment ${i + 1} zoom progress: ${Math.round(progress.percent)}%`);
              }
            })
            .on('end', () => {
              console.log(`✅ Segment ${i + 1} slow zoom-in completed`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`❌ Zoom error for segment ${i + 1}:`, err.message);
              reject(err);
            })
            .run();
        });
        
        processedFiles.push(processedPath);
        
        // Clean up original file
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
    
    console.log(`🔗 Concatenating ${processedFiles.length} zoom-processed segments...`);
    
    // Create concat file with processed videos
    const concatContent = processedFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    // CONCATENATE PROCESSED VIDEOS
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
          console.log('🔗 Concatenating zoom-processed videos...');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ Final concat progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Final concatenation completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Final concat error:', err.message);
          reject(new Error(`Final concatenation failed: ${err.message}`));
        })
        .run();
      
      // 10 minute timeout for processing
      setTimeout(() => {
        reject(new Error('Processing timeout'));
      }, 600000);
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup all temp files
    [...processedFiles, concatPath, outputPath].forEach(file => {
      try { 
        if (fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    const expectedDuration = processedFiles.length * 5;
    
    console.log(`🎉 Success! ${processedFiles.length} videos with consistent slow zoom-in`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully processed ${processedFiles.length} videos with consistent slow zoom-in effect`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: processedFiles.length,
      videosRequested: timeline.length,
      expectedDuration: `${expectedDuration} seconds`,
      effects: 'Consistent slow zoom-in effect (1.0x to 1.3x over 5 seconds)',
      quality: '720x1280, 30fps, CRF23 (high quality)',
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
  console.log(`🚀 Video Sequencer API v2.5.1 running on port ${PORT}`);
  console.log(`🔍 Features: Consistent slow zoom-in effect, 30fps smooth motion, high quality`);
});
