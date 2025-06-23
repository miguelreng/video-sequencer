const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const fs = require('fs');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { videoUrls } = req.body;
    
    if (!videoUrls || !Array.isArray(videoUrls)) {
      return res.status(400).json({ error: 'videoUrls array is required' });
    }
    
    // Limit to 3 videos for free tier
    const limitedUrls = videoUrls.slice(0, 3);
    
    // Download videos to /tmp
    const localFiles = [];
    for (let i = 0; i < limitedUrls.length; i++) {
      const videoUrl = limitedUrls[i].mp4_url || limitedUrls[i];
      
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(`Failed to download video ${i + 1}`);
      }
      
      const buffer = await response.buffer();
      const filePath = `/tmp/video${i}.mp4`;
      fs.writeFileSync(filePath, buffer);
      localFiles.push(filePath);
    }
    
    // Create concat file
    const concatContent = localFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = '/tmp/concat.txt';
    fs.writeFileSync(concatPath, concatContent);
    
    // Run FFmpeg concatenation
    const outputPath = '/tmp/output.mp4';
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    // Read output and convert to base64
    const outputBuffer = fs.readFileSync(outputPath);
    const base64Video = outputBuffer.toString('base64');
    
    // Cleanup
    localFiles.forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });
    try { fs.unlinkSync(concatPath); } catch (e) {}
    try { fs.unlinkSync(outputPath); } catch (e) {}
    
    return res.json({
      success: true,
      message: `Successfully sequenced ${limitedUrls.length} videos`,
      videoData: `data:video/mp4;base64,${base64Video}`,
      size: outputBuffer.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
}
