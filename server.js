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
    version: '2.3.1 - Fixed FFmpeg Filter',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    }
  });
});

// Main video sequencing endpoint with fixed FFmpeg
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
    
    console.log(`📊 Processing ${timeline.length} video segments`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download videos
    const localFiles = [];
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      try {
        console.log(`📥 Downloading segment ${i + 1}`);
        
        const response = await fetch(segment.url, { timeout: 20000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const buffer = await response.buffer();
        const filePath = path.join(tempDir, `segment${i}.mp4`);
        fs.writeFileSync(filePath, buffer);
        
        localFiles.push(filePath);
        console.log(`✅ Downloaded segment ${i + 1}`);
        
      } catch (error) {
        console.error(`❌ Failed segment ${i + 1}:`, error.message);
      }
    }
    
    if (localFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos downloaded'
      });
    }
    
    console.log('🎥 Starting FFmpeg processing...');
    
    // SIMPLE CONCAT APPROACH (Fixed)
    const concatContent = localFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          // HEAVY COMPRESSION SETTINGS
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'faster',
          '-crf', '32',
          '-vf', 'scale=640:-2', // Scale to 640p
          '-r', '24', // 24fps
          '-b:a', '96k', // Audio bitrate
          '-movflags', '+faststart',
          '-pix_fmt', 'yuv420p'
        ])
        .output(outputPath)
        .on('start', () => {
          console.log('🚀 FFmpeg started with simple concat');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ Progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ FFmpeg completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg error:', err.message);
          reject(new Error(`FFmpeg failed: ${err.message}`));
        })
        .run();
      
      // 5 minute timeout
      setTimeout(() => {
        reject(new Error('Processing timeout'));
      }, 300000);
    });
    
    // Read and return result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [...localFiles, concatPath, outputPath].forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 Success! Output: ${(outputBuffer.length / 1024).toFixed(2)} KB in ${totalTime}ms`);
    
    res.json({
      success: true,
      message: `Successfully processed ${localFiles.length} videos in ${(totalTime / 1000).toFixed(2)}s`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: localFiles.length,
      compression: {
        outputSizeKB: (outputBuffer.length / 1024).toFixed(2),
        settings: '640p, 24fps, CRF32'
      },
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
  console.log(`🚀 Video Sequencer API v2.3.1 running on port ${PORT}`);
});
