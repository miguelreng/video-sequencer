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
    version: '2.3.0 - High Compression Mode',
    endpoints: {
      sequence: 'POST /api/sequence-videos'
    },
    optimizations: [
      'Heavy compression for smaller output',
      'Reduced resolution for faster processing',
      'Optimized codec settings',
      'Memory usage optimization'
    ]
  });
});

// Main video sequencing endpoint with heavy compression
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
        timestamp: index * 3, // Reduced to 3 seconds each
        duration: 3
      }));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either videoUrls
