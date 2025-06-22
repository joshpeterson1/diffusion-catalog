const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const DatabaseManager = require('./database');
const FileWatcher = require('./fileWatcher');
const MetadataExtractor = require('./metadataExtractor');

class PhotoCatalogApp {
  constructor() {
    this.mainWindow = null;
    this.database = null;
    this.fileWatcher = null;
    this.metadataExtractor = null;
  }

  async initialize() {
    // Initialize database
    this.database = new DatabaseManager();
    await this.database.initialize();

    // Initialize metadata extractor
    this.metadataExtractor = new MetadataExtractor(this.database);

    // Initialize file watcher
    this.fileWatcher = new FileWatcher(this.database, this.metadataExtractor);

    // Set up IPC handlers
    this.setupIpcHandlers();
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    this.mainWindow.loadFile('src/renderer/index.html');

    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools();
    }
  }

  setupIpcHandlers() {
    // Get photos with pagination
    ipcMain.handle('get-photos', async (event, options = {}) => {
      return await this.database.getPhotos(options);
    });

    // Add watch directory
    ipcMain.handle('add-watch-directory', async (event, dirPath) => {
      return await this.fileWatcher.addDirectory(dirPath);
    });

    // Remove watch directory
    ipcMain.handle('remove-watch-directory', async (event, dirPath) => {
      return await this.fileWatcher.removeDirectory(dirPath);
    });

    // Update user metadata
    ipcMain.handle('update-user-metadata', async (event, imageId, metadata) => {
      return await this.database.updateUserMetadata(imageId, metadata);
    });

    // Search photos
    ipcMain.handle('search-photos', async (event, query, filters = {}) => {
      return await this.database.searchPhotos(query, filters);
    });

    // Get photo metadata
    ipcMain.handle('get-photo-metadata', async (event, imageId) => {
      return await this.database.getPhotoMetadata(imageId);
    });
  }
}

const photoApp = new PhotoCatalogApp();

app.whenReady().then(async () => {
  await photoApp.initialize();
  photoApp.createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      photoApp.createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
