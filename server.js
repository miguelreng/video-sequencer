// New endpoint to merge multiple videos
app.post('/api/merge-videos', async (req, res) => {
  const startTime = Date.now();
  console.log('🔗 Received video merge request');
  
  try {
    const { videoData } = req.body;
    
    if (!videoData || !Array.isArray(videoData)) {
      return res.status(400).json({
        success: false,
        error: 'videoData array is required'
      });
    }
    
    console.log(`🔗 Merging ${videoData.length} video segments`);
    
    const tempDir = '/tmp';
    const localFiles = [];
    
    // Save each base64 video to temp files
    for (let i = 0; i < videoData.length; i++) {
      const video = videoData[i];
      console.log(`💾 Saving video segment ${i + 1}`);
      
      // Remove base64 prefix if present
      let cleanBase64 = video;
      if (video.startsWith('data:video/mp4;base64,')) {
        cleanBase64 = video.replace('data:video/mp4;base64,', '');
      }
      
      const buffer = Buffer.from(cleanBase64, 'base64');
      const filePath = path.join(tempDir, `merge_segment${i}.mp4`);
      fs.writeFileSync(filePath, buffer);
      
      localFiles.push(filePath);
      console.log(`✅ Saved segment ${i + 1}, size: ${(buffer.length / 1024).toFixed(2)} KB`);
    }
    
    // Create concat file for FFmpeg
    const concatContent = localFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir, `merge_concat_${Date.now()}.txt`);
    fs.writeFileSync(concatPath, concatContent);
    
    console.log('🔗 Starting FFmpeg merge process...');
    
    // Merge with FFmpeg
    const outputPath = path.join(tempDir, `merged_output_${Date.now()}.mp4`);
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c', 'copy', // Fast copy mode
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🚀 FFmpeg merge started');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⚡ Merge progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ FFmpeg merge completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg merge error:', err.message);
          reject(new Error(`Merge failed: ${err.message}`));
        })
        .run();
      
      // Timeout for merge
      setTimeout(() => {
        reject(new Error('Merge timeout'));
      }, 120000); // 2 minute timeout
    });
    
    // Read merged output
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    const cleanupFiles = [...localFiles, concatPath, outputPath];
    cleanupFiles.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (e) {}
    });
    
    const totalTime = Date.now() - startTime;
    
    console.log(`🎉 Merge completed in ${totalTime}ms`);
    
    res.json({
      success: true,
      message: `Successfully merged ${videoData.length} video segments`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
      segmentsMerged: videoData.length,
      processingTimeMs: totalTime
    });
    
  } catch (error) {
    console.error('💥 Merge error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
