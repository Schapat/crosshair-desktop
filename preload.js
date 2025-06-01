const { ipcRenderer } = require('electron');

// Mark window as desktop app immediately before any React code runs
window.isDesktopApp = true;
window.electronAppVersion = '2.2.6';

// Desktop integration API
window.electronAPI = {
  showOverlay: (settings) => {
    console.log('showOverlay called with:', settings);
    ipcRenderer.send('show-overlay', settings);
  },
  hideOverlay: () => {
    console.log('hideOverlay called');
    ipcRenderer.send('hide-overlay');
  },
  updateOverlay: (settings) => {
    console.log('updateOverlay called with:', settings);
    ipcRenderer.send('update-overlay', settings);
  },
  updateCrosshair: (settings) => {
    console.log('updateCrosshair called with:', settings);
    ipcRenderer.send('update-crosshair', settings);
  },
  minimizeApp: () => {
    console.log('minimizeApp called');
    ipcRenderer.send('minimize-app');
  },
  closeApp: () => {
    console.log('closeApp called');
    ipcRenderer.send('close-app');
  },
  restartApp: () => {
    console.log('restartApp called');
    ipcRenderer.send('restart-app');
  },
  onKeyPress: (callback) => {
    ipcRenderer.on('key-press', (event, key) => callback(key));
  },
  saveCredentials: (username, password) => {
    console.log('saveCredentials called');
    ipcRenderer.send('save-credentials', { username, password });
  },
  getCredentials: () => {
    console.log('getCredentials called');
    return ipcRenderer.invoke('get-credentials');
  },
  clearCredentials: () => {
    console.log('clearCredentials called');
    ipcRenderer.send('clear-credentials');
  },
  registerHotkeys: (hotkeys) => {
    console.log('registerHotkeys called with:', hotkeys);
    ipcRenderer.send('register-hotkeys', hotkeys);
  },
  unregisterHotkeys: () => {
    console.log('unregisterHotkeys called');
    ipcRenderer.send('unregister-hotkeys');
  },
  onHotkeyTriggered: (callback) => {
    ipcRenderer.on('hotkey-triggered', (event, hotkey) => callback(hotkey));
  },
  getDisplays: async () => {
    console.log('getDisplays called');
    return await ipcRenderer.invoke('get-displays');
  },
  setOverlayDisplay: (displayId) => {
    console.log('setOverlayDisplay called with:', displayId);
    ipcRenderer.send('set-overlay-display', displayId);
  },
  verifyPremium: (userData) => {
    console.log('verifyPremium called with:', userData);
    ipcRenderer.send('verify-premium', userData);
  },
  userLogout: () => {
    console.log('userLogout called');
    ipcRenderer.send('user-logout');
  },
  onPremiumVerified: (callback) => {
    ipcRenderer.on('premium-verified', (event, verified) => callback(verified));
  }
};

// Override HTTP request methods to ensure desktop headers
window.addEventListener('DOMContentLoaded', () => {
  console.log('PreLoad: Desktop app initialization complete');
  
  // Override fetch
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['X-Client-Type'] = 'desktop-app';
    options.headers['X-Desktop-Client'] = 'true';
    options.headers['X-App-Source'] = 'electron';
    options.headers['User-Agent'] = 'CrosshairPro-Desktop/2.2.6';
    
    // Add session token if available
    const sessionToken = localStorage.getItem('desktop-session-token');
    if (sessionToken) {
      options.headers['X-Session-Token'] = sessionToken;
    }
    
    // Add license token if available
    const licenseToken = localStorage.getItem('desktop-license-token');
    if (licenseToken) {
      options.headers['X-License-Token'] = licenseToken;
    }
    
    console.log('PreLoad: Fetch request with desktop headers:', url);
    return originalFetch(url, options);
  };

  // Override XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._url = url;
    this._method = method;
    return originalXHROpen.call(this, method, url, async, user, password);
  };

  XMLHttpRequest.prototype.send = function(data) {
    this.setRequestHeader('X-Client-Type', 'desktop-app');
    this.setRequestHeader('X-Desktop-Client', 'true');
    this.setRequestHeader('X-App-Source', 'electron');
    this.setRequestHeader('User-Agent', 'CrosshairPro-Desktop/2.2.6');
    
    // Add session token if available
    const sessionToken = localStorage.getItem('desktop-session-token');
    if (sessionToken) {
      this.setRequestHeader('X-Session-Token', sessionToken);
    }
    
    // Add license token if available
    const licenseToken = localStorage.getItem('desktop-license-token');
    if (licenseToken) {
      this.setRequestHeader('X-License-Token', licenseToken);
    }
    
    console.log('PreLoad: XHR request with desktop headers:', this._method, this._url);
    return originalXHRSend.call(this, data);
  };
});

console.log('PreLoad: Desktop app preload script loaded successfully');