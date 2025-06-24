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
    version: '2.8.0 - Subtitle Support Added',
    endpoints: {
      sequence: 'POST /api/sequence-videos (multiple videos → one video)',
      audio: 'POST /api/add-audio (single video + audio → final video)',
      subtitles: 'POST /api/add-subtitles (video + subtitles → final video)'
    }
  });
});

// Your existing endpoints here...
// (Keep /api/sequence-videos and /api/add-audio as they are)

// ENDPOINT 3: ADD SUBTITLES TO VIDEO
app.post('/api/add-subtitles', async (req, res) => {
  const startTime = Date.now();
  console.log('📝 Received subtitle overlay request');
  
  try {
    const { video_url, subtitles, style } = req.body;
    
    if (!video_url) {
      return res.status(400).json({
        success: false,
        error: 'video_url is required'
      });
    }
    
    if (!subtitles || !Array.isArray(subtitles)) {
      return res.status(400).json({
        success: false,
        error: 'subtitles array is required'
      });
    }
    
    console.log(`📹 Video: ${video_url}`);
    console.log(`📝 Subtitles: ${subtitles.length} segments`);
    
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Download video
    console.log('📥 Downloading video...');
    const videoResponse = await fetch(video_url, { timeout: 30000 });
    if (!videoResponse.ok) {
      throw new Error(`Video download failed: ${videoResponse.status}`);
    }
    
    const videoBuffer = await videoResponse.buffer();
    const videoPath = path.join(tempDir, `input_video_${Date.now()}.mp4`);
    fs.writeFileSync(videoPath, videoBuffer);
    console.log(`✅ Video saved: ${(videoBuffer.length / 1024).toFixed(2)} KB`);
    
    // Create SRT subtitle file
    console.log('📝 Creating subtitle file...');
    const srtContent = createSRTContent(subtitles);
    const srtPath = path.join(tempDir, `subtitles_${Date.now()}.srt`);
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    console.log('✅ SRT file created');
    
    // Default subtitle style
    const subtitleStyle = {
      font: style?.font || 'Arial',
      fontSize: style?.fontSize || 24,
      fontColor: style?.fontColor || 'white',
      backgroundColor: style?.backgroundColor || 'black@0.5',
      position: style?.position || 'bottom',
      outline: style?.outline || 2,
      ...style
    };
    
    // Create subtitle filter
    const subtitleFilter = createSubtitleFilter(srtPath, subtitleStyle);
    
    // Process video with subtitles
    const outputPath = path.join(tempDir, `subtitled_${Date.now()}.mp4`);
    
    console.log('🔄 Adding subtitles to video...');
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'copy', // Copy audio
          '-preset', 'fast',
          '-crf', '23',
          '-vf', subtitleFilter,
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 FFmpeg adding subtitles...');
          console.log('Subtitle filter:', subtitleFilter);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ Subtitle progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Subtitles added successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Subtitle error:', err.message);
          reject(err);
        })
        .run();
    });
    
    // Read result
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    [videoPath, srtPath, outputPath].forEach(file => {
      try { 
        if (fs.existsSync(file)) {
          fs.unlinkSync(file); 
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 Video with subtitles created`);
    console.log(`📦 Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully added ${subtitles.length} subtitle segments to video`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      subtitleCount: subtitles.length,
      style: subtitleStyle,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 Subtitle error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to create SRT content
function createSRTContent(subtitles) {
  return subtitles.map((subtitle, index) => {
    const startTime = formatSRTTime(subtitle.start);
    const endTime = formatSRTTime(subtitle.end);
    
    return `${index + 1}\n${startTime} --> ${endTime}\n${subtitle.text}\n`;
  }).join('\n');
}

// Helper function to format time for SRT
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

// Helper function to create subtitle filter
function createSubtitleFilter(srtPath, style) {
  // Escape the path for FFmpeg
  const escapedPath = srtPath.replace(/[\\:]/g, '\\$&').replace(/'/g, "\\'");
  
  // Create subtitle filter with styling
  let filter = `subtitles='${escapedPath}'`;
  
  // Add styling options
  filter += `:force_style='FontName=${style.font}`;
  filter += `,FontSize=${style.fontSize}`;
  filter += `,PrimaryColour=${convertColorToASS(style.fontColor)}`;
  filter += `,BackColour=${convertColorToASS(style.backgroundColor)}`;
  filter += `,Outline=${style.outline}`;
  filter += `,Alignment=${getAlignment(style.position)}'`;
  
  return filter;
}

// Helper function to convert color to ASS format
function convertColorToASS(color) {
  // Simple color conversion (you can expand this)
  const colors = {
    'white': '&Hffffff',
    'black': '&H000000',
    'red': '&H0000ff',
    'blue': '&Hff0000',
    'green': '&H00ff00',
    'yellow': '&H00ffff',
    'black@0.5': '&H80000000'
  };
  
  return colors[color] || '&Hffffff';
}

// Helper function to get alignment
function getAlignment(position) {
  const alignments = {
    'bottom': '2',
    'top': '8',
    'center': '5',
    'bottom-left': '1',
    'bottom-right': '3',
    'top-left': '7',
    'top-right': '9'
  };
  
  return alignments[position] || '2';
}

// ... (keep your existing endpoints)

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Video Sequencer API v2.8.0 running on port ${PORT}`);
  console.log(`📹 /api/sequence-videos - Multiple videos → One video`);
  console.log(`🎵 /api/add-audio - Single video + audio → Final video`);
  console.log(`📝 /api/add-subtitles - Video + subtitles → Final video`);
});
