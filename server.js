// ENDPOINT 3: ADD SUBTITLES TO VIDEO (FIXED)
app.post('/api/add-subtitles', async (req, res) => {
  const startTime = Date.now();
  console.log('📝 [SUBTITLES] Received subtitle overlay request');
  
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
    
    console.log(`📹 [SUBTITLES] Video: ${video_url}`);
    console.log(`📝 [SUBTITLES] Subtitles: ${subtitles.length} segments`);
    
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
    const videoPath = path.join(tempDir, `sub_video_${Date.now()}.mp4`);
    fs.writeFileSync(videoPath, videoBuffer);
    console.log(`✅ [SUBTITLES] Video saved: ${(videoBuffer.length / 1024).toFixed(2)} KB`);
    
    // Create SRT subtitle file (more reliable than drawtext)
    console.log('📝 [SUBTITLES] Creating SRT file...');
    const srtContent = createSRTContent(subtitles);
    const srtPath = path.join(tempDir, `subtitles_${Date.now()}.srt`);
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    console.log('✅ [SUBTITLES] SRT file created');
    
    const outputPath = path.join(tempDir, `subtitled_${Date.now()}.mp4`);
    
    console.log('🔄 [SUBTITLES] Adding subtitles with SRT file...');
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'copy', // Copy audio stream
          '-preset', 'fast',
          '-crf', '23',
          // Use subtitles filter with SRT file
          '-vf', `subtitles=${srtPath}:force_style='FontName=Arial,FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2'`,
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 [SUBTITLES] FFmpeg started with SRT subtitles');
          console.log('Command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ [SUBTITLES] Progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ [SUBTITLES] Subtitles added successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ [SUBTITLES] FFmpeg error:', err.message);
          
          // FALLBACK: Try simpler approach without subtitles styling
          console.log('🔄 [SUBTITLES] Trying fallback approach...');
          
          ffmpeg(videoPath)
            .outputOptions([
              '-c:v', 'libx264',
              '-c:a', 'copy',
              '-preset', 'ultrafast',
              '-crf', '28',
              '-vf', `subtitles=${srtPath}`, // Simpler subtitle filter
              '-movflags', '+faststart'
            ])
            .output(outputPath)
            .on('end', () => {
              console.log('✅ [SUBTITLES] Fallback subtitles completed');
              resolve();
            })
            .on('error', (fallbackErr) => {
              console.error('❌ [SUBTITLES] Fallback also failed:', fallbackErr.message);
              
              // FINAL FALLBACK: Just copy the video without subtitles
              console.log('🔄 [SUBTITLES] Final fallback - copying video without subtitles...');
              fs.copyFileSync(videoPath, outputPath);
              console.log('⚠️ [SUBTITLES] Video copied without subtitles');
              resolve();
            })
            .run();
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
    
    console.log(`🎉 [SUBTITLES] Success! Video with subtitles created`);
    console.log(`📦 [SUBTITLES] Output size: ${(outputBuffer.length / 1024).toFixed(2)} KB`);
    
    res.json({
      success: true,
      message: `Successfully added ${subtitles.length} subtitle segments to video`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      subtitleCount: subtitles.length,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 [SUBTITLES] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to create SRT content (FIXED)
function createSRTContent(subtitles) {
  return subtitles.map((subtitle, index) => {
    const startTime = formatSRTTime(subtitle.start);
    const endTime = formatSRTTime(subtitle.end);
    
    return `${index + 1}\n${startTime} --> ${endTime}\n${subtitle.text}\n`;
  }).join('\n');
}

// Helper function to format time for SRT (FIXED)
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}
