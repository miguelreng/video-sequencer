app.post('/api/sequence-videos', async (req, res) => {
  try {
    const { videoUrls, tracks } = req.body;
    
    let timeline = [];
    
    if (tracks && tracks.length > 0) {
      // Use tracks format (your old request style)
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
    }
    
    console.log(`Processing ${timeline.length} video segments`);
    
    // Download videos with timeline
    const localFiles = [];
    for (let i = 0; i < timeline.length; i++) {
      const segment = timeline[i];
      console.log(`Downloading segment ${i + 1}: ${segment.url} (${segment.duration}s at ${segment.timestamp}s)`);
      
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
        
      } catch (downloadError) {
        console.error(`Failed to download segment ${i + 1}:`, downloadError.message);
      }
    }
    
    // Create FFmpeg filter for precise timing
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      
      // Add all inputs
      localFiles.forEach(file => {
        command.input(file.path);
      });
      
      // Create complex filter for timeline
      let filterComplex = '';
      let concatInputs = '';
      
      localFiles.forEach((file, index) => {
        // Trim each video to specified duration
        filterComplex += `[${index}:v]trim=duration=${file.duration},setpts=PTS-STARTPTS[v${index}];`;
        filterComplex += `[${index}:a]atrim=duration=${file.duration},asetpts=PTS-STARTPTS[a${index}];`;
        concatInputs += `[v${index}][a${index}]`;
      });
      
      // Concatenate all segments
      filterComplex += `${concatInputs}concat=n=${localFiles.length}:v=1:a=1[outv][outa]`;
      
      command
        .complexFilter(filterComplex)
        .outputOptions(['-map', '[outv]', '-map', '[outa]'])
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
      }, 180000); // 3 minute timeout for complex timeline
      
      command.run();
    });
    
    // Rest of your existing code...
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    const cleanupFiles = localFiles.map(f => f.path).concat([outputPath]);
    cleanupFiles.forEach(file => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError.message);
      }
    });
    
    res.json({
      success: true,
      message: `Successfully created timeline with ${timeline.length} segments`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length,
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
    console.error('Timeline processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
