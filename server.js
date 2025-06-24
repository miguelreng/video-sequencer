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
    version: '2.5.2 - Simple Zoom-In (Fixed)',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    },
    effects: [
      'Simple and reliable zoom-in effect',
      'Compatible with all video formats',
      'Reduced processing complexity'
    ]
  });
});

// Main video sequencing endpoint with simple zoom
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video sequencing request with simple zoom-in');
  
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
    
    // Limit to 6 videos for better reliability
    if (timeline.length > 6) {
      console.log(`⚠️ Limiting from ${timeline.length} to 6 videos for reliability`);
      timeline = timeline.slice(0, 6);
    }
    
    console.log(`📊 Processing ${timeline.length} video segments with simple zoom-in`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download and process videos with simple zoom
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
        
        console.log(`🔍 Applying simple zoom-in to segment ${i + 1}`);
        
        // SIMPLE ZOOM EFFECT - More reliable
        await new Promise((resolve, reject) => {
          ffmpeg(originalPath)
            .inputOptions(['-ss', '0']) // Start from beginning
            .outputOptions([
              '-t', '5', // Duration: exactly 5 seconds
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'fast', // Faster processing
              '-crf', '28', // Good balance of quality/speed
              
              // SIMPLE ZOOM FILTER - Much more reliable
              '-vf', 'scale=1920:1080,zoompan=z=1.1:d=150:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2),scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
              
              '-r', '24', // 24fps for stability
              '-movflags', '+faststart',
              '-pix_fmt', 'yuv420p'
            ])
            .output(processedPath)
            .on('start', (commandLine) => {
              console.log(`🚀 Processing segment ${i + 1} with simple zoom`);
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
              
              // FALLBACK: Try without zoom effect
              console.log(`🔄 Retrying segment ${i + 1} without zoom...`);
              
              ffmpeg(originalPath)
                .inputOptions(['-ss', '0'])
                .outputOptions([
                  '-t', '5',
                  '-c:v', 'libx264',
                  '-c:a', 'aac',
                  '-preset', 'fast',
                  '-crf', '28',
                  '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280', // No zoom, just resize
                  '-r', '24',
                  '-movflags', '+faststart'
                ])
                .output(processedPath)
                .on('end', () => {
                  console.log(`✅ Segment ${i + 1} completed (fallback - no zoom)`);
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
        // Continue with other segments instead of failing completely
      }
    }
    
    if (processedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos processed successfully',
        details: 'All video segments failed to process. Check video URLs and formats.'
      });
    }
    
    console.log(`🔗 Concatenating ${processedFiles.length} processed segments...`);
    
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
          '-c', 'copy', // Copy streams
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', () => {
          console.log('🔗 Concatenating processed videos...');
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
      
      // 5 minute timeout
      setTimeout(() => {
        reject(new Error('Concatenation timeout'));
      }, 300000);
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
    
    console.log(`🎉 Success! ${processedFiles.length} videos processed`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully processed ${processedFiles.length} videos with zoom effects`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: processedFiles.length,
      videosRequested: timeline.length,
      expectedDuration: `${expectedDuration} seconds`,
      effects: 'Simple zoom-in effect with fallback support',
      quality: '720x1280, 24fps, CRF28',
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
  console.log(`🚀 Video Sequencer API v2.5.2 running on port ${PORT}`);
  console.log(`🔍 Features: Simple zoom-in with fallback, improved reliability`);
});
