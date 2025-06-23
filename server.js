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
