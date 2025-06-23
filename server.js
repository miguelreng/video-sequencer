const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Video Sequencer API is running!',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    }
  });
});

// Main video sequencing endpoint
app.post('/api/sequence-videos', async (req, res) => {
  console.log('Received video sequencing request');
  
  try {
    const { videoUrls } = req.body;
    
    if (!videoUrls || !Array.isArray(videoUrls)) {
      return res.status(400).json({ 
        success: false,
        error: 'videoUrls array is required' 
      });
    }
    
    // Limit videos for processing time
    const limitedUrls = videoUrls.slice(0, 5);
    console.log(`Processing ${limitedUrls.length} videos`);
    
    // Create temp directory
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download videos
    const localFiles = [];
    for (let i = 0; i < limitedUrls.length; i++) {
      const videoUrl = limitedUrls[i].mp4_url || limitedUrls[i];
      console.log(`Downloading video ${i + 1}: ${videoUrl}`);
      
      try {
        const response = await fetch(videoUrl, {
          timeout: 30000 // 30 second timeout
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.buffer();
        const filePath = path.join(tempDir, `video${i}.mp4`);
        fs.writeFileSync(filePath, buffer);
        localFiles.push(filePath);
        
        console.log(`Downloaded video ${i + 1}, size: ${buffer.length} bytes`);
      } catch (downloadError) {
        console.error(`Failed to download video ${i + 1}:`, downloadError.message);
        // Continue with other videos
      }
    }
    
    if (localFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos could be downloaded'
      });
    }
    
    // Create concat file
    const concatContent = localFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    console.log('Created concat file with', localFiles.length, 'videos');
    
    // Process with FFmpeg
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'fast',
          '-crf', '28', // Slightly lower quality for speed
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg started:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log('Progress:', Math.round(progress.percent) + '%');
          }
        })
        .on('end', () => {
          console.log('FFmpeg processing completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(new Error(`FFmpeg failed: ${err.message}`));
        });
      
      // Set timeout for FFmpeg process
      setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error('FFmpeg processing timeout'));
      }, 120000); // 2 minute timeout
      
      command.run();
    });
    
    // Read output file
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup temp files
    const cleanupFiles = [...localFiles, concatPath, outputPath];
    cleanupFiles.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError.message);
      }
    });
    
    console.log(`Successfully sequenced ${localFiles.length} videos. Output size: ${outputBuffer.length} bytes`);
    
    res.json({
      success: true,
      message: `Successfully sequenced ${localFiles.length} videos`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: localFiles.length
    });
    
  } catch (error) {
    console.error('Video sequencing error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Internal server error'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`🎬 Sequence endpoint: http://localhost:${PORT}/api/sequence-videos`);
});
