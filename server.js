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
    
    console.log(`📊 Processing ${timeline.length} video segmen
