// NeuroLens Extension Popup Script

class NeuroLensPopup {
  constructor() {
    this.currentTab = null;
    this.settings = {
      analysisInterval: 2000,
      confidenceThreshold: 0.7
    };
    
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.getCurrentTab();
    this.setupEventListeners();
    this.updateUI();
    this.checkStatus();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['neurolens_settings']);
      if (result.neurolens_settings) {
        this.settings = { ...this.settings, ...result.neurolens_settings };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.sync.set({ neurolens_settings: this.settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
    } catch (error) {
      console.error('Failed to get current tab:', error);
    }
  }

  setupEventListeners() {
    // Toggle overlay button
    document.getElementById('toggle-overlay').addEventListener('click', () => {
      this.toggleOverlay();
    });

    // Test connection button
    document.getElementById('test-connection').addEventListener('click', () => {
      this.testBackendConnection();
    });

    // Refresh page button
    document.getElementById('refresh-page').addEventListener('click', () => {
      this.refreshCurrentPage();
    });

    // Settings controls
    document.getElementById('analysis-interval').addEventListener('change', (e) => {
      this.settings.analysisInterval = parseInt(e.target.value);
      this.saveSettings();
      this.sendSettingsToContent();
    });

    document.getElementById('confidence-threshold').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.settings.confidenceThreshold = value;
      document.getElementById('confidence-value').textContent = Math.round(value * 100) + '%';
      this.saveSettings();
      this.sendSettingsToContent();
    });

    // Export settings
    document.getElementById('export-settings').addEventListener('click', () => {
      this.exportSettings();
    });
  }

  updateUI() {
    // Update settings UI
    document.getElementById('analysis-interval').value = this.settings.analysisInterval;
    document.getElementById('confidence-threshold').value = this.settings.confidenceThreshold;
    document.getElementById('confidence-value').textContent = 
      Math.round(this.settings.confidenceThreshold * 100) + '%';
  }

  async checkStatus() {
    // Check if on YouTube watch page
    const isYouTubeWatch = this.currentTab?.url?.includes('youtube.com/watch');
    
    const pageStatus = document.getElementById('page-status');
    if (isYouTubeWatch) {
      pageStatus.textContent = 'YouTube Video';
      pageStatus.className = 'status-value status-good';
    } else {
      pageStatus.textContent = 'Not YouTube';
      pageStatus.className = 'status-value status-warning';
      
      if (!isYouTubeWatch) {
        this.showMessage('Please navigate to a YouTube video to use NeuroLens', 'error');
        document.getElementById('toggle-overlay').disabled = true;
        return;
      }
    }

    // Check backend connection
    this.testBackendConnection(false);

    // Check if overlay is active
    try {
      const response = await chrome.tabs.sendMessage(this.currentTab.id, { action: 'checkOverlay' });
      const toggleBtn = document.getElementById('toggle-overlay');
      
      if (response?.overlayActive) {
        toggleBtn.innerHTML = '<span>🙈</span>Hide Overlay';
        toggleBtn.classList.remove('secondary');
      } else {
        toggleBtn.innerHTML = '<span>👁️</span>Show Overlay';
        toggleBtn.classList.add('secondary');
      }
    } catch (error) {
      // Content script not loaded or overlay not active
      document.getElementById('toggle-overlay').innerHTML = '<span>👁️</span>Show Overlay';
    }
  }

  async toggleOverlay() {
    if (!this.currentTab?.url?.includes('youtube.com/watch')) {
      this.showMessage('Please navigate to a YouTube video first', 'error');
      return;
    }

    try {
      await chrome.tabs.sendMessage(this.currentTab.id, { 
        action: 'toggleOverlay',
        settings: this.settings
      });
      
      this.showMessage('Overlay toggled successfully', 'success');
      setTimeout(() => this.checkStatus(), 500);
      
    } catch (error) {
      console.error('Failed to toggle overlay:', error);
      this.showMessage('Failed to communicate with page. Try refreshing.', 'error');
    }
  }

  async testBackendConnection(showResult = true) {
    const statusElement = document.getElementById('backend-status');
    statusElement.textContent = 'Testing...';
    statusElement.className = 'status-value';

    try {
      const response = await fetch('http://localhost:8000/', {
        method: 'GET',
        mode: 'cors',
        timeout: 5000
      });

      if (response.ok) {
        statusElement.textContent = 'Connected';
        statusElement.className = 'status-value status-good';
        
        if (showResult) {
          this.showMessage('Backend connection successful!', 'success');
        }
      } else {
        throw new Error('Server responded with error');
      }
    } catch (error) {
      statusElement.textContent = 'Disconnected';
      statusElement.className = 'status-value status-error';
      
      if (showResult) {
        this.showMessage('Backend connection failed. Make sure NeuroLens server is running on localhost:8000', 'error');
      }
    }
  }

  async refreshCurrentPage() {
    try {
      await chrome.tabs.reload(this.currentTab.id);
      this.showMessage('Page refreshed. NeuroLens will reload automatically.', 'success');
      setTimeout(() => window.close(), 1000);
    } catch (error) {
      this.showMessage('Failed to refresh page', 'error');
    }
  }

  async sendSettingsToContent() {
    try {
      await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'updateSettings',
        settings: this.settings
      });
    } catch (error) {
      console.error('Failed to send settings to content script:', error);
    }
  }

  exportSettings() {
    const exportData = {
      neurolens_settings: this.settings,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Create download link
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurolens-settings-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showMessage('Settings exported successfully!', 'success');
  }

  showMessage(text, type = 'info') {
    const messageArea = document.getElementById('message-area');
    
    // Clear existing messages
    messageArea.innerHTML = '';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = type;
    messageDiv.textContent = text;
    
    messageArea.appendChild(messageDiv);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      messageDiv.style.opacity = '0';
      messageDiv.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        if (messageDiv.parentNode) {
          messageDiv.parentNode.removeChild(messageDiv);
        }
      }, 300);
    }, 3000);
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new NeuroLensPopup();
});