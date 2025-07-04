const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Photo operations
  getPhotos: (options) => ipcRenderer.invoke('get-photos', options),
  searchPhotos: (query, filters) => ipcRenderer.invoke('search-photos', query, filters),
  getPhotoMetadata: (imageId) => ipcRenderer.invoke('get-photo-metadata', imageId),
  updateUserMetadata: (imageId, metadata) => ipcRenderer.invoke('update-user-metadata', imageId, metadata),
  
  // Directory watching
  addWatchDirectory: (dirPath) => ipcRenderer.invoke('add-watch-directory', dirPath),
  removeWatchDirectory: (dirPath) => ipcRenderer.invoke('remove-watch-directory', dirPath),
  
  // File operations
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  
  // Events
  onPhotosUpdated: (callback) => ipcRenderer.on('photos-updated', callback),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // Debug functions
  clearDatabase: () => ipcRenderer.invoke('clear-database'),
  debugDatabase: () => ipcRenderer.invoke('debug-database'),
  
  // Folder operations
  getSubfolders: () => ipcRenderer.invoke('get-subfolders'),
  
  // EXIF operations
  getRawExifData: (filePath) => ipcRenderer.invoke('get-raw-exif-data', filePath),
  
  // File operations
  openInDirectory: (filePath) => ipcRenderer.invoke('open-in-directory', filePath),
  
  // Menu events
  onMenuAddDirectory: (callback) => ipcRenderer.on('menu-add-directory', callback),
  onMenuClearDb: (callback) => ipcRenderer.on('menu-clear-db', callback),
  onMenuDebugDb: (callback) => ipcRenderer.on('menu-debug-db', callback),
  onMenuViewDb: (callback) => ipcRenderer.on('menu-view-db', callback),
  onMenuPreferences: (callback) => ipcRenderer.on('menu-preferences', callback),
  onMenuClearFavorites: (callback) => ipcRenderer.on('menu-clear-favorites', callback),
  onMenuClearNsfw: (callback) => ipcRenderer.on('menu-clear-nsfw', callback),
  onMenuVitals: (callback) => ipcRenderer.on('menu-vitals', callback),
  onMenuRebuildDb: (callback) => ipcRenderer.on('menu-rebuild-db', callback),
  onMenuUpdateDatabase: (callback) => ipcRenderer.on('menu-update-database', callback),
  
  // Clear operations
  clearAllFavorites: () => ipcRenderer.invoke('clear-all-favorites'),
  clearAllNsfw: () => ipcRenderer.invoke('clear-all-nsfw'),
  
  // Database viewer
  getTableData: (tableName) => ipcRenderer.invoke('get-table-data', tableName),
  
  // Vitals
  getVitals: () => ipcRenderer.invoke('get-vitals'),
  
  // Rebuild database
  rebuildDatabase: () => ipcRenderer.invoke('rebuild-database'),
  
  // Update database
  updateDatabase: () => ipcRenderer.invoke('update-database'),
  
  // Watched directories
  getWatchedDirectories: () => ipcRenderer.invoke('get-watched-directories'),
  
  // Config management
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (updates) => ipcRenderer.invoke('update-config', updates),
  resetConfig: () => ipcRenderer.invoke('reset-config')
});
