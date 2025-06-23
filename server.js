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
    version: '2.3.0 - High Compression Mode',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    },
    optimizations: [
      'Heavy compression for smaller output',
      'Reduced resolution for faster processing',
      'Optimized codec settings',
      'Memory usage optimization'
    ]
  });
});

// Main video sequencing endpoint with heavy compression
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 Received video sequencing request at', new Date().toISOString());
  
  try {
    const { videoUrls, tracks } = req.body;
    
    let timeline = [];
    
    if (tracks && tracks.length > 0) {
      // Use tracks format (timeline with timestamps)
      console.log('📋 Processing timeline with tracks...');
      timeline = tracks[0].keyframes || [];
    } else if (videoUrls) {
      // Convert simple videoUrls to timeline format
      console.log('🔄 Converting videoUrls to timeline...');
      timeline = videoUrls.map((video, index) => ({
        url: video.mp4_url || video,
        timestamp: index * 3, // Reduced to 3 seconds each
        duration: 3
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either videoUrls array or tracks array is required'
      });
    }
    
    // Process all videos but with shorter durations
    console.log(`📊 Processing ${timeline.length} video segments (3s each)`);
    
    // Create temp directory
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download videos
    console.log('⬇️  Starting video downloads...');
    const downloadStartTime = Date.now();
    
    const localFiles = [];
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      try {
        console.log(`📥 Downloading segment ${i + 1}: ${segment.url}`);
        
        const response = await fetch(segment.url, { 
          timeout: 20000,
          headers: {
            'User-Agent': 'VideoSequencer/2.3.0'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.buffer();
        const filePath = path.join(tempDir, `segment${i}.mp4`);
        fs.writeFileSync(filePath, buffer);
        
        localFiles.push({
          path: filePath,
          duration: segment.duration,
          timestamp: segment.timestamp,
          index: i,
          size: buffer.length
        });
        
        console.log(`✅ Downloaded segment ${i + 1}, size: ${(buffer.length / 1024).toFixed(2)} KB`);
        
      } catch (downloadError) {
        console.error(`❌ Failed to download segment ${i + 1}:`, downloadError.message);
      }
    }
    
    const downloadTime = Date.now() - downloadStartTime;
    console.log(`⏱️  Downloads completed in ${downloadTime}ms`);
    
    if (localFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos could be downloaded'
      });
    }
    
    console.log(`🎥 Starting HEAVY COMPRESSION processing...`);
    
    // Process with FFmpeg - HEAVY COMPRESSION
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    const ffmpegStartTime = Date.now();
    
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      
      // Add all inputs
      localFiles.forEach(file => {
        command.input(file.path);
      });
      
      // Create filter for concatenation with heavy compression
      const inputs = localFiles.map((_, i) => `[${i}:v][${i}:a]`).join('');
      const filter = `${inputs}concat=n=${localFiles.length}:v=1:a=1[outv][outa]`;
      
      command
        .complexFilter(filter)
        .outputOptions([
          '-map', '[outv]', 
          '-map', '[outa]',
          
          // HEAVY COMPRESSION SETTINGS
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'faster', // Faster encoding
          '-crf', '35', // Higher CRF = smaller file (was 28, now 35)
          
          // REDUCE RESOLUTION for smaller file
          '-vf', 'scale=480:-2', // Scale to 480p width
          
          // REDUCE FRAME RATE
          '-r', '20', // 20fps instead of original
          
          // AUDIO COMPRESSION
          '-b:a', '64k', // Low audio bitrate
          '-ar', '22050', // Lower sample rate
          
          // OTHER OPTIMIZATIONS
          '-movflags', '+faststart',
          '-pix_fmt', 'yuv420p',
          '-profile:v', 'baseline', // Baseline profile for compatibility
          '-level', '3.0'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 FFmpeg started (high compression mode)');
          console.log('Settings: 480p, 20fps, CRF35, 64k audio');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            const percent = Math.round(progress.percent);
            console.log(`⚡ Compressing: ${percent}% complete`);
          }
        })
        .on('end', () => {
          const ffmpegTime = Date.now() - ffmpegStartTime;
          console.log(`✅ FFmpeg compression completed in ${ffmpegTime}ms`);
          resolve();
        })
        .on('error', (err) => {
          const ffmpegTime = Date.now() - ffmpegStartTime;
          console.error(`❌ FFmpeg error after ${ffmpegTime}ms:`, err.message);
          reject(new Error(`Compression failed: ${err.message}`));
        });
      
      // Extended timeout for compression
      const timeout = setTimeout(() => {
        console.log('⏰ Compression timeout, killing process...');
        command.kill('SIGKILL');
        reject(new Error('Compression timeout'));
      }, 180000); // 3 minutes for compression
      
      command.on('end', () => {
        clearTimeout(timeout);
      });
      
      command.run();
    });
    
    // Read output file and convert to base64
    console.log('📖 Reading compressed output file...');
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup temp files
    console.log('🧹 Cleaning up temporary files...');
    const cleanupFiles = [
      ...localFiles.map(f => f.path),
      outputPath
    ];
    
    let cleanedFiles = 0;
    cleanupFiles.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          cleanedFiles++;
        }
      } catch (cleanupError) {
        console.warn('⚠️  Cleanup warning:', cleanupError.message);
      }
    });
    
    const totalTime = Date.now() - startTime;
    const totalSize = localFiles.reduce((sum, file) => sum + file.size, 0);
    
    console.log(`🎉 Compression completed successfully!`);
    console.log(`📊 Stats: ${localFiles.length} videos processed`);
    console.log(`📉 Compression: ${(totalSize / 1024 / 1024).toFixed(2)} MB → ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`📈 Compression ratio: ${((1 - outputBuffer.length / totalSize) * 100).toFixed(1)}%`);
    console.log(`⏱️  Total time: ${totalTime}ms, Cleaned ${cleanedFiles} temp files`);
    
    res.json({
      success: true,
      message: `Successfully processed ${localFiles.length} video segments with heavy compression in ${(totalTime / 1000).toFixed(2)}s`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: localFiles.length,
      videosRequested: timeline.length,
      compression: {
        inputSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        outputSizeKB: (outputBuffer.length / 1024).toFixed(2),
        compressionRatio: ((1 - outputBuffer.length / totalSize) * 100).toFixed(1) + '%',
        settings: '480p, 20fps, CRF35, 64k audio'
      },
      performance: {
        totalTimeMs: totalTime,
        downloadTimeMs: downloadTime,
        ffmpegTimeMs: Date.now() - ffmpegStartTime
      },
      timeline: {
        totalSegments: localFiles.length,
        totalDuration: timeline.reduce((sum, seg) => sum + seg.duration, 0),
        segmentDuration: '3 seconds each'
      }
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`💥 Video sequencing error after ${totalTime}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      errorType: error.name,
      processingTimeMs: totalTime
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.3.0 running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`🎬 Sequence endpoint: http://localhost:${PORT}/api/sequence-videos`);
  console.log(`📉 Optimizations: Heavy compression, 480p, 20fps, CRF35`);
});
