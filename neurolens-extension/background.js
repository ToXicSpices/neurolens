// NeuroLens Extension Background Script (Service Worker)

class NeuroLensBackground {
  constructor() {
    this.setupListeners();
    console.log('NeuroLens background service worker initialized');
  }

  setupListeners() {
    // Handle extension installation
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstall(details);
    });

    // Handle tab updates (navigation)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // Handle messages from content scripts and popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    // Handle extension icon click
    chrome.action.onClicked.addListener((tab) => {
      this.handleIconClick(tab);
    });
  }

  handleInstall(details) {
    if (details.reason === 'install') {
      console.log('NeuroLens extension installed');
      
      // Set default settings
      chrome.storage.sync.set({
        neurolens_settings: {
          analysisInterval: 2000,
          confidenceThreshold: 0.7,
          autoStart: false,
          overlayPosition: { x: 20, y: 80 }
        }
      });

      // Open welcome page or instructions
      chrome.tabs.create({
        url: 'https://youtube.com'
      });
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    // Check if user navigated to/from YouTube
    if (changeInfo.status === 'complete') {
      if (tab.url && tab.url.includes('youtube.com/watch')) {
        // Update extension icon to show it's active
        chrome.action.setIcon({
          tabId: tabId,
          path: {
            16: 'icons/icon16.png',
            48: 'icons/icon48.png',
            128: 'icons/icon128.png'
          }
        });

        chrome.action.setTitle({
          tabId: tabId,
          title: 'NeuroLens - Click to analyze emotions'
        });

        // Inject content script if not already present
        this.ensureContentScript(tabId);
      } else {
        // Update icon to show it's inactive
        chrome.action.setIcon({
          tabId: tabId,
          path: {
            16: 'icons/icon16.png',
            48: 'icons/icon48.png', 
            128: 'icons/icon128.png'
          }
        });

        chrome.action.setTitle({
          tabId: tabId,
          title: 'NeuroLens - Navigate to YouTube to use'
        });
      }
    }
  }

  async ensureContentScript(tabId) {
    try {
      // Test if content script is already injected
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
      // Content script not present, inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['socket.io.min.js', 'content.js']
        });

        await chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ['overlay.css']
        });

        console.log('Content script injected successfully');
      } catch (injectError) {
        console.error('Failed to inject content script:', injectError);
      }
    }
  }

  async handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'checkBackendConnection':
        try {
          const response = await fetch('http://localhost:8000/');
          sendResponse({ connected: response.ok });
        } catch (error) {
          sendResponse({ connected: false, error: error.message });
        }
        break;

      case 'getSettings':
        try {
          const result = await chrome.storage.sync.get(['neurolens_settings']);
          sendResponse({ settings: result.neurolens_settings });
        } catch (error) {
          sendResponse({ error: error.message });
        }
        break;

      case 'saveSettings':
        try {
          await chrome.storage.sync.set({ neurolens_settings: request.settings });
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ error: error.message });
        }
        break;

      case 'exportData':
        this.handleExportData(request.data, sendResponse);
        break;

      case 'logEvent':
        console.log('NeuroLens Event:', request.event, request.data);
        sendResponse({ logged: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  }

  handleIconClick(tab) {
    // Open popup (this is handled automatically by manifest)
    // But we can log the interaction
    console.log('NeuroLens icon clicked on:', tab.url);
  }

  async handleExportData(data, sendResponse) {
    try {
      // Store export data temporarily
      const exportId = Date.now().toString();
      await chrome.storage.local.set({
        [`export_${exportId}`]: data
      });

      // Create download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      await chrome.downloads.download({
        url: url,
        filename: `neurolens-export-${exportId}.json`,
        saveAs: true
      });

      // Clean up temporary storage after download
      setTimeout(() => {
        chrome.storage.local.remove(`export_${exportId}`);
      }, 5000);

      sendResponse({ success: true, exportId });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }
}

// Initialize background service
new NeuroLensBackground();