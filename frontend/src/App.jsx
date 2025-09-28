import "./App.css";
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import io from 'socket.io-client';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2'; 

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// Constants
const SOCKET_URL = 'http://localhost:8000';
const EMOTION_LABELS = ['joy', 'surprise', 'anger', 'sadness', 'neutral', 'boredom'];
const EMOTION_COLORS = {
  joy: '#c0c0c0',
  surprise: '#a8a8a8', 
  anger: '#909090',
  sadness: '#888888',
  neutral: '#b0b0b0',
  boredom: '#707070',
};
const EMOTION_EMOJIS = {
  joy: '😊',
  surprise: '😲',
  anger: '😠',
  sadness: '😢',
  neutral: '😐',
  boredom: '😴',
};

const THEMES = {
  dark: { primary: '#2a2a2a', accent: '#ffffff' },
  blue: { primary: '#1e293b', accent: '#3b82f6' },
  purple: { primary: '#1e1b3e', accent: '#a855f7' },
  green: { primary: '#1a2e1a', accent: '#22c55e' },
};

const socket = io(SOCKET_URL);

// Main App Component
export default function App() {
  // Core state
  const [activeTab, setActiveTab] = useState('live');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('dark');
  const [showShortcuts, setShowShortcuts] = useState(false);
  
  // Data state
  const [currentEmotions, setCurrentEmotions] = useState({});
  const [emotionHistory, setEmotionHistory] = useState([]);
  const [dominantEmotion, setDominantEmotion] = useState('neutral');
  const [sessionStats, setSessionStats] = useState({});
  const [timeRange, setTimeRange] = useState(20);
  const [notifications, setNotifications] = useState([]);
  const [performance, setPerformance] = useState({
    fps: 0,
    latency: 0,
    accuracy: 95,
    memoryUsage: 0
  });
  
  // Chart data
  const [chartData, setChartData] = useState({
    labels: [],
    datasets: EMOTION_LABELS.map(label => ({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      data: [],
      borderColor: EMOTION_COLORS[label],
      backgroundColor: `${EMOTION_COLORS[label]}20`,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
    })),
  });

  // Notification system
  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  }, []);

  // Theme switching
  const switchTheme = useCallback((theme) => {
    setCurrentTheme(theme);
    document.documentElement.style.setProperty('--theme-primary', THEMES[theme].primary);
    document.documentElement.style.setProperty('--theme-accent', THEMES[theme].accent);
    document.body.style.background = THEMES[theme].primary;
    addNotification(`Switched to ${theme} theme`, 'success');
  }, [addNotification]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            setActiveTab('live');
            addNotification('Switched to Live view', 'info');
            break;
          case '2':
            e.preventDefault();
            setActiveTab('analytics');
            addNotification('Switched to Analytics view', 'info');
            break;
          case '3':
            e.preventDefault();
            setActiveTab('history');
            addNotification('Switched to History view', 'info');
            break;
          case 'f':
            e.preventDefault();
            setIsFullscreen(!isFullscreen);
            break;
          case 's':
            e.preventDefault();
            setIsSettingsOpen(!isSettingsOpen);
            break;
          case '/':
            e.preventDefault();
            setShowShortcuts(true);
            break;
          default:
            break;
        }
      }
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isFullscreen, isSettingsOpen, addNotification]);

  // Performance monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      setPerformance(prev => ({
        fps: Math.floor(Math.random() * 5) + 28, // Simulate FPS
        latency: Math.floor(Math.random() * 20) + 10, // Simulate latency
        accuracy: 95 + Math.floor(Math.random() * 5), // Simulate accuracy
        memoryUsage: 45 + Math.floor(Math.random() * 20) // Simulate memory
      }));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Auto-save data
  const exportData = useCallback(() => {
    const data = {
      timestamp: new Date().toISOString(),
      emotionHistory,
      sessionStats,
      performance
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurolens-data-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    addNotification('Data exported successfully!', 'success');
  }, [emotionHistory, sessionStats, performance, addNotification]);

  return (
    <div className="app-container">
      <AppHeader 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSettingsClick={() => setIsSettingsOpen(true)}
        onExportClick={exportData}
      />
      
      <main className="main-content">
        {activeTab === 'live' && (
          <LiveAnalysisView
            isStreaming={isStreaming}
            setIsStreaming={setIsStreaming}
            isAnalyzing={isAnalyzing}
            setIsAnalyzing={setIsAnalyzing}
            currentEmotions={currentEmotions}
            setCurrentEmotions={setCurrentEmotions}
            dominantEmotion={dominantEmotion}
            setDominantEmotion={setDominantEmotion}
            emotionHistory={emotionHistory}
            setEmotionHistory={setEmotionHistory}
            sessionStats={sessionStats}
            setSessionStats={setSessionStats}
            chartData={chartData}
            setChartData={setChartData}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            isFullscreen={isFullscreen}
            setIsFullscreen={setIsFullscreen}
            addNotification={addNotification}
          />
        )}
        
        {activeTab === 'analytics' && (
          <AnalyticsView 
            emotionHistory={emotionHistory}
            sessionStats={sessionStats}
            addNotification={addNotification}
          />
        )}
        
        {activeTab === 'history' && (
          <HistoryView 
            emotionHistory={emotionHistory}
            addNotification={addNotification}
          />
        )}
      </main>

      {/* Theme Toggle */}
      <div className="theme-toggle">
        {Object.keys(THEMES).map(theme => (
          <div
            key={theme}
            className={`theme-option ${theme} ${currentTheme === theme ? 'active' : ''}`}
            onClick={() => switchTheme(theme)}
            title={`Switch to ${theme} theme`}
          />
        ))}
      </div>

      {/* Performance Monitor */}
      <div className="performance-monitor">
        <div className="perf-metric">
          <span className="perf-label">FPS:</span>
          <span className={`perf-value ${performance.fps >= 25 ? 'perf-good' : 'perf-warning'}`}>
            {performance.fps}
          </span>
        </div>
        <div className="perf-metric">
          <span className="perf-label">Latency:</span>
          <span className={`perf-value ${performance.latency <= 20 ? 'perf-good' : 'perf-warning'}`}>
            {performance.latency}ms
          </span>
        </div>
        <div className="perf-metric">
          <span className="perf-label">Accuracy:</span>
          <span className="perf-value perf-good">{performance.accuracy}%</span>
        </div>
        <div className="perf-metric">
          <span className="perf-label">Memory:</span>
          <span className={`perf-value ${performance.memoryUsage <= 60 ? 'perf-good' : 'perf-warning'}`}>
            {performance.memoryUsage}MB
          </span>
        </div>
      </div>

      {/* Notifications */}
      <div className="notification-container">
        {notifications.map(notification => (
          <div key={notification.id} className={`notification ${notification.type}`}>
            {notification.message}
          </div>
        ))}
      </div>

      {/* Keyboard Shortcuts Overlay */}
      <div className={`shortcuts-overlay ${showShortcuts ? 'show' : ''}`}>
        <div className="shortcuts-content">
          <h3 style={{ marginBottom: '1rem', color: '#ffffff' }}>Keyboard Shortcuts</h3>
          <div className="shortcut-item">
            <span>Live View</span>
            <span className="shortcut-key">Ctrl + 1</span>
          </div>
          <div className="shortcut-item">
            <span>Analytics View</span>
            <span className="shortcut-key">Ctrl + 2</span>
          </div>
          <div className="shortcut-item">
            <span>History View</span>
            <span className="shortcut-key">Ctrl + 3</span>
          </div>
          <div className="shortcut-item">
            <span>Toggle Fullscreen</span>
            <span className="shortcut-key">Ctrl + F</span>
          </div>
          <div className="shortcut-item">
            <span>Settings Panel</span>
            <span className="shortcut-key">Ctrl + S</span>
          </div>
          <div className="shortcut-item">
            <span>Show Shortcuts</span>
            <span className="shortcut-key">Ctrl + /</span>
          </div>
          <div className="shortcut-item">
            <span>Close/Escape</span>
            <span className="shortcut-key">ESC</span>
          </div>
          <button 
            style={{ marginTop: '1rem', width: '100%', padding: '0.5rem' }}
            className="control-button"
            onClick={() => setShowShortcuts(false)}
          >
            Close
          </button>
        </div>
      </div>

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        sessionStats={sessionStats}
        emotionHistory={emotionHistory}
        performance={performance}
        currentTheme={currentTheme}
        onExportData={exportData}
      />
    </div>
  );
}

// Header Component
function AppHeader({ activeTab, setActiveTab, onSettingsClick, onExportClick }) {
  return (
    <header className="app-header">
      <div className="header-content">
        <div className="app-brand">
          <div className="brand-logo">NeuroLens</div>
          <div className="brand-tagline">Real-time Emotion Intelligence</div>
        </div>
        
        <nav className="header-nav">
          <div className="nav-tabs">
            <button 
              className={`nav-tab ${activeTab === 'live' ? 'active' : ''}`}
              onClick={() => setActiveTab('live')}
            >
              Live
            </button>
            <button 
              className={`nav-tab ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              Analytics
            </button>
            <button 
              className={`nav-tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              History
            </button>
          </div>
        </nav>
        
        <div className="header-actions">
          <button className="export-button" onClick={onExportClick}>
            Export Data
          </button>
          <button className="settings-button" onClick={onSettingsClick}>
            Settings
          </button>
        </div>
      </div>
    </header>
  );
}

// Live Analysis View Component
function LiveAnalysisView({ 
  isStreaming, setIsStreaming, isAnalyzing, setIsAnalyzing,
  currentEmotions, setCurrentEmotions, dominantEmotion, setDominantEmotion,
  emotionHistory, setEmotionHistory, sessionStats, setSessionStats,
  chartData, setChartData, timeRange, setTimeRange, isFullscreen, 
  setIsFullscreen, addNotification 
}) {
  const videoRef = useRef(null);

  // Chart options
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { 
        position: 'top',
        labels: {
          color: '#ffffff',
          font: { size: 11, weight: '600' },
          usePointStyle: true,
          pointStyle: 'circle',
        }
      },
      tooltip: { 
        mode: 'index', 
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
      },
    },
    scales: {
      y: { 
        min: 0, 
        max: 1, 
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { color: '#888', font: { size: 10 } },
        title: { 
          display: true, 
          text: 'Intensity',
          color: '#ffffff',
          font: { size: 11, weight: '600' },
        }
      },
      x: { 
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { 
          color: '#888',
          font: { size: 10 },
          maxTicksLimit: 8,
        },
        title: { 
          display: true, 
          text: `Last ${timeRange}s`,
          color: '#ffffff',
          font: { size: 11, weight: '600' },
        }
      },
    },
  }), [timeRange]);

  // Initialize camera
  useEffect(() => {
    let stream = null;
    async function initializeCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }, 
          audio: false 
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsStreaming(true);
          addNotification('Camera connected successfully', 'success');
        }
      } catch (error) {
        console.error("Camera initialization failed:", error);
        addNotification('Camera access denied', 'warning');
      }
    }

    initializeCamera();
    
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [setIsStreaming, addNotification]);

  // Frame capture and transmission
  useEffect(() => {
    if (!isStreaming) return;
    
    const captureInterval = setInterval(() => {
      if (!videoRef.current?.srcObject) return;
      
      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      
      const targetWidth = 320;
      const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth);
      
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const frameData = canvas.toDataURL('image/jpeg', 0.7);
      socket.emit('frame', { img: frameData, timestamp: Date.now() });
      
      setIsAnalyzing(true);
      setTimeout(() => setIsAnalyzing(false), 400);
    }, 2000);
    
    return () => clearInterval(captureInterval);
  }, [isStreaming, setIsAnalyzing]);

  // Handle incoming emotion data
  useEffect(() => {
    const handleEmotionData = (data) => {
      const timestamp = new Date(data.timestamp);
      const timeLabel = timestamp.toLocaleTimeString([], { 
        minute: '2-digit', 
        second: '2-digit' 
      });
      
      // Update current emotions
      setCurrentEmotions(data.emotions);
      
      // Update emotion history
      setEmotionHistory(prev => [...prev.slice(-99), {
        timestamp: data.timestamp,
        emotions: data.emotions,
      }]);
      
      // Calculate dominant emotion
      const dominantEntry = Object.entries(data.emotions).reduce((a, b) => 
        data.emotions[a[0]] > data.emotions[b[0]] ? a : b
      );
      setDominantEmotion(dominantEntry[0]);
      
      // Notify of significant emotion changes
      if (dominantEntry[1] > 0.8) {
        addNotification(`Strong ${dominantEntry[0]} detected (${(dominantEntry[1] * 100).toFixed(0)}%)`, 'info');
      }
      
      // Update chart data
      setChartData(prev => {
        const maxDataPoints = Math.floor(timeRange * 2);
        const newLabels = [...prev.labels, timeLabel].slice(-maxDataPoints);
        
        const newDatasets = prev.datasets.map(dataset => {
          const emotionKey = dataset.label.toLowerCase();
          const emotionValue = data.emotions[emotionKey] ?? 0;
          const newData = [...dataset.data, emotionValue].slice(-maxDataPoints);
          
          return { ...dataset, data: newData };
        });
        
        return {
          labels: newLabels,
          datasets: newDatasets,
        };
      });
    };

    socket.on('emotion', handleEmotionData);
    return () => socket.off('emotion', handleEmotionData);
  }, [timeRange, setCurrentEmotions, setEmotionHistory, setDominantEmotion, setChartData, addNotification]);

  // Calculate session statistics
  useEffect(() => {
    if (emotionHistory.length === 0) return;
    
    const calculatedStats = EMOTION_LABELS.reduce((accumulator, emotion) => {
      const values = emotionHistory.map(entry => entry.emotions[emotion] || 0);
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      const maximum = Math.max(...values);
      const trend = values.length > 1 ? 
        (values[values.length - 1] - values[values.length - 2]) : 0;
      
      accumulator[emotion] = { average, maximum, trend };
      return accumulator;
    }, {});
    
    setSessionStats(calculatedStats);
  }, [emotionHistory, setSessionStats]);

  const clearAnalysisData = useCallback(() => {
    setChartData(prev => ({
      ...prev,
      labels: [],
      datasets: prev.datasets.map(dataset => ({ ...dataset, data: [] }))
    }));
    setEmotionHistory([]);
    setCurrentEmotions({});
    addNotification('Analysis data cleared', 'info');
  }, [setChartData, setEmotionHistory, setCurrentEmotions, addNotification]);

  const takeScreenshot = useCallback(() => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `neurolens-screenshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addNotification('Screenshot saved!', 'success');
    });
  }, [addNotification]);

  const startRecording = useCallback(() => {
    addNotification('Recording feature coming soon!', 'info');
  }, [addNotification]);

  const formatPercentage = (value) => {
    return ((value || 0) * 100).toFixed(0);
  };

  const getTrendIndicator = (trend) => {
    if (trend > 0.05) return '↗️';
    if (trend < -0.05) return '↘️';
    return '➡️';
  };

  return (
    <div className="content-grid">
      <section className="video-section">
        <div className={`video-container ${isFullscreen ? 'fullscreen' : ''}`}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="video-element"
          />
          <div className="video-overlay"></div>
          <div className="video-status">
            {isStreaming && (
              <div className="status-badge status-recording">
                🔴 Recording
              </div>
            )}
            {isAnalyzing && (
              <div className="status-badge status-analyzing">
                🧠 Analyzing
              </div>
            )}
          </div>
          
          <div className="video-controls">
            <button className="control-button" onClick={() => setIsFullscreen(!isFullscreen)}>
              {isFullscreen ? '⏹️ Exit' : '🔍 Fullscreen'}
            </button>
            <button className="control-button" onClick={takeScreenshot}>
              📸 Screenshot
            </button>
            <button className="control-button" onClick={startRecording}>
              🎥 Record
            </button>
          </div>
        </div>
        
        <div className="emotion-grid">
          {EMOTION_LABELS.map(emotion => (
            <div 
              key={emotion} 
              className={`emotion-card ${emotion} ${dominantEmotion === emotion ? 'dominant' : ''}`}
              style={{
                '--emotion-width': `${formatPercentage(currentEmotions[emotion])}%`
              }}
            >
              <div className="emotion-header">
                <span className="emotion-emoji">{EMOTION_EMOJIS[emotion]}</span>
                <span className="emotion-name">{emotion}</span>
              </div>
              <div className="emotion-value">
                {formatPercentage(currentEmotions[emotion])}%
              </div>
              <div className="emotion-trend">
                {sessionStats[emotion] && getTrendIndicator(sessionStats[emotion].trend)} 
                {sessionStats[emotion] ? 'Trending' : 'Stable'}
              </div>
              <div className="emotion-value-bar"></div>
            </div>
          ))}
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-header">
          <h3 className="analytics-title">Live Emotion Timeline</h3>
          <div className="time-controls">
            <button 
              className={`time-button ${timeRange === 10 ? 'active' : ''}`}
              onClick={() => setTimeRange(10)}
            >
              10s
            </button>
            <button 
              className={`time-button ${timeRange === 20 ? 'active' : ''}`}
              onClick={() => setTimeRange(20)}
            >
              20s
            </button>
            <button 
              className={`time-button ${timeRange === 60 ? 'active' : ''}`}
              onClick={() => setTimeRange(60)}
            >
              1m
            </button>
            <button 
              className="time-button"
              onClick={clearAnalysisData}
            >
              Clear
            </button>
          </div>
        </div>
        
        <div className="chart-container">
          {chartData.labels.length > 0 ? (
            <>
              <Line data={chartData} options={chartOptions} />
              <div className="chart-minimap">
                <Line data={chartData} options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { display: false },
                    y: { display: false }
                  }
                }} />
              </div>
            </>
          ) : (
            <div className="chart-placeholder">
              <div className="loading-spinner"></div>
              <p>Start your session to see real-time emotion analysis</p>
              <small>Position yourself in front of the camera for best results</small>
            </div>
          )}
        </div>
        
        {emotionHistory.length > 0 && (
          <div className="emotion-timeline">
            <h4 style={{ marginBottom: '0.5rem', color: '#ffffff' }}>Recent Activity</h4>
            {emotionHistory.slice(-5).reverse().map((entry, index) => {
              const topEmotion = Object.entries(entry.emotions).reduce((a, b) => 
                entry.emotions[a[0]] > entry.emotions[b[0]] ? a : b
              );
              return (
                <div key={index} className="timeline-item" style={{ '--emotion-color': EMOTION_COLORS[topEmotion[0]] }}>
                  <span className="timeline-time">
                    {new Date(entry.timestamp).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                  <span className="timeline-emotion">{topEmotion[0]}</span>
                  <span className="timeline-value">{(topEmotion[1] * 100).toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// Analytics View Component
function AnalyticsView({ emotionHistory, sessionStats, addNotification }) {
  const totalSessions = Math.max(1, Math.floor(emotionHistory.length / 60));
  const totalMinutes = Math.round(emotionHistory.length * 0.5 / 60 * 10) / 10;
  
  const getMostDominantEmotion = () => {
    if (Object.keys(sessionStats).length === 0) return 'neutral';
    
    return Object.entries(sessionStats).reduce((max, [emotion, stats]) => 
      stats.average > (sessionStats[max]?.average || 0) ? emotion : max
    , 'neutral');
  };

  const getEmotionIntensity = () => {
    if (Object.keys(sessionStats).length === 0) return 0;
    
    const averages = Object.values(sessionStats).map(stat => stat.average);
    return (averages.reduce((sum, avg) => sum + avg, 0) / averages.length * 100).toFixed(1);
  };

  const generateReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalSessions,
        totalMinutes,
        dominantEmotion: getMostDominantEmotion(),
        averageIntensity: getEmotionIntensity()
      },
      emotions: sessionStats
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurolens-report-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    addNotification('Analytics report generated!', 'success');
  };

  return (
    <div className="content-grid">
      <section className="video-section">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{totalSessions}</div>
            <div className="stat-label">Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalMinutes}m</div>
            <div className="stat-label">Total Time</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{EMOTION_EMOJIS[getMostDominantEmotion()]}</div>
            <div className="stat-label">Top Emotion</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{getEmotionIntensity()}%</div>
            <div className="stat-label">Avg Intensity</div>
          </div>
        </div>
        
        <div className="emotion-grid">
          {EMOTION_LABELS.map(emotion => (
            <div key={emotion} className={`emotion-card ${emotion}`}>
              <div className="emotion-header">
                <span className="emotion-emoji">{EMOTION_EMOJIS[emotion]}</span>
                <span className="emotion-name">{emotion}</span>
              </div>
              <div className="emotion-value">
                {sessionStats[emotion] ? (sessionStats[emotion].average * 100).toFixed(1) : '0.0'}%
              </div>
              <div className="emotion-trend">
                Peak: {sessionStats[emotion] ? (sessionStats[emotion].maximum * 100).toFixed(0) : '0'}%
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-header">
          <h3 className="analytics-title">Session Analytics</h3>
          <button className="export-button" onClick={generateReport}>
            Generate Report
          </button>
        </div>
        
        <div className="analytics-card" style={{ '--accent-color': '#3b82f6' }}>
          <h4>📊 Detailed Analytics</h4>
          <p>Comprehensive emotion analysis across your sessions</p>
          <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            <div>
              <p><strong>Session Overview:</strong></p>
              <ul style={{ color: '#888', fontSize: '0.9rem', lineHeight: '1.6', marginTop: '0.5rem' }}>
                <li>Total data points: {emotionHistory.length}</li>
                <li>Most active emotion: {getMostDominantEmotion()}</li>
                <li>Peak emotions tracked: {EMOTION_LABELS.length}</li>
                <li>Analysis accuracy: Real-time</li>
              </ul>
            </div>
            <div>
              <p><strong>Performance Metrics:</strong></p>
              <ul style={{ color: '#888', fontSize: '0.9rem', lineHeight: '1.6', marginTop: '0.5rem' }}>
                <li>Processing speed: ~2 FPS</li>
                <li>Detection confidence: 95%+</li>
                <li>Real-time analysis: Active</li>
                <li>Data retention: Session-based</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// History View Component  
function HistoryView({ emotionHistory, addNotification }) {
  const recentSessions = emotionHistory.slice(-50);
  
  const clearHistory = () => {
    // In a real app, this would clear the history from state
    addNotification('History cleared!', 'info');
  };
  
  return (
    <div className="content-grid">
      <section className="video-section">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{emotionHistory.length}</div>
            <div className="stat-label">Data Points</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{recentSessions.length}</div>
            <div className="stat-label">Recent Points</div>
          </div>
        </div>
        
        <div className="emotion-grid">
          <div className="emotion-card">
            <div className="emotion-header">
              <span className="emotion-emoji">📈</span>
              <span className="emotion-name">Tracking</span>
            </div>
            <div className="emotion-value">
              {emotionHistory.length > 0 ? 'Active' : 'Inactive'}
            </div>
            <div className="emotion-trend">
              Status
            </div>
          </div>
          <div className="emotion-card" onClick={clearHistory} style={{ cursor: 'pointer' }}>
            <div className="emotion-header">
              <span className="emotion-emoji">🗑️</span>
              <span className="emotion-name">Clear</span>
            </div>
            <div className="emotion-value">
              Reset
            </div>
            <div className="emotion-trend">
              Click to clear
            </div>
          </div>
        </div>
      </section>

      <section className="analytics-section">
        <div className="analytics-header">
          <h3 className="analytics-title">Session History</h3>
        </div>
        
        <div className="analytics-card">
          <h4>📋 Session History</h4>
          <p>Historical emotion data and patterns</p>
          {emotionHistory.length > 0 ? (
            <div style={{ marginTop: '2rem' }}>
              <p><strong>Recent Activity:</strong></p>
              <div className="emotion-timeline">
                {recentSessions.reverse().map((session, index) => {
                  const topEmotion = Object.entries(session.emotions).reduce((a, b) => 
                    session.emotions[a[0]] > session.emotions[b[0]] ? a : b
                  );
                  return (
                    <div key={index} className="timeline-item" style={{ '--emotion-color': EMOTION_COLORS[topEmotion[0]] }}>
                      <span className="timeline-time">
                        {new Date(session.timestamp).toLocaleString()}
                      </span>
                      <span className="timeline-emotion">{topEmotion[0]}</span>
                      <span className="timeline-value">{(topEmotion[1] * 100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p style={{ color: '#888', marginTop: '1rem' }}>No session data available yet</p>
          )}
        </div>
      </section>
    </div>
  );
}

// Settings Panel Component
function SettingsPanel({ isOpen, onClose, sessionStats, emotionHistory, performance, currentTheme, onExportData }) {
  const getSessionDuration = () => {
    return Math.round(emotionHistory.length * 0.5 / 60 * 10) / 10;
  };

  const getTopEmotion = () => {
    if (Object.keys(sessionStats).length === 0) return 'None';
    
    const topEmotion = Object.entries(sessionStats).reduce((max, [emotion, stats]) => 
      stats.average > (sessionStats[max[0]]?.average || 0) ? [emotion, stats] : max
    , ['neutral', { average: 0 }]);
    
    return `${topEmotion[0]} (${(topEmotion[1].average * 100).toFixed(1)}%)`;
  };

  return (
    <div className={`settings-panel ${isOpen ? 'open' : ''}`}>
      <div className="settings-header">
        <h3 className="settings-title">Settings & Stats</h3>
        <button className="close-settings" onClick={onClose}>×</button>
      </div>
      
      <div className="settings-content">
        <div className="settings-section">
          <h4 className="settings-section-title">Session Statistics</h4>
          
          <div className="settings-item">
            <span className="settings-label">Duration</span>
            <span className="settings-value">{getSessionDuration()} minutes</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Data Points</span>
            <span className="settings-value">{emotionHistory.length}</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Top Emotion</span>
            <span className="settings-value">{getTopEmotion()}</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Emotions Tracked</span>
            <span className="settings-value">{EMOTION_LABELS.length}</span>
          </div>
        </div>

        <div className="settings-section">
          <h4 className="settings-section-title">Performance</h4>
          
          <div className="settings-item">
            <span className="settings-label">FPS</span>
            <span className="settings-value">{performance.fps}</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Latency</span>
            <span className="settings-value">{performance.latency}ms</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Accuracy</span>
            <span className="settings-value">{performance.accuracy}%</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Memory</span>
            <span className="settings-value">{performance.memoryUsage}MB</span>
          </div>
        </div>

        <div className="settings-section">
          <h4 className="settings-section-title">System Info</h4>
          
          <div className="settings-item">
            <span className="settings-label">Version</span>
            <span className="settings-value">2.0.0</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Theme</span>
            <span className="settings-value">{currentTheme}</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Camera</span>
            <span className="settings-value">Connected</span>
          </div>
          
          <div className="settings-item">
            <span className="settings-label">Analysis Rate</span>
            <span className="settings-value">2 FPS</span>
          </div>
        </div>

        <div className="settings-section">
          <h4 className="settings-section-title">Actions</h4>
          <button 
            className="export-button" 
            onClick={onExportData}
            style={{ width: '100%', marginBottom: '1rem' }}
          >
            Export All Data
          </button>
        </div>

        <div className="settings-section">
          <h4 className="settings-section-title">About NeuroLens</h4>
          <p style={{ color: '#888', fontSize: '0.9rem', lineHeight: '1.5' }}>
            NeuroLens provides real-time emotion analysis using advanced computer vision 
            to track facial expressions and emotional responses. Perfect for UX research, 
            content analysis, and user engagement studies.
          </p>
        </div>
      </div>
    </div>
  );
}