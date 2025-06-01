const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  safeStorage,
} = require("electron");
const path = require("path");

const { autoUpdater } = require('electron-updater');

let overlayWindow = null;
let mainWindow = null;
let isOverlayVisible = false;
let isPremiumVerified = false;
let currentMonitor = 0;
let availableDisplays = [];
let selectedDisplayId = null;
let userHotkeys = [];

// Web app connection settings
const WEB_APP_URL = "http://localhost:5000"; // Local development URL
const PRODUCTION_URL = "https://crosshairpro.replit.app"; // Production URL

async function createMainWindow() {
  // Get available displays for multi-monitor support
  availableDisplays = screen.getAllDisplays();

  // Get screen dimensions for optimal window sizing
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;

  // Calculate optimal window size (75% of screen, but within reasonable bounds)
  const windowWidth = Math.max(
    1000,
    Math.min(1400, Math.floor(screenWidth * 0.75)),
  );
  const windowHeight = Math.max(
    700,
    Math.min(1000, Math.floor(screenHeight * 0.75)),
  );

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "assets", "icon.png"),
    title: "CrosshairPro Desktop",
    show: false,
    resizable: true,
    minWidth: 1000,
    minHeight: 700,
    center: true,
  });
  mainWindow.setMenu(null);
  // Load the main app and let it handle authentication and routing
  console.log("Loading CrosshairPro app...");
  try {
    await mainWindow.loadURL(`${PRODUCTION_URL}/`);
    console.log("Loaded production server");
  } catch (error) {
    console.log("Production failed, trying local server...");
    await mainWindow.loadURL(`${WEB_APP_URL}/`);
  }

  // Set up comprehensive request interception for ALL requests
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      // Add desktop headers to ALL requests (including XMLHttpRequest, fetch, etc.)
      details.requestHeaders["X-Client-Type"] = "desktop-app";
      details.requestHeaders["X-Desktop-Client"] = "true";
      details.requestHeaders["X-App-Source"] = "electron";
      details.requestHeaders["User-Agent"] = "CrosshairPro-Desktop/2.2.6";

      // Debug logging to verify headers are being sent
      if (
        details.url.includes("crosshair-craft.replit.app") ||
        details.url.includes("localhost")
      ) {
        console.log("Desktop headers added to request:", details.url);
        console.log("Headers:", details.requestHeaders);
      }

      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Also intercept response headers to debug server responses
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      if (
        details.url.includes("crosshair-craft.replit.app") ||
        details.url.includes("localhost")
      ) {
        console.log(
          "Response from server for:",
          details.url,
          "Status:",
          details.statusCode,
        );
      }
      callback({});
    },
  );

  mainWindow.once("ready-to-show", async () => {
    mainWindow.show();
    console.log(
      "Desktop app window shown - electronAPI should be available from preload script",
    );
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (overlayWindow) {
      overlayWindow.close();
    }
  });
}


function createOverlayWindow() {
  console.log("Creating overlay window...");

  // Get all displays and update available displays
  const allDisplays = screen.getAllDisplays();
  availableDisplays = allDisplays;

  // Use selected display or fallback to primary display
  let targetDisplay;
  if (selectedDisplayId) {
    targetDisplay = allDisplays.find(
      (display) => display.id === selectedDisplayId,
    );
    console.log(
      `Looking for display ID ${selectedDisplayId}, found:`,
      targetDisplay,
    );
  }

  if (!targetDisplay) {
    targetDisplay = screen.getPrimaryDisplay();
    console.log("Using primary display as fallback:", targetDisplay);
  }

  // Use full display bounds to cover taskbar
  const { width, height, x, y } = targetDisplay.bounds;
  console.log(
    `Creating overlay on display: ${targetDisplay.id} at bounds ${x},${y} ${width}x${height}`,
  );

  console.log(`Display bounds: ${width}x${height} at ${x},${y}`);

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreen: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: true, // Needs to be focusable to receive key events
    show: false,
    hasShadow: false,
    acceptFirstMouse: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");

  const overlayPath = path.join(__dirname, "overlay.html");
  overlayWindow.loadFile(overlayPath);

  overlayWindow.on("closed", () => {
    overlayWindow = null;
    isOverlayVisible = false;
  });

  overlayWindow.once("ready-to-show", () => {
    console.log("Overlay window ready");
    overlayWindow.show();
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
    overlayWindow.setVisibleOnAllWorkspaces(true);
    overlayWindow.setFullScreenable(false);

    // Windows-specific: Hide from Alt+Tab and ensure it covers taskbar
    if (process.platform === "win32") {
      overlayWindow.setSkipTaskbar(true);
      overlayWindow.setAppDetails({
        appId: "crosshair-overlay",
        appIconPath: "",
        appIconIndex: 0,
        relaunchCommand: "",
        relaunchDisplayName: "",
      });
    }
  });
}

function updateOverlayCrosshair(settings) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("update-crosshair", settings);
  }
}

function showOverlay(settings) {
  // Check if premium is verified before showing overlay
  if (!isPremiumVerified) {
    console.log("Premium not verified - overlay blocked");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        alert('Premium-Verifizierung erforderlich: Bitte melden Sie sich mit einem gültigen Premium-Account an, um Overlay-Funktionen zu nutzen.');
      `);
    }
    return;
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
    // Wait for overlay to be ready before sending settings
    overlayWindow.once("ready-to-show", () => {
      setTimeout(() => {
        updateOverlayCrosshair(settings);
        // Register global shortcuts when overlay is shown
        registerGlobalShortcuts();
      }, 500);
    });
  } else {
    overlayWindow.show();
    updateOverlayCrosshair(settings);
    // Register global shortcuts when overlay is shown
    registerGlobalShortcuts();
  }

  isOverlayVisible = true;
  console.log("Overlay shown with settings:", settings);
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
    isOverlayVisible = false;
    // Unregister global shortcuts when overlay is hidden
    unregisterGlobalShortcuts();
    console.log("Overlay hidden");
  }
}

function toggleOverlay(settings) {
  // Check premium status before toggling
  if (!isPremiumVerified) {
    console.log("Premium not verified - toggle blocked");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        alert('Premium-Verifizierung erforderlich: Bitte melden Sie sich mit einem gültigen Premium-Account an, um Overlay-Funktionen zu nutzen.');
      `);
    }
    return;
  }

  if (isOverlayVisible) {
    hideOverlay();
  } else {
    showOverlay(settings);
  }
}

// IPC Handlers
ipcMain.on("show-overlay", (event, settings) => {
  showOverlay(settings);
});

ipcMain.on("hide-overlay", () => {
  hideOverlay();
});

ipcMain.on("update-overlay", (event, settings) => {
  console.log("Received overlay update request:", settings);
  updateOverlayCrosshair(settings);
});

ipcMain.on("update-crosshair", (event, settings) => {
  console.log("Received crosshair update request:", settings);
  updateOverlayCrosshair(settings);
});

ipcMain.on("toggle-overlay", (event, settings) => {
  toggleOverlay(settings);
});

ipcMain.on("minimize-app", () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on("close-app", () => {
  app.quit();
});

ipcMain.on("restart-app", () => {
  app.relaunch();
  app.exit();
});

ipcMain.handle("get-displays", () => {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    index: index,
    size: display.size,
    bounds: display.bounds,
    workArea: display.workArea,
    primary: display.primary,
  }));
});

ipcMain.on("set-display", (event, displayIndex) => {
  currentMonitor = displayIndex;
  console.log(`Monitor switched to: ${displayIndex}`);

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
});

ipcMain.on("set-overlay-display", (event, displayId) => {
  setOverlayDisplay(displayId);
});

// Handle hotkey registration from web app
ipcMain.on("register-hotkeys", (event, hotkeys) => {
  registerUserHotkeys(hotkeys, true);
});

ipcMain.on("unregister-hotkeys", () => {
  unregisterUserHotkeys();
  saveHotkeysToFile([], false);
});

// Handle premium verification
ipcMain.on("verify-premium", (event, userData) => {
  console.log("Premium verification received:", userData);
  if (userData && userData.isPro) {
    isPremiumVerified = true;
    console.log("Premium status verified - features unlocked");

    // Load stored hotkeys after premium verification
    loadStoredHotkeys();

    // Notify web app that premium is verified
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("premium-verified", true);
    }
  } else {
    isPremiumVerified = false;
    console.log("Premium status not verified - features locked");
    unregisterUserHotkeys();
  }
});

// Handle logout
ipcMain.on("user-logout", () => {
  console.log("User logged out - disabling premium features");
  isPremiumVerified = false;
  unregisterUserHotkeys();
  hideOverlay();
});

// Handle overlay hotkey triggers
ipcMain.on("overlay-hotkey-triggered", (event, hotkey) => {
  console.log(`Overlay hotkey triggered: ${hotkey.name} (${hotkey.key})`);
  showOverlay(hotkey.settings);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hotkey-triggered", hotkey);
  }
});

// Credential management handlers
ipcMain.on("save-credentials", (event, { username, password }) => {
  try {
    const fs = require("fs");
    const os = require("os");
    const credPath = path.join(os.homedir(), ".crosshairpro-credentials.json");
    
    console.log("Saving credentials for user:", username);
    
    let encryptedData;
    
    // Check if safeStorage is available
    if (safeStorage.isEncryptionAvailable()) {
      // Encrypt credentials using Electron's safeStorage
      encryptedData = {
        username: username,
        password: safeStorage.encryptString(password),
        encrypted: true,
        timestamp: Date.now()
      };
      console.log("Using encrypted storage");
    } else {
      // Fallback to plain text if encryption is not available
      console.warn("Encryption not available, storing plain text");
      encryptedData = {
        username: username,
        password: password,
        encrypted: false,
        timestamp: Date.now()
      };
    }
    
    fs.writeFileSync(credPath, JSON.stringify(encryptedData));
    console.log("Credentials saved successfully at:", credPath);
  } catch (error) {
    console.error("Failed to save credentials:", error);
  }
});

ipcMain.handle("get-credentials", async () => {
  try {
    const fs = require("fs");
    const os = require("os");
    const credPath = path.join(os.homedir(), ".crosshairpro-credentials.json");
    
    console.log("Looking for credentials at:", credPath);
    
    if (!fs.existsSync(credPath)) {
      console.log("No credentials file found");
      return null;
    }
    
    const data = fs.readFileSync(credPath, "utf8");
    const encryptedData = JSON.parse(data);
    
    console.log("Found credentials for user:", encryptedData.username);
    
    // Check if data was stored encrypted
    if (encryptedData.encrypted === false) {
      console.log("Loading plain text credentials");
      return {
        username: encryptedData.username,
        password: encryptedData.password
      };
    }
    
    // Check if safeStorage is available for decryption
    if (!safeStorage.isEncryptionAvailable()) {
      console.error("Encryption not available but data is encrypted");
      return null;
    }
    
    // Decrypt password using Electron's safeStorage
    const decryptedPassword = safeStorage.decryptString(encryptedData.password);
    console.log("Successfully decrypted credentials");
    
    return {
      username: encryptedData.username,
      password: decryptedPassword
    };
  } catch (error) {
    console.error("Failed to get credentials:", error);
    // Try to clear corrupted credentials
    try {
      const fs = require("fs");
      const os = require("os");
      const credPath = path.join(os.homedir(), ".crosshairpro-credentials.json");
      if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
        console.log("Cleared corrupted credentials file");
      }
    } catch (clearError) {
      console.error("Failed to clear corrupted credentials:", clearError);
    }
    return null;
  }
});

ipcMain.on("clear-credentials", () => {
  try {
    const fs = require("fs");
    const os = require("os");
    const credPath = path.join(os.homedir(), ".crosshairpro-credentials.json");
    
    if (fs.existsSync(credPath)) {
      fs.unlinkSync(credPath);
      console.log("Credentials cleared successfully");
    }
  } catch (error) {
    console.error("Failed to clear credentials:", error);
  }
});

// Add a simple test handler to verify IPC is working
ipcMain.handle("test-connection", async () => {
  console.log("Test connection handler called successfully!");
  return { status: "success", message: "IPC handlers are working" };
});

// App event handlers
app.whenReady().then(() => {
  createMainWindow();
  
  // Test if handlers are registered
  console.log("App ready - IPC handlers registered:");
  console.log("- get-credentials: registered");
  console.log("- save-credentials: registered");
  console.log("- clear-credentials: registered");
  console.log("- test-connection: registered");

  autoUpdater.checkForUpdatesAndNotify();

  // No global shortcuts - using passive listeners only
  // Load stored hotkeys only after premium verification
  // loadStoredHotkeys(); // Disabled until premium is verified

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  // Clean up global shortcuts
  unregisterGlobalShortcuts();
});

// Load stored hotkeys from file system
function loadStoredHotkeys() {
  try {
    const fs = require("fs");
    const os = require("os");
    const hotkeyPath = path.join(os.homedir(), ".crosshairpro-hotkeys.json");

    if (fs.existsSync(hotkeyPath)) {
      const data = fs.readFileSync(hotkeyPath, "utf8");
      const storedData = JSON.parse(data);

      if (storedData.hotkeys && storedData.enabled) {
        console.log("Loading stored hotkeys:", storedData.hotkeys);
        registerUserHotkeys(storedData.hotkeys);
      }

      if (storedData.selectedDisplayId) {
        selectedDisplayId = storedData.selectedDisplayId;
        console.log("Loading selected display:", selectedDisplayId);
      }
    }
  } catch (error) {
    console.error("Failed to load stored hotkeys:", error);
  }
}

// Save hotkeys to file system
function saveHotkeysToFile(hotkeys, enabled) {
  try {
    const fs = require("fs");
    const os = require("os");
    const hotkeyPath = path.join(os.homedir(), ".crosshairpro-hotkeys.json");

    const data = {
      hotkeys: hotkeys,
      enabled: enabled,
      selectedDisplayId: selectedDisplayId,
    };

    fs.writeFileSync(hotkeyPath, JSON.stringify(data, null, 2));
    console.log("Hotkeys saved to file system");
  } catch (error) {
    console.error("Failed to save hotkeys:", error);
  }
}

// Register user-defined hotkeys (stored for overlay use)
function registerUserHotkeys(hotkeys, saveToFile = false) {
  // Check premium status before registering hotkeys
  if (!isPremiumVerified) {
    console.log("Premium not verified - hotkey registration blocked");
    return;
  }

  unregisterUserHotkeys();

  console.log("Storing hotkeys for overlay use:", hotkeys);

  // Store hotkeys for overlay activation
  userHotkeys = hotkeys.filter((hotkey) => {
    const key = hotkey.key.toUpperCase();
    if (key === "F1" || key === "F2") {
      console.log(`Skipping ${key} - reserved for system`);
      return false;
    }
    return true;
  });

  // Don't register shortcuts yet - only when overlay is shown
  console.log("Hotkeys stored, will activate when overlay is shown");

  if (saveToFile) {
    saveHotkeysToFile(hotkeys, true);
  }
}

// Setup global keyboard hook using native system monitoring
function setupOverlayKeyListener() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  console.log("Setting up system-wide keyboard monitoring");

  // Use a low-level keyboard hook to capture keys system-wide
  overlayWindow.webContents
    .executeJavaScript(
      `
    const { iohook } = require('iohook');
    
    // Remove existing hook if any
    if (window.keyboardHook) {
      try {
        iohook.stop();
      } catch (e) {}
    }
    
    // Setup system-wide keyboard hook
    window.keyboardHook = function(event) {
      // Only process keydown events
      if (event.type !== 'keydown') return;
      
      const key = String.fromCharCode(event.keycode);
      const modifiers = {
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        alt: event.altKey
      };
      
      console.log('System key pressed:', key, 'Modifiers:', modifiers);
      
      // Find matching hotkey
      const userHotkeys = ${JSON.stringify(userHotkeys)};
      const matchingHotkey = userHotkeys.find(hotkey => {
        const keyMatch = hotkey.key.toLowerCase() === key.toLowerCase();
        const shiftMatch = (hotkey.shift || false) === modifiers.shift;
        const ctrlMatch = (hotkey.ctrl || false) === modifiers.ctrl;
        const altMatch = (hotkey.alt || false) === modifiers.alt;
        
        return keyMatch && shiftMatch && ctrlMatch && altMatch;
      });
      
      if (matchingHotkey) {
        console.log('System hotkey matched:', matchingHotkey.name);
        // Send to main process
        require('electron').ipcRenderer.send('overlay-hotkey-triggered', matchingHotkey);
      }
    };
    
    // Register the hook
    iohook.on('keydown', window.keyboardHook);
    iohook.start();
    console.log('System-wide keyboard hook started');
  `,
    )
    .catch((error) => {
      console.log("iohook not available, falling back to global shortcuts");
      // Fallback to global shortcuts if iohook is not available
      registerGlobalShortcuts();
    });
}

// Fallback: Register as global shortcuts
// Background hotkey mapping - uses very obscure key combinations that games never use
const systemHotkeyMapping = [
  "CommandOrControl+Alt+Shift+ScrollLock",
  "CommandOrControl+Alt+Shift+Pause",
  "CommandOrControl+Alt+Shift+Insert",
  "CommandOrControl+Alt+Shift+Home",
  "CommandOrControl+Alt+Shift+End",
  "CommandOrControl+Alt+Shift+PageUp",
  "CommandOrControl+Alt+Shift+PageDown",
  "CommandOrControl+Alt+Shift+PrintScreen",
  "CommandOrControl+Alt+Shift+NumLock",
  "CommandOrControl+Alt+Shift+CapsLock",
];

function registerGlobalShortcuts() {
  // Only register F1 and F2 as global shortcuts
  globalShortcut.register("F1", () => {
    if (isPremiumVerified) {
      if (currentCrosshairSettings) {
        toggleOverlay(currentCrosshairSettings);
      }
    }
  });

  globalShortcut.register("F2", () => {
    hideOverlay();
  });

  console.log("System shortcuts registered (F1, F2)");

  // Register combination hotkeys for crosshair switching (Shift+Alt+Key)
  userHotkeys.forEach((hotkey, index) => {
    const key = hotkey.key.toUpperCase();

    // Skip reserved keys
    if (key === "F1" || key === "F2") {
      console.log(`Skipping ${key} - reserved for system`);
      return;
    }

    try {
      // Always use Shift+Alt+Key combination to avoid game conflicts
      const overlayShortcut = `Shift+Alt+${key}`;

      const registered = globalShortcut.register(overlayShortcut, () => {
        // Only execute if overlay is visible
        if (!isOverlayVisible) {
          console.log(
            `Hotkey ${overlayShortcut} pressed but overlay not visible - ignoring`,
          );
          return;
        }

        console.log(
          `Crosshair hotkey triggered: ${overlayShortcut} -> switching to ${hotkey.name}`,
        );

        updateOverlayCrosshair(hotkey.settings);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("hotkey-triggered", hotkey);
        }
      });

      if (registered) {
        console.log(
          `✓ Registered game-safe hotkey: ${overlayShortcut} (${hotkey.name})`,
        );
      } else {
        console.log(
          `❌ Failed to register hotkey: ${overlayShortcut} (already in use)`,
        );
      }
    } catch (error) {
      console.error(`Error registering hotkey ${key}:`, error);
    }
  });

  console.log(`🎮 Registered ${userHotkeys.length} double-press hotkeys`);
}

// Conditional keyboard monitoring - only intercepts when overlay is active
function startConditionalKeyboardMonitoring() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  console.log("Starting conditional keyboard monitoring for hotkeys");

  // Inject keyboard monitoring script into overlay window
  overlayWindow.webContents
    .executeJavaScript(
      `
    // Remove existing listeners
    if (window.keyboardListener) {
      window.removeEventListener('keydown', window.keyboardListener);
    }
    
    // Create new keyboard listener
    window.keyboardListener = function(event) {
      // Only process if overlay is visible
      if (!${isOverlayVisible}) {
        return; // Let the key pass through to the game
      }
      
      const key = event.key.toLowerCase();
      const modifiers = {
        shift: event.shiftKey,
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey
      };
      
      // Check if this matches any user hotkey
      const userHotkeys = ${JSON.stringify(userHotkeys)};
      const matchingHotkey = userHotkeys.find(hotkey => {
        const keyMatch = hotkey.key.toLowerCase() === key;
        const shiftMatch = (hotkey.shift || false) === modifiers.shift;
        const ctrlMatch = (hotkey.ctrl || false) === modifiers.ctrl;
        const altMatch = (hotkey.alt || false) === modifiers.alt;
        
        return keyMatch && shiftMatch && ctrlMatch && altMatch;
      });
      
      if (matchingHotkey) {
        console.log('Hotkey matched and intercepted:', matchingHotkey.name);
        
        // Prevent the key from reaching the game
        event.preventDefault();
        event.stopPropagation();
        
        // Send to main process
        require('electron').ipcRenderer.send('overlay-hotkey-triggered', matchingHotkey);
        
        return false;
      }
      
      // Key doesn't match any hotkey, let it pass through
    };
    
    // Add system-wide keyboard hook
    window.addEventListener('keydown', window.keyboardListener, true);
    console.log('Conditional keyboard monitoring active');
  `,
    )
    .catch((error) => {
      console.error("Failed to setup conditional keyboard monitoring:", error);
    });
}

function startKeyboardMonitoring() {
  // Legacy function - now redirects to conditional monitoring
  startConditionalKeyboardMonitoring();
}

function stopKeyboardMonitoring() {
  // Not needed with global shortcuts
  console.log("Using global shortcuts - no keyboard monitoring to stop");
}

// Unregister user-defined hotkeys
function unregisterUserHotkeys() {
  // Just clear the stored hotkeys, don't unregister shortcuts here
  userHotkeys = [];
  console.log("Cleared stored hotkeys");
}

// Unregister global shortcuts (called when overlay is hidden)
function unregisterGlobalShortcuts() {
  userHotkeys.forEach((hotkey, index) => {
    const key = hotkey.key.toUpperCase();

    try {
      // Unregister the Shift+Alt+Key combination
      const overlayShortcut = `Shift+Alt+${key}`;

      globalShortcut.unregister(overlayShortcut);
      console.log(`Unregistered hotkey: ${overlayShortcut}`);
    } catch (error) {
      console.error(`Error unregistering shortcut for ${key}:`, error);
    }
  });
  console.log("All hotkeys released - game controls restored");
}

// Set overlay display and recreate overlay window if needed
function setOverlayDisplay(displayId) {
  selectedDisplayId = displayId;
  console.log(`Setting overlay display to: ${displayId}`);

  // Save display preference
  try {
    const fs = require("fs");
    const os = require("os");
    const hotkeyPath = path.join(os.homedir(), ".crosshairpro-hotkeys.json");

    let data = { hotkeys: [], enabled: true, selectedDisplayId: displayId };
    if (fs.existsSync(hotkeyPath)) {
      const existingData = JSON.parse(fs.readFileSync(hotkeyPath, "utf8"));
      data = { ...existingData, selectedDisplayId: displayId };
    }
    fs.writeFileSync(hotkeyPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to save display preference:", error);
  }

  // If overlay is currently visible, recreate it on the new display
  if (isOverlayVisible && overlayWindow) {
    const wasVisible = true;

    // Close existing overlay window
    if (!overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
    overlayWindow = null;
    isOverlayVisible = false;

    // Create new overlay window on selected display after a short delay
    setTimeout(() => {
      if (wasVisible) {
        createOverlayWindow();

        // Wait for overlay window to be ready, then show with settings
        overlayWindow.once("ready-to-show", () => {
          setTimeout(() => {
            updateOverlayCrosshair({
              shape: "cross",
              color: "#00ff00",
              size: 20,
              opacity: 80,
              thickness: 2,
            });
            overlayWindow.show();
            isOverlayVisible = true;
            console.log("Overlay recreated on new display and centered");
          }, 100);
        });
      }
    }, 300);
  }
}

console.log("CrosshairPro Desktop App starting...");
console.log("Global Hotkeys:");
console.log("  F1 - Toggle Overlay");
console.log("  F2 - Hide Overlay");
