const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Initialize Express app FIRST
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Video Sequencer API is running!',
    version: '2.2.0 - With Merge Support',
    endpoints: {
      sequence: 'POST /api/sequence-videos',
      merge: 'POST /api/merge-videos',
      timeline: 'POST /api/sequence-videos (with tracks)'
    }
  });
});

// Your existing sequence endpoint (keep this unchanged)
app.post('/api/sequence-videos', async (req, res) => {
  // ... your existing sequence code here ...
});

// NEW: Merge videos endpoint
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
    
    // Create concat file
    const concatContent = localFiles.map(file => `file '${file}'`).join('\n');
    const concatPath = path.join(tempDir,
