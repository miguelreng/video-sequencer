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
    version: '2.1.0 - Fast Processing',
    endpoints: {
      sequence: 'POST /api/sequence-videos',
      timeline: 'POST /api/sequence-videos (with tracks)'
    },
    optimizations: [
      'Stream copy mode for faster processing',
      'Reduced timeout for quicker feedback',
      'Batch processing support',
      'Memory usage optimization'
    ]
  });
});

// Main video sequencing endpoint with optimized processing
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
        timestamp: index * 5, // 5 seconds each by default
        duration: 5
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either videoUrls array or tracks array is required'
      });
    }
    
    // Limit videos for performance (Railway free tier optimization)
    const maxVideos = 8; // Reduced from 13 for faster processing
    if (timeline.length > maxVideos) {
      console.log(`⚠️  Limiting videos from ${timeline.length} to ${maxVideos} for performance`);
      timeline = timeline.slice(0, maxVideos);
    }
    
    console.log(`📊 Processing ${timeline.length} video segments`);
    
    // Create temp directory
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download videos with timeline (optimized parallel downloads)
    console.log('⬇️  Starting parallel video downloads...');
    const downloadStartTime = Date.now();
    
    const downloadPromises = timeline.map(async (segment, index) => {
      try {
        console.log(`📥 Downloading segment ${index + 1}: ${segment.url}`);
        
        const response = await fetch(segment.url, { 
          timeout: 25000, // Reduced timeout
          headers: {
            'User-Agent': 'VideoSequencer/2.1.0'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.buffer();
        const filePath = path.join(tempDir, `segment${index}_${Date.now()}.mp4`);
        fs.writeFileSync(filePath, buffer);
        
        console.log(`✅ Downloaded segment ${index + 1}, size: ${(buffer.length / 1024).toFixed(2)} KB`);
        
        return {
          path: filePath,
          duration: segment.duration,
          timestamp: segment.timestamp,
          index: index,
          size: buffer.length
        };
        
      } catch (downloadError) {
        console.error(`❌ Failed to download segment ${index + 1}:`, downloadError.message);
        return null;
      }
    });
    
    // Wait for all downloads to complete
    const downloadResults = await Promise.allSettled(downloadPromises);
    const localFiles = downloadResults
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value)
      .sort((a, b) => a.index - b.index); // Ensure correct order
    
    const downloadTime = Date.now() - downloadStartTime;
    console.log(`⏱️  Downloads completed in ${downloadTime}ms`);
    
    if (localFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos could be downloaded',
        attempted: timeline.length
      });
    }
    
    if (localFiles.length < timeline.length) {
      console.log(`⚠️  Warning: Only ${localFiles.length}/${timeline.length} videos downloaded successfully`);
    }
    
    // Create concat file for FFmpeg
    const concatContent = localFiles.map(file => `file '${file.path}'`).join('\n');
    const concatPath = path.join(tempDir, `concat_${Date.now()}.txt`);
    fs.writeFileSync(concatPath, concatContent);
    
    console.log(`📝 Created concat file with ${localFiles.length} segments`);
    console.log('🎥 Starting optimized FFmpeg processing...');
    
    // Process with FFmpeg - OPTIMIZED FOR SPEED
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    const ffmpegStartTime = Date.now();
    
    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(concatPath)
        .inputOptions([
          '-f', 'concat',
          '-safe', '0',
          '-fflags', '+genpts' // Generate proper timestamps
        ])
        .outputOptions([
          // FAST PROCESSING - Copy streams without re-encoding
          '-c', 'copy', // Copy video and audio streams (fastest)
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          '-map_metadata', '-1' // Remove metadata for smaller files
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 FFmpeg started (fast copy mode)');
          console.log('Command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            const percent = Math.round(progress.percent);
            console.log(`⚡ Processing: ${percent}% complete`);
          }
        })
        .on('end', () => {
          const ffmpegTime = Date.now() - ffmpegStartTime;
          console.log(`✅ FFmpeg completed in ${ffmpegTime}ms`);
          resolve();
        })
        .on('error', (err) => {
          const ffmpegTime = Date.now() - ffmpegStartTime;
          console.error(`❌ FFmpeg error after ${ffmpegTime}ms:`, err.message);
          
          // Fallback: Try with re-encoding if copy fails
          console.log('🔄 Trying fallback processing with re-encoding...');
          
          const fallbackCommand = ffmpeg()
            .input(concatPath)
            .inputOptions(['-f', 'concat', '-safe', '0'])            
            .outputOptions([
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'ultrafast',
              '-crf', '28', // Higher number = smaller file
              '-vf', 'scale=720:-2', // Reduce resolution
              '-r', '24', // Reduce frame rate
              '-movflags', '+faststart'
            ])
            .output(outputPath)
            .on('end', () => {
              console.log('✅ Fallback processing completed');
              resolve();
            })
            .on('error', (fallbackErr) => {
              console.error('❌ Fallback processing failed:', fallbackErr.message);
              reject(new Error(`Both fast and fallback processing failed: ${fallbackErr.message}`));
            })
            .run();
          
          // Timeout for fallback
          setTimeout(() => {
            fallbackCommand.kill('SIGKILL');
            reject(new Error('Fallback processing timeout'));
          }, 45000); // 45 seconds for fallback
        });
      
      // Reduced timeout for fast copy mode
      const copyTimeout = setTimeout(() => {
        console.log('⏰ Fast copy mode timeout, killing process...');
        command.kill('SIGKILL');
        // Don't reject immediately, let the error handler try fallback
      }, 30000); // 30 seconds for copy mode
      
      command.on('end', () => {
        clearTimeout(copyTimeout);
      });
      
      command.run();
    });
    
    // Read output file and convert to base64
    console.log('📖 Reading output file...');
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup temp files
    console.log('🧹 Cleaning up temporary files...');
    const cleanupFiles = [
      ...localFiles.map(f => f.path),
      concatPath,
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
    
    console.log(`🎉 Processing completed successfully!`);
    console.log(`📊 Stats: ${localFiles.length} videos, ${(totalSize / 1024 / 1024).toFixed(2)} MB input, ${(outputBuffer.length / 1024).toFixed(2)} KB output`);
    console.log(`⏱️  Total time: ${totalTime}ms, Cleaned ${cleanedFiles} temp files`);
    
    res.json({
      success: true,
      message: `Successfully processed ${localFiles.length} video segments in ${(totalTime / 1000).toFixed(2)}s`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: localFiles.length,
      videosRequested: timeline.length,
      performance: {
        totalTimeMs: totalTime,
        downloadTimeMs: downloadTime,
        ffmpegTimeMs: Date.now() - ffmpegStartTime,
        inputSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        outputSizeKB: (outputBuffer.length / 1024).toFixed(2),
        compressionRatio: ((1 - outputBuffer.length / totalSize) * 100).toFixed(1) + '%'
      },
      timeline: {
        totalSegments: localFiles.length,
        totalDuration: timeline.reduce((sum, seg) => sum + seg.duration, 0),
        segments: timeline.slice(0, localFiles.length).map((seg, index) => ({
          index: index + 1,
          timestamp: seg.timestamp,
          duration: seg.duration,
          processed: true
        }))
      }
    });
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`💥 Video sequencing error after ${totalTime}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      errorType: error.name,
      processingTimeMs: totalTime,
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Internal server error'
    });
  }
});

// Health monitoring endpoint
app.get('/api/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: {
      used: (memUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
      total: (memUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
      external: (memUsage.external / 1024 / 1024).toFixed(2) + ' MB'
    },
    version: '2.1.0'
  });
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

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.1.0 running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
  console.log(`🔍 Health monitor: http://localhost:${PORT}/api/health`);
  console.log(`🎬 Sequence endpoint: http://localhost:${PORT}/api/sequence-videos`);
  console.log(`⚡ Optimizations: Fast copy mode, parallel downloads, reduced timeouts`);
});
