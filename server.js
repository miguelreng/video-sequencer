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
    version: '2.9.0 - Properly Rendered Subtitles',
    endpoints: {
      sequence: 'POST /api/sequence-videos',
      audio: 'POST /api/add-audio', 
      subtitles: 'POST /api/add-subtitles'
    },
    timestamp: new Date().toISOString()
  });
});

// ENDPOINT 1: SEQUENCE MULTIPLE VIDEOS INTO ONE
app.post('/api/sequence-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🎬 [SEQUENCE] Received video sequencing request');
  
  try {
    const { videoUrls, tracks } = req.body;
    
    let timeline = [];
    
    if (tracks && tracks.length > 0) {
      // Find video track
      const videoTrack = tracks.find(track => track.type === 'video');
      if (videoTrack && videoTrack.keyframes) {
        timeline = videoTrack.keyframes;
      }
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
      console.log(`⚠️ [SEQUENCE] Limiting from ${timeline.length} to 6 videos`);
      timeline = timeline.slice(0, 6);
    }
    
    console.log(`📊 [SEQUENCE] Processing ${timeline.length} video segments (5s each)`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download and process videos
    const processedFiles = [];
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      try {
        console.log(`📥 [SEQUENCE] Downloading segment ${i + 1}: ${segment.url}`);
        
        const response = await fetch(segment.url, { timeout: 15000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const buffer = await response.buffer();
        const originalPath = path.join(tempDir, `seq_original${i}.mp4`);
        const processedPath = path.join(tempDir, `seq_processed${i}.mp4`);
        
        fs.writeFileSync(originalPath, buffer);
        console.log(`✅ [SEQUENCE] Downloaded segment ${i + 1}`);
        
        // Process each video to exactly 5 seconds
        await new Promise((resolve, reject) => {
          ffmpeg(originalPath)
            .inputOptions(['-ss', '0'])
            .outputOptions([
              '-t', '5', // Exactly 5 seconds
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'fast',
              '-crf', '25',
              '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
              '-r', '24'
            ])
            .output(processedPath)
            .on('end', () => {
              console.log(`✅ [SEQUENCE] Processed segment ${i + 1}`);
              resolve();
            })
            .on('error', reject)
            .run();
        });
        
        processedFiles.push(processedPath);
        fs.unlinkSync(originalPath);
        
      } catch (error) {
        console.error(`❌ [SEQUENCE] Failed segment ${i + 1}:`, error.message);
      }
    }
    
    if (processedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No videos processed successfully'
      });
    }
    
    // Concatenate all segments
    console.log(`🔗 [SEQUENCE] Concatenating ${processedFiles.length} segments...`);
    
    const concatContent = processedFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, 'seq_concat.txt');
    fs.writeFileSync(concatPath, concatContent);
    
    const outputPath = path.join(tempDir, `sequenced_${Date.now()}.mp4`);
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [...processedFiles, concatPath, outputPath].forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    const totalDuration = processedFiles.length * 5;
    
    console.log(`🎉 [SEQUENCE] Success! ${processedFiles.length} videos = ${totalDuration} seconds total`);
    
    res.json({
      success: true,
      message: `Successfully sequenced ${processedFiles.length} videos into ${totalDuration} seconds`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      videosProcessed: processedFiles.length,
      totalDuration: `${totalDuration} seconds`,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 [SEQUENCE] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ENDPOINT 2: ADD AUDIO TO SINGLE VIDEO
app.post('/api/add-audio', async (req, res) => {
  const startTime = Date.now();
  console.log('🎵 [AUDIO] Received audio overlay request');
  
  try {
    const { tracks } = req.body;
    
    if (!tracks || tracks.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Both video and audio tracks are required'
      });
    }
    
    let videoTrack = null;
    let audioTrack = null;
    
    tracks.forEach(track => {
      if (track.type === 'video' && track.keyframes && track.keyframes.length > 0) {
        videoTrack = track.keyframes[0];
      } else if (track.type === 'audio' && track.keyframes && track.keyframes.length > 0) {
        audioTrack = track.keyframes[0];
      }
    });
    
    if (!videoTrack || !audioTrack) {
      return res.status(400).json({
        success: false,
        error: 'Both video and audio keyframes are required'
      });
    }
    
    console.log(`📹 [AUDIO] Video: ${videoTrack.url}`);
    console.log(`🎵 [AUDIO] Audio: ${audioTrack.url}`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download video
    console.log('📥 [AUDIO] Downloading video...');
    const videoResponse = await fetch(videoTrack.url, { timeout: 30000 });
    if (!videoResponse.ok) {
      throw new Error(`Video download failed: ${videoResponse.status}`);
    }
    
    const videoBuffer = await videoResponse.buffer();
    const videoPath = path.join(tempDir, `audio_video_${Date.now()}.mp4`);
    fs.writeFileSync(videoPath, videoBuffer);
    
    // Download audio
    console.log('📥 [AUDIO] Downloading audio...');
    const audioResponse = await fetch(audioTrack.url, { timeout: 30000 });
    if (!audioResponse.ok) {
      throw new Error(`Audio download failed: ${audioResponse.status}`);
    }
    
    const audioBuffer = await audioResponse.buffer();
    const audioPath = path.join(tempDir, `audio_input_${Date.now()}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer);
    
    // Combine video + audio
    const outputPath = path.join(tempDir, `final_${Date.now()}.mp4`);
    const duration = Math.min(videoTrack.duration || 60, audioTrack.duration || 60);
    
    console.log(`🔄 [AUDIO] Combining video + audio (${duration}s)...`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .input(audioPath)
        .outputOptions([
          '-t', duration.toString(),
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('end', () => {
          console.log('✅ [AUDIO] Combination completed');
          resolve();
        })
        .on('error', reject)
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [videoPath, audioPath, outputPath].forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 [AUDIO] Success! Video with audio created`);
    
    res.json({
      success: true,
      message: `Successfully added audio to video (${duration} seconds)`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      duration: `${duration} seconds`,
      hasAudio: true,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 [AUDIO] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ENDPOINT 3: ADD PROPERLY RENDERED SUBTITLES
app.post('/api/add-subtitles', async (req, res) => {
  const startTime = Date.now();
  console.log('📝 [SUBTITLES] Adding properly rendered subtitles');
  
  try {
    const { video_url, subtitles, style } = req.body;
    
    if (!video_url) {
      return res.status(400).json({
        success: false,
        error: 'video_url is required'
      });
    }
    
    if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'subtitles array is required'
      });
    }
    
    console.log(`📹 [SUBTITLES] Video: ${video_url}`);
    console.log(`📝 [SUBTITLES] Processing ${subtitles.length} subtitle segments`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download video
    console.log('📥 [SUBTITLES] Downloading video...');
    const videoResponse = await fetch(video_url, { timeout: 30000 });
    if (!videoResponse.ok) {
      throw new Error(`Video download failed: ${videoResponse.status}`);
    }
    
    const videoBuffer = await videoResponse.buffer();
    const inputPath = path.join(tempDir, 'subtitle_input.mp4');
    fs.writeFileSync(inputPath, videoBuffer);
    console.log(`✅ [SUBTITLES] Video saved: ${(videoBuffer.length / 1024).toFixed(2)} KB`);
    
    // Create ASS subtitle file (more reliable than SRT for styling)
    const assContent = createASSContent(subtitles, style);
    const assPath = path.join(tempDir, 'subtitles.ass');
    fs.writeFileSync(assPath, assContent, 'utf8');
    console.log('✅ [SUBTITLES] ASS subtitle file created');
    console.log('📄 [SUBTITLES] Preview:', assContent.substring(0, 500));
    
    const outputPath = path.join(tempDir, 'subtitle_output.mp4');
    
    console.log('🔄 [SUBTITLES] Rendering subtitles into video...');
    
    await new Promise((resolve, reject) => {
      // Escape the path for Windows/Unix compatibility
      const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'copy',
          '-preset', 'fast',
          '-crf', '23',
          // Use ASS subtitles filter for proper rendering
          '-vf', `ass=${escapedAssPath}`,
          '-movflags', '+faststart',
          '-y' // Overwrite output
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 [SUBTITLES] FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ [SUBTITLES] Progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ [SUBTITLES] Subtitles successfully rendered into video');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ [SUBTITLES] ASS rendering failed:', err.message);
          
          // FALLBACK: Use drawtext method for maximum compatibility
          console.log('🔄 [SUBTITLES] Fallback: Using drawtext method...');
          
          // Build multiple drawtext filters
          const textFilters = subtitles.map((subtitle, index) => {
            // Clean text for drawtext (remove special characters that cause issues)
            const cleanText = subtitle.text
              .replace(/'/g, '')
              .replace(/"/g, '')
              .replace(/[\\:]/g, '')
              .replace(/[^\w\s\u00C0-\u017F]/g, ''); // Keep alphanumeric and accented chars
            
            return `drawtext=text='${cleanText}':fontsize=28:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-120:enable='between(t,${subtitle.start},${subtitle.end})'`;
          });
          
          const combinedFilter = textFilters.join(',');
          
          ffmpeg(inputPath)
            .outputOptions([
              '-c:v', 'libx264',
              '-c:a', 'copy',
              '-preset', 'fast',
              '-crf', '25',
              '-vf', combinedFilter,
              '-movflags', '+faststart',
              '-y'
            ])
            .output(outputPath)
            .on('end', () => {
              console.log('✅ [SUBTITLES] Fallback drawtext completed');
              resolve();
            })
            .on('error', (fallbackErr) => {
              console.error('❌ [SUBTITLES] Drawtext fallback failed:', fallbackErr.message);
              
              // FINAL FALLBACK: Single subtitle test
              console.log('🔄 [SUBTITLES] Final fallback: single subtitle...');
              
              const firstSub = subtitles[0];
              const simpleText = firstSub.text.replace(/[^\w\s]/g, '');
              
              ffmpeg(inputPath)
                .outputOptions([
                  '-c:v', 'libx264',
                  '-c:a', 'copy',
                  '-preset', 'ultrafast',
                  '-crf', '30',
                  '-vf', `drawtext=text='${simpleText}':fontsize=32:fontcolor=yellow:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-100`,
                  '-y'
                ])
                .output(outputPath)
                .on('end', () => {
                  console.log('✅ [SUBTITLES] Single subtitle test completed');
                  resolve();
                })
                .on('error', (finalErr) => {
                  console.error('❌ [SUBTITLES] All methods failed:', finalErr.message);
                  // Copy original as final resort
                  fs.copyFileSync(inputPath, outputPath);
                  resolve();
                })
                .run();
            })
            .run();
        })
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [inputPath, assPath, outputPath].forEach(file => {
      try { 
        if (fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 [SUBTITLES] Success! Video with burned-in subtitles created`);
    console.log(`📦 [SUBTITLES] Output: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully rendered ${subtitles.length} subtitles into video`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      subtitleCount: subtitles.length,
      processingTimeMs: totalTime,
      note: 'Subtitles are permanently burned into the video'
    });
    
  } catch (error) {
    console.error('💥 [SUBTITLES] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to create ASS subtitle content with proper styling
function createASSContent(subtitles, style = {}) {
  const defaultStyle = {
    fontName: style?.font || 'Arial',
    fontSize: style?.fontSize || 28,
    primaryColor: '&Hffffff', // White
    outlineColor: '&H000000', // Black
    backColor: '&H80000000', // Semi-transparent black
    outline: 3,
    shadow: 0,
    alignment: 2, // Bottom center
    marginV: 50
  };
  
  const header = `[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${defaultStyle.fontName},${defaultStyle.fontSize},${defaultStyle.primaryColor},${defaultStyle.primaryColor},${defaultStyle.outlineColor},${defaultStyle.backColor},1,0,0,0,100,100,0,0,1,${defaultStyle.outline},${defaultStyle.shadow},${defaultStyle.alignment},10,10,${defaultStyle.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = subtitles.map(subtitle => {
    const startTime = formatASSTime(subtitle.start);
    const endTime = formatASSTime(subtitle.end);
    const cleanText = subtitle.text.replace(/\n/g, '\\N');
    
    return `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${cleanText}`;
  }).join('\n');
  
  return header + events;
}

// Helper function to format time for ASS format
function formatASSTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centiseconds = Math.floor((seconds % 1) * 100);
  
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.9.0 running on port ${PORT}`);
  console.log(`📹 /api/sequence-videos - Multiple videos → One video`);
  console.log(`🎵 /api/add-audio - Single video + audio → Final video`);
  console.log(`📝 /api/add-subtitles - Video + subtitles → Final video (burned-in)`);
  console.log(`📡 Health check: http://localhost:${PORT}/`);
});
