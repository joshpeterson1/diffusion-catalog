const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
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
      icon: path.join(__dirname, '..', '..', 'icon.ico'),
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

    // Set up application menu
    this.createMenu();
  }

  createMenu() {
    const template = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Add Directory',
            click: async () => {
              this.mainWindow.webContents.send('menu-add-directory');
            }
          },
          { type: 'separator' },
          {
            label: 'Exit',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            role: 'quit'
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          {
            label: 'Select All',
            accelerator: 'CmdOrCtrl+A',
            role: 'selectall'
          },
          { type: 'separator' },
          {
            label: 'Preferences',
            accelerator: 'CmdOrCtrl+,',
            click: async () => {
              this.mainWindow.webContents.send('menu-preferences');
            }
          }
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            role: 'reload'
          },
          {
            label: 'Force Reload',
            accelerator: 'CmdOrCtrl+Shift+R',
            role: 'forceReload'
          },
          {
            label: 'Toggle Developer Tools',
            accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            role: 'toggleDevTools'
          },
          { type: 'separator' },
          {
            label: 'Toggle Fullscreen',
            accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
            role: 'togglefullscreen'
          }
        ]
      },
      {
        label: 'Window',
        submenu: [
          {
            label: 'Minimize',
            accelerator: 'CmdOrCtrl+M',
            role: 'minimize'
          },
          {
            label: 'Close',
            accelerator: 'CmdOrCtrl+W',
            role: 'close'
          }
        ]
      },
      {
        label: 'Debug',
        submenu: [
          {
            label: 'Clear Database',
            click: async () => {
              this.mainWindow.webContents.send('menu-clear-db');
            }
          },
          {
            label: 'Debug Database',
            click: async () => {
              this.mainWindow.webContents.send('menu-debug-db');
            }
          },
          {
            label: 'View Database',
            click: async () => {
              this.openDatabaseViewer();
            }
          },
          { type: 'separator' },
          {
            label: 'Clear all Favorites',
            click: async () => {
              this.mainWindow.webContents.send('menu-clear-favorites');
            }
          },
          {
            label: 'Clear all NSFW',
            click: async () => {
              this.mainWindow.webContents.send('menu-clear-nsfw');
            }
          },
          { type: 'separator' },
          {
            label: 'Vitals',
            click: async () => {
              this.mainWindow.webContents.send('menu-vitals');
            }
          },
          { type: 'separator' },
          {
            label: 'Rebuild Database',
            click: async () => {
              this.mainWindow.webContents.send('menu-rebuild-db');
            }
          }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About',
            click: () => {
              const { dialog, shell } = require('electron');
              dialog.showMessageBox(this.mainWindow, {
                type: 'info',
                title: 'About AI Photo Catalog',
                message: 'AI Photo Catalog',
                detail: 'Made by somber with love\n\nA powerful tool for organizing and managing AI-generated images with metadata extraction and tagging capabilities.',
                icon: path.join(__dirname, '..', '..', 'icon.png'),
                buttons: ['Close', 'View Project', 'Open Issue']
              }).then((result) => {
                if (result.response === 1) {
                  // View Project button clicked
                  shell.openExternal('https://google.com');
                } else if (result.response === 2) {
                  // Open Issue button clicked
                  shell.openExternal('https://google.com');
                }
              });
            }
          }
        ]
      }
    ];

    // macOS specific menu adjustments
    if (process.platform === 'darwin') {
      template.unshift({
        label: app.getName(),
        submenu: [
          {
            label: 'About ' + app.getName(),
            role: 'about'
          },
          { type: 'separator' },
          {
            label: 'Services',
            role: 'services',
            submenu: []
          },
          { type: 'separator' },
          {
            label: 'Hide ' + app.getName(),
            accelerator: 'Command+H',
            role: 'hide'
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Shift+H',
            role: 'hideothers'
          },
          {
            label: 'Show All',
            role: 'unhide'
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            click: () => {
              app.quit();
            }
          }
        ]
      });

      // Window menu
      template[4].submenu = [
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          role: 'close'
        },
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+M',
          role: 'minimize'
        },
        {
          label: 'Zoom',
          role: 'zoom'
        },
        { type: 'separator' },
        {
          label: 'Bring All to Front',
          role: 'front'
        }
      ];
    }

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  openDatabaseViewer() {
    // Create a new window for the database viewer
    const dbViewerWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      parent: this.mainWindow,
      modal: false,
      icon: path.join(__dirname, '..', '..', 'icon.ico'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    dbViewerWindow.loadFile('src/renderer/database-viewer.html');

    if (process.argv.includes('--dev')) {
      dbViewerWindow.webContents.openDevTools();
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

    // Add directory dialog handler
    ipcMain.handle('open-directory-dialog', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory', 'openFile'],
        filters: [
          { name: 'All Supported', extensions: ['zip'] },
          { name: 'ZIP Archives', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        title: 'Select Directory or ZIP Archive to Watch'
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    });

    // Clear database handler
    ipcMain.handle('clear-database', async () => {
      return await this.database.clearAll();
    });

    // Debug database handler
    ipcMain.handle('debug-database', async () => {
      return await this.database.debugInfo();
    });

    // Get subfolders handler
    ipcMain.handle('get-subfolders', async () => {
      return await this.database.getSubfolders();
    });

    // Get raw EXIF data handler
    ipcMain.handle('get-raw-exif-data', async (event, filePath) => {
      return await this.metadataExtractor.extractRawExifData(filePath);
    });

    // Open in directory handler
    ipcMain.handle('open-in-directory', async (event, filePath) => {
      const { shell } = require('electron');
      shell.showItemInFolder(filePath);
    });

    // Clear all favorites handler
    ipcMain.handle('clear-all-favorites', async () => {
      return await this.database.clearAllFavorites();
    });

    // Clear all NSFW handler
    ipcMain.handle('clear-all-nsfw', async () => {
      return await this.database.clearAllNsfw();
    });

    // Get table data handler
    ipcMain.handle('get-table-data', async (event, tableName) => {
      return await this.database.getTableData(tableName);
    });

    // Get vitals handler
    ipcMain.handle('get-vitals', async () => {
      const fileWatcherVitals = this.fileWatcher.getVitals();
      const databaseVitals = await this.database.debugInfo();
      
      return {
        fileWatcher: fileWatcherVitals,
        database: databaseVitals,
        timestamp: new Date().toISOString()
      };
    });

    // Rebuild database handler
    ipcMain.handle('rebuild-database', async () => {
      try {
        // Clear existing data
        const clearResult = await this.database.clearAll();
        if (!clearResult.success) {
          return { success: false, message: `Failed to clear database: ${clearResult.message}` };
        }

        // Get all watched directories
        const watchedDirs = Array.from(this.fileWatcher.watchers.keys());
        
        if (watchedDirs.length === 0) {
          return { success: true, message: 'Database cleared. No directories to rebuild from.' };
        }

        // Re-scan all watched directories
        let totalFiles = 0;
        for (const dirPath of watchedDirs) {
          const result = await this.fileWatcher.addDirectory(dirPath);
          if (result.success) {
            // Extract file count from success message
            const match = result.message.match(/Found (\d+) files/);
            if (match) {
              totalFiles += parseInt(match[1]);
            }
          }
        }

        return { 
          success: true, 
          message: `Database rebuilt successfully. Processed ${totalFiles} files from ${watchedDirs.length} directories.` 
        };
      } catch (error) {
        console.error('Error rebuilding database:', error);
        return { success: false, message: error.message };
      }
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

app.on('before-quit', () => {
  // Clean up resources
  if (photoApp.fileWatcher) {
    photoApp.fileWatcher.close();
  }
  if (photoApp.database) {
    photoApp.database.close();
  }
});
