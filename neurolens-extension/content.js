// NeuroLens YouTube Content Script
// Injected into YouTube watch pages to provide emotion analysis overlay

class NeuroLensYouTubeOverlay {
  constructor() {
    this.isAnalyzing = false;
    this.emotionData = [];
    this.currentEmotions = {};
    this.dominantEmotion = 'neutral';
    this.socket = null;
    this.videoElement = null;
    this.overlayElement = null;
    this.webcamStream = null;
    this.analysisInterval = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.isMinimized = false;
    this.lastVideoTime = 0;
    this.connectionStatus = 'disconnected';

    // Emotion configuration
    this.EMOTION_COLORS = {
      joy: '#22c55e',
      surprise: '#f59e0b',
      anger: '#ef4444',
      sadness: '#3b82f6',
      neutral: '#6b7280'
    };

    this.EMOTION_EMOJIS = {
      joy: '😊',
      surprise: '😲',
      anger: '😠',
      sadness: '😢',
      neutral: '😐'
    };

    this.init();
  }

  
  async init() {
    // Wait for YouTube to load
    await this.waitForElements();
    
    // Create and inject overlay
    this.createOverlay();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Connect to backend
    await this.connectToBackend();
    
    console.log('NeuroLens overlay initialized');
  } 

  
  waitForElements() {
    return new Promise((resolve) => {
      const checkElements = () => {
        const video = document.querySelector('video');
        const playerContainer = document.querySelector('#movie_player');
        
        if (video && video.src && playerContainer) {
          this.videoElement = video;
          resolve();
        } else {
          setTimeout(checkElements, 500);
        }
      };
      checkElements();
    });
  }

  createOverlay() {
    // Remove existing overlay
    const existing = document.getElementById('neurolens-overlay');
    if (existing) existing.remove();

    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'neurolens-overlay';
    this.overlayElement.innerHTML = `
      <div class="nl-header" id="nl-drag-handle">
        <div class="nl-logo">
          <span class="logo-icon">🧠</span>
          NeuroLens
        </div>
        <div class="nl-controls">
          <button id="nl-minimize-btn" class="nl-btn" title="Minimize">📊</button>
          <button id="nl-settings-btn" class="nl-btn" title="Settings">⚙️</button>
          <button id="nl-close-btn" class="nl-btn danger" title="Close">✕</button>
        </div>
      </div>
      
      <div class="nl-content" id="nl-content">
        <div class="nl-status">
          <div class="nl-status-item">
            <div class="nl-status-label">Status</div>
            <div class="status-indicator stopped" id="nl-status-indicator">
              <span class="status-dot"></span>
              <span id="nl-status-text">Stopped</span>
            </div>
          </div>
          <div class="nl-status-item">
            <div class="nl-status-label">Connection</div>
            <div class="nl-status-value" id="nl-connection-status">Connecting...</div>
          </div>
        </div>

        <div class="nl-current-emotion" id="nl-current-emotion">
          <div class="emotion-emoji" id="nl-emotion-emoji">😐</div>
          <div class="emotion-info">
            <div class="emotion-name" id="nl-emotion-name">neutral</div>
            <div class="emotion-confidence" id="nl-emotion-confidence">0% confidence</div>
            <div class="confidence-bar">
              <div class="confidence-fill" id="nl-confidence-fill" style="width: 0%"></div>
            </div>
          </div>
        </div>

        <div class="nl-emotion-grid" id="nl-emotion-grid">
          <!-- Emotion mini cards will be populated here -->
        </div>

        <div class="nl-timeline">
          <div class="nl-timeline-header">
            <div class="nl-timeline-title">Emotion Timeline</div>
            <div class="nl-timeline-time" id="nl-timeline-time">Last 60s</div>
          </div>
          <div class="timeline-container">
            <canvas id="nl-emotion-graph" width="300" height="100"></canvas>
          </div>
        </div>

        <div class="nl-video-sync" id="nl-video-sync">
          <div class="nl-sync-info">
            <div class="nl-video-time" id="nl-video-time">0:00</div>
            <div class="nl-video-title" id="nl-video-title">Loading...</div>
          </div>
          <div class="nl-sync-status sync-paused" id="nl-sync-status">⏸️ Paused</div>
        </div>

        <div class="nl-actions">
          <button class="nl-action-btn" id="nl-start-analysis">
            <span>🎬</span>
            Start Analysis
          </button>
          <button class="nl-action-btn secondary" id="nl-export-data">
            <span>💾</span>
            Export
          </button>
        </div>

        <div class="nl-permission-prompt" id="nl-permission-prompt" style="display: none;">
          <span class="nl-permission-icon">📹</span>
          <div class="nl-permission-text">NeuroLens needs camera access to analyze your emotions</div>
          <button class="nl-grant-permission" id="nl-grant-permission">Grant Permission</button>
        </div>

        <div class="nl-error" id="nl-error" style="display: none;">
          <span class="nl-error-icon">⚠️</span>
          <span id="nl-error-text"></span>
        </div>

        <div class="nl-loading" id="nl-loading" style="display: none;">
          <div class="nl-spinner"></div>
          <span>Initializing...</span>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlayElement);
    this.populateEmotionGrid();
    this.updateVideoInfo();
  }

  populateEmotionGrid() {
    const grid = document.getElementById('nl-emotion-grid');
    const emotions = Object.keys(this.EMOTION_COLORS);
    
    grid.innerHTML = emotions.map(emotion => `
      <div class="emotion-mini-card" data-emotion="${emotion}" style="--emotion-color: ${this.EMOTION_COLORS[emotion]}; --emotion-intensity: 0%">
        <div class="emotion-mini-emoji">${this.EMOTION_EMOJIS[emotion]}</div>
        <div class="emotion-mini-info">
          <div class="emotion-mini-name">${emotion}</div>
          <div class="emotion-mini-value" id="emotion-${emotion}">0%</div>
        </div>
      </div>
    `).join('');
  }

  setupEventListeners() {
    // Dragging functionality
    const dragHandle = document.getElementById('nl-drag-handle');
    dragHandle.addEventListener('mousedown', this.handleDragStart.bind(this));
    document.addEventListener('mousemove', this.handleDragMove.bind(this));
    document.addEventListener('mouseup', this.handleDragEnd.bind(this));

    // Control buttons
    document.getElementById('nl-minimize-btn').addEventListener('click', this.toggleMinimize.bind(this));
    document.getElementById('nl-close-btn').addEventListener('click', this.closeOverlay.bind(this));
    document.getElementById('nl-start-analysis').addEventListener('click', this.toggleAnalysis.bind(this));
    document.getElementById('nl-export-data').addEventListener('click', this.exportData.bind(this));
    document.getElementById('nl-grant-permission').addEventListener('click', this.requestWebcamPermission.bind(this));

    // Video events
    if (this.videoElement) {
      this.videoElement.addEventListener('timeupdate', this.handleVideoTimeUpdate.bind(this));
      this.videoElement.addEventListener('play', this.handleVideoPlay.bind(this));
      this.videoElement.addEventListener('pause', this.handleVideoPause.bind(this));
    }

    // URL change detection for SPA navigation
    let currentUrl = window.location.href;
    new MutationObserver(() => {
      if (currentUrl !== window.location.href) {
        currentUrl = window.location.href;
        setTimeout(() => {
          this.handleUrlChange();
        }, 1000);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  handleDragStart(e) {
    this.isDragging = true;
    const rect = this.overlayElement.getBoundingClientRect();
    this.dragOffset.x = e.clientX - rect.left;
    this.dragOffset.y = e.clientY - rect.top;
    this.overlayElement.classList.add('dragging');
  }

  handleDragMove(e) {
    if (!this.isDragging) return;
    
    const x = e.clientX - this.dragOffset.x;
    const y = e.clientY - this.dragOffset.y;
    
    // Keep overlay within viewport bounds
    const maxX = window.innerWidth - this.overlayElement.offsetWidth;
    const maxY = window.innerHeight - this.overlayElement.offsetHeight;
    
    const boundedX = Math.max(0, Math.min(x, maxX));
    const boundedY = Math.max(0, Math.min(y, maxY));
    
    this.overlayElement.style.left = boundedX + 'px';
    this.overlayElement.style.top = boundedY + 'px';
    this.overlayElement.style.right = 'auto';
  }

  handleDragEnd() {
    this.isDragging = false;
    this.overlayElement.classList.remove('dragging');
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    this.overlayElement.classList.toggle('minimized', this.isMinimized);
    
    const btn = document.getElementById('nl-minimize-btn');
    btn.textContent = this.isMinimized ? '📈' : '📊';
  }

  closeOverlay() {
    this.cleanup();
    this.overlayElement.remove();
  }

  async connectToBackend() {
    try {
      this.showLoading('Connecting to backend...');
      
      // Import Socket.IO from the injected script
      if (typeof io === 'undefined') {
        throw new Error('Socket.IO not loaded');
      }

      this.socket = io('http://localhost:8000', {
        transports: ['websocket', 'polling'],
        timeout: 5000
      });

      this.socket.on('connect', () => {
        this.connectionStatus = 'connected';
        this.updateConnectionStatus('Connected', 'good');
        this.hideLoading();
        console.log('Connected to NeuroLens backend');
      });

      this.socket.on('disconnect', () => {
        this.connectionStatus = 'disconnected';
        this.updateConnectionStatus('Disconnected', 'error');
        this.showError('Lost connection to backend');
      });

      this.socket.on('emotion', (data) => {
        this.handleEmotionData(data);
      });

      this.socket.on('connect_error', (error) => {
        this.connectionStatus = 'error';
        this.updateConnectionStatus('Error', 'error');
        this.hideLoading();
        this.showError('Backend connection failed. Make sure NeuroLens server is running.');
      });

    } catch (error) {
      console.error('Backend connection error:', error);
      this.hideLoading();
      this.showError('Failed to connect to backend: ' + error.message);
    }
  }

  async requestWebcamPermission() {
    try {
      this.showLoading('Requesting camera access...');
      
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        }
      });

      this.hideError();
      this.hidePermissionPrompt();
      this.hideLoading();
      
      document.getElementById('nl-start-analysis').disabled = false;
      console.log('Webcam access granted');
      
    } catch (error) {
      this.hideLoading();
      
      if (error.name === 'NotAllowedError') {
        this.showError('Camera permission denied. Please allow camera access and try again.');
      } else if (error.name === 'NotFoundError') {
        this.showError('No camera found. Please connect a camera and try again.');
      } else {
        this.showError('Camera error: ' + error.message);
      }
      
      this.showPermissionPrompt();
    }
  }

  async toggleAnalysis() {
    if (this.isAnalyzing) {
      this.stopAnalysis();
    } else {
      await this.startAnalysis();
    }
  }

  async startAnalysis() {
    if (!this.webcamStream) {
      this.showPermissionPrompt();
      return;
    }

    if (this.connectionStatus !== 'connected') {
      this.showError('Not connected to backend. Please check connection.');
      return;
    }

    this.isAnalyzing = true;
    this.updateAnalysisStatus(true);
    
    // Create video element for frame capture
    const video = document.createElement('video');
    video.srcObject = this.webcamStream;
    video.play();

    // Start frame capture interval
    this.analysisInterval = setInterval(() => {
      if (!this.isAnalyzing || !video.videoWidth) return;
      
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const frameData = canvas.toDataURL('image/jpeg', 0.7);
      const videoTime = this.videoElement ? this.videoElement.currentTime : 0;
      
      if (this.socket && this.socket.connected) {
        this.socket.emit('frame', {
          img: frameData,
          timestamp: Date.now(),
          videoTime: videoTime
        });
      }
    }, 2000);

    console.log('Emotion analysis started');
  }

  stopAnalysis() {
    this.isAnalyzing = false;
    this.updateAnalysisStatus(false);
    
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }

    console.log('Emotion analysis stopped');
  }

  handleEmotionData(data) {
    if (!this.isAnalyzing) return;

    const videoTime = this.videoElement ? this.videoElement.currentTime : 0;
    
    // Store emotion data with video timestamp
    const emotionEntry = {
      ...data,
      videoTime: videoTime,
      timestamp: Date.now()
    };
    
    this.emotionData.push(emotionEntry);
    
    // Keep only last 300 entries (10 minutes at 2s intervals)
    if (this.emotionData.length > 300) {
      this.emotionData = this.emotionData.slice(-300);
    }
    
    // Update current emotions
    this.currentEmotions = data.emotions;
    
    // Find dominant emotion
    const dominantEntry = Object.entries(data.emotions)
      .reduce((max, current) => data.emotions[current[0]] > data.emotions[max[0]] ? current : max);
    
    this.dominantEmotion = dominantEntry[0];
    
    // Update UI
    this.updateEmotionDisplay(dominantEntry[0], dominantEntry[1]);
    this.updateEmotionGrid();
    this.updateEmotionGraph();
  }

  updateEmotionDisplay(emotion, confidence) {
    document.getElementById('nl-emotion-emoji').textContent = this.EMOTION_EMOJIS[emotion];
    document.getElementById('nl-emotion-name').textContent = emotion;
    document.getElementById('nl-emotion-confidence').textContent = `${Math.round(confidence * 100)}% confidence`;
    document.getElementById('nl-confidence-fill').style.width = `${confidence * 100}%`;
    
    // Trigger animation
    const emojiElement = document.getElementById('nl-emotion-emoji');
    emojiElement.style.animation = 'none';
    setTimeout(() => {
      emojiElement.style.animation = 'emotionPulse 0.5s ease-in-out';
    }, 10);
  }

  updateEmotionGrid() {
    Object.entries(this.currentEmotions).forEach(([emotion, value]) => {
      const card = document.querySelector(`[data-emotion="${emotion}"]`);
      const valueElement = document.getElementById(`emotion-${emotion}`);
      
      if (card && valueElement) {
        const percentage = Math.round(value * 100);
        valueElement.textContent = `${percentage}%`;
        card.style.setProperty('--emotion-intensity', `${percentage}%`);
        
        // Highlight dominant emotion
        card.classList.toggle('dominant', emotion === this.dominantEmotion);
        
        // Add update animation
        card.classList.add('updated');
        setTimeout(() => card.classList.remove('updated'), 500);
      }
    });
  }

  updateEmotionGraph() {
    const canvas = document.getElementById('nl-emotion-graph');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Get recent data (last 30 points = 1 minute)
    const recentData = this.emotionData.slice(-30);
    if (recentData.length < 2) return;

    const width = rect.width;
    const height = rect.height;

    // Draw grid
    ctx.strokeStyle = 'rgba(75, 85, 99, 0.2)';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = (i * height) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw emotion lines
    Object.entries(this.EMOTION_COLORS).forEach(([emotion, color]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      recentData.forEach((entry, index) => {
        const x = (index / (recentData.length - 1)) * width;
        const y = height - (entry.emotions[emotion] || 0) * height;
        
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    });

    // Draw current time indicator
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width - 1, 0);
    ctx.lineTo(width - 1, height);
    ctx.stroke();
  }

  handleVideoTimeUpdate() {
    if (!this.videoElement) return;
    
    const currentTime = this.videoElement.currentTime;
    const duration = this.videoElement.duration;
    
    const timeString = this.formatTime(currentTime);
    const durationString = this.formatTime(duration);
    
    document.getElementById('nl-video-time').textContent = `${timeString} / ${durationString}`;
    
    // Update sync status
    const syncStatus = document.getElementById('nl-sync-status');
    if (this.isAnalyzing) {
      syncStatus.className = 'nl-sync-status sync-live';
      syncStatus.innerHTML = '🔴 Live';
    }
  }

  handleVideoPlay() {
    document.getElementById('nl-sync-status').className = 'nl-sync-status sync-live';
    document.getElementById('nl-sync-status').innerHTML = '▶️ Playing';
  }

  handleVideoPause() {
    document.getElementById('nl-sync-status').className = 'nl-sync-status sync-paused';
    document.getElementById('nl-sync-status').innerHTML = '⏸️ Paused';
  }

  updateVideoInfo() {
    // Get video title
    const titleElement = document.querySelector('h1.title yt-formatted-string') || 
                        document.querySelector('h1[class*="title"]') ||
                        document.querySelector('.ytd-video-primary-info-renderer h1');
    
    if (titleElement) {
      const title = titleElement.textContent || 'Unknown Video';
      document.getElementById('nl-video-title').textContent = title.substring(0, 30) + (title.length > 30 ? '...' : '');
    }
  }

  handleUrlChange() {
    // Reset data for new video
    this.emotionData = [];
    this.currentEmotions = {};
    this.stopAnalysis();
    this.updateVideoInfo();
    
    // Wait for new video element
    setTimeout(() => {
      this.videoElement = document.querySelector('video');
      if (this.videoElement) {
        this.setupVideoEventListeners();
      }
    }, 1000);
  }

  setupVideoEventListeners() {
    if (!this.videoElement) return;
    
    this.videoElement.addEventListener('timeupdate', this.handleVideoTimeUpdate.bind(this));
    this.videoElement.addEventListener('play', this.handleVideoPlay.bind(this));
    this.videoElement.addEventListener('pause', this.handleVideoPause.bind(this));
  }

  exportData() {
    const videoTitle = document.getElementById('nl-video-title').textContent || 'Unknown Video';
    const videoUrl = window.location.href;
    
    const exportData = {
      video: {
        title: videoTitle,
        url: videoUrl,
        timestamp: new Date().toISOString()
      },
      emotions: this.emotionData,
      summary: {
        totalDataPoints: this.emotionData.length,
        duration: this.emotionData.length * 2, // seconds
        dominantEmotion: this.dominantEmotion,
        averageEmotions: this.calculateAverageEmotions(),
        peaks: this.findEmotionPeaks()
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurolens-${videoTitle.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Emotion data exported');
  }

  calculateAverageEmotions() {
    if (this.emotionData.length === 0) return {};
    
    const emotions = Object.keys(this.EMOTION_COLORS);
    const averages = {};
    
    emotions.forEach(emotion => {
      const sum = this.emotionData.reduce((acc, entry) => 
        acc + (entry.emotions[emotion] || 0), 0);
      averages[emotion] = sum / this.emotionData.length;
    });
    
    return averages;
  }

  findEmotionPeaks() {
    const peaks = [];
    const threshold = 0.7;
    
    this.emotionData.forEach(entry => {
      Object.entries(entry.emotions).forEach(([emotion, intensity]) => {
        if (intensity > threshold) {
          peaks.push({
            emotion,
            intensity,
            videoTime: entry.videoTime,
            timestamp: entry.timestamp
          });
        }
      });
    });
    
    return peaks;
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  // UI Helper Methods
  updateAnalysisStatus(isAnalyzing) {
    const indicator = document.getElementById('nl-status-indicator');
    const text = document.getElementById('nl-status-text');
    const button = document.getElementById('nl-start-analysis');
    
    if (isAnalyzing) {
      indicator.className = 'status-indicator analyzing';
      text.textContent = 'Analyzing';
      button.innerHTML = '<span>⏸️</span>Stop Analysis';
    } else {
      indicator.className = 'status-indicator stopped';
      text.textContent = 'Stopped';
      button.innerHTML = '<span>🎬</span>Start Analysis';
    }
  }

  updateConnectionStatus(status, type) {
    const element = document.getElementById('nl-connection-status');
    element.textContent = status;
    element.className = `nl-status-value ${type}`;
  }

  showError(message) {
    const errorElement = document.getElementById('nl-error');
    const textElement = document.getElementById('nl-error-text');
    textElement.textContent = message;
    errorElement.style.display = 'block';
  }

  hideError() {
    document.getElementById('nl-error').style.display = 'none';
  }

  showPermissionPrompt() {
    document.getElementById('nl-permission-prompt').style.display = 'block';
  }

  hidePermissionPrompt() {
    document.getElementById('nl-permission-prompt').style.display = 'none';
  }

  showLoading(message) {
    const loadingElement = document.getElementById('nl-loading');
    loadingElement.querySelector('span').textContent = message;
    loadingElement.style.display = 'flex';
  }

  hideLoading() {
    document.getElementById('nl-loading').style.display = 'none';
  }

  cleanup() {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }
    
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(track => track.stop());
    }
    
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Initialize when page loads
function initNeuroLens() {
  // Check if we're on a YouTube watch page
  if (window.location.pathname === '/watch') {
    // Wait a bit for YouTube to fully load
    setTimeout(() => {
      new NeuroLensYouTubeOverlay();
    }, 2000);
  }
}

// Start initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNeuroLens);
} else {
  initNeuroLens();
}