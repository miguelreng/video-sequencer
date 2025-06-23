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
    version: '2.0.0',
    endpoints: {
      sequence: 'POST /api/sequence-videos',
      timeline: 'POST /api/sequence-videos (with tracks)'
    }
  });
});

// Main video sequencing endpoint with timeline support
app.post('/api/sequence-videos', async (req, res) => {
  console.log('Received video sequencing request');
  
  try {
    const { videoUrls, tracks } = req.body;
    
    let timeline = [];
    
    if (tracks && tracks.length > 0) {
      // Use tracks format (timeline with timestamps)
      console.log('Processing timeline with tracks...');
      timeline = tracks[0].keyframes || [];
    } else if (videoUrls) {
      // Convert simple videoUrls to timeline format
      console.log('Converting videoUrls to timeline...');
      timeline = videoUrls.map((video, index) => ({
        url: video.mp4_url || video,
        timestamp: index * 5, // 5 seconds each by default
        duration: 5
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either videoUrls array or tracks array is required'
      });
    }
    
    console.log(`Processing ${timeline.length} video segments`);
    
    // Create temp directory
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download videos with timeline
    const localFiles = [];
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      console.log(`Downloading segment ${i + 1}: ${segment.url} (${segment.duration}s)`);
      
      try {
        const response = await fetch(segment.url, { timeout: 30000 });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.buffer();
        const filePath = path.join(tempDir, `segment${i}.mp4`);
        fs.writeFileSync(filePath, buffer);
        
        localFiles.push({
          path: filePath,
          duration: segment.duration,
          timestamp: segment.timestamp
        });
        
        console.log(`Downloaded segment ${i + 1}, size: ${buffer.length} bytes`);
      } catch (downloadError) {
        console.error(`Failed to download segment ${i + 1}:`, downloadError.message);
      }
    }
    
    if (localFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos could be downloaded'
      });
    }
    
    // Create concat file for simple concatenation
    const concatContent = localFiles.map(file => `file '${file.path}'`).join('\n');
    const concatPath = path.join(tempDir, 'concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    console.log('Created concat file with', localFiles.length, 'segments');
    
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
          '-crf', '28',
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
          console.log('Timeline processing completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(new Error(`Timeline processing failed: ${err.message}`));
        });
      
      setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error('Timeline processing timeout'));
      }, 180000); // 3 minute timeout
      
      command.run();
    });
    
    // Read output file
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup temp files
    const cleanupFiles = [...localFiles.map(f => f.path), concatPath, outputPath];
    cleanupFiles.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError.message);
      }
    });
    
    console.log(`Successfully processed ${localFiles.length} segments. Output size: ${outputBuffer.length} bytes`);
    
    res.json({
      success: true,
      message: `Successfully created timeline with ${localFiles.length} segments`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: localFiles.length,
      timeline: {
        totalSegments: timeline.length,
        totalDuration: timeline.reduce((sum, seg) => sum + seg.duration, 0),
        segments: timeline.map(seg => ({
          timestamp: seg.timestamp,
          duration: seg.duration
        }))
      }
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.0 running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`🎬 Sequence endpoint: http://localhost:${PORT}/api/sequence-videos`);
});
