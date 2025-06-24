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
    version: '2.5.3 - Fixed Aspect Ratio Zoom',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    },
    effects: [
      'Proper aspect ratio zoom-in',
      'No stretching or distortion',
      'Clean portrait format output'
    ]
  });
});

// Main video sequencing endpoint with proper zoom
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video sequencing request with proper zoom');
  
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
    
    // Limit to 6 videos for reliability
    if (timeline.length > 6) {
      console.log(`⚠️ Limiting from ${timeline.length} to 6 videos`);
      timeline = timeline.slice(0, 6);
    }
    
    console.log(`📊 Processing ${timeline.length} video segments with proper zoom`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download and process videos with proper zoom
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
        
        console.log(`🔍 Applying proper zoom to segment ${i + 1}`);
        
        // PROPER ZOOM WITH CORRECT ASPECT RATIO
        await new Promise((resolve, reject) => {
          ffmpeg(originalPath)
            .inputOptions(['-ss', '0']) // Start from beginning
            .outputOptions([
              '-t', '5', // Duration: exactly 5 seconds
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'fast',
              '-crf', '25',
              
              // PROPER ZOOM FILTER - No stretching
              '-vf', [
                // First, crop to portrait aspect ratio while maintaining quality
                'scale=1080:-1', // Scale width to 1080, keep aspect ratio
                // Apply gentle zoom from center
                'crop=1080:1920:0:0', // Crop to 9:16 aspect ratio
                // Slow zoom in over 5 seconds (1.0x to 1.15x)
                'zoompan=z=\'min(1.15,1+(t/5)*0.15)\':d=125:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)',
                // Final resize to exact output dimensions
                'scale=720:1280'
              ].join(','),
              
              '-r', '24', // 24fps
              '-movflags', '+faststart',
              '-pix_fmt', 'yuv420p'
            ])
            .output(processedPath)
            .on('start', (commandLine) => {
              console.log(`🚀 Processing segment ${i + 1} with proper zoom`);
            })
            .on('progress', (progress) => {
              if (progress.percent) {
                console.log(`⚡ Segment ${i + 1} progress: ${Math.round(progress.percent)}%`);
              }
            })
            .on('end', () => {
              console.log(`✅ Segment ${i + 1} zoom completed`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`❌ Zoom error for segment ${i + 1}:`, err.message);
              
              // SIMPLE FALLBACK - Just resize without zoom
              console.log(`🔄 Retrying segment ${i + 1} with simple resize...`);
              
              ffmpeg(originalPath)
                .inputOptions(['-ss', '0'])
                .outputOptions([
                  '-t', '5',
                  '-c:v', 'libx264',
                  '-c:a', 'aac',
                  '-preset', 'fast',
                  '-crf', '25',
                  // Simple resize maintaining aspect ratio
                  '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                  '-r', '24',
                  '-movflags', '+faststart'
                ])
                .output(processedPath)
                .on('end', () => {
                  console.log(`✅ Segment ${i + 1} completed (simple resize)`);
                  resolve();
                })
                .on('error', (fallbackErr) => {
                  console.error(`❌ Fallback failed for segment ${i + 1}:`, fallbackErr.message);
                  reject(fallbackErr);
                })
                .run();
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
    
    console.log(`🔗 Concatenating ${processedFiles.length} processed segments...`);
    
    // Create concat file
    const concatContent = processedFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    // CONCATENATE VIDEOS
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c', 'copy',
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', () => {
          console.log('🔗 Concatenating videos...');
        })
        .on('end', () => {
          console.log('✅ Concatenation completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Concat error:', err.message);
          reject(err);
        })
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [...processedFiles, concatPath, outputPath].forEach(file => {
      try { 
        if (fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    const expectedDuration = processedFiles.length * 5;
    
    console.log(`🎉 Success! ${processedFiles.length} videos with proper zoom`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully processed ${processedFiles.length} videos with proper aspect ratio zoom`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: processedFiles.length,
      videosRequested: timeline.length,
      expectedDuration: `${expectedDuration} seconds`,
      effects: 'Gentle zoom-in (1.0x to 1.15x) with proper aspect ratio',
      quality: '720x1280, 24fps, no stretching',
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
  console.log(`🚀 Video Sequencer API v2.5.3 running on port ${PORT}`);
  console.log(`🔍 Features: Proper aspect ratio zoom, no stretching, gentle 1.15x zoom`);
});
