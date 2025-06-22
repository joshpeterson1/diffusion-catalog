const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;

class FileWatcher {
  constructor(database, metadataExtractor) {
    this.database = database;
    this.metadataExtractor = metadataExtractor;
    this.watchers = new Map();
    this.supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp']);
  }

  async addDirectory(dirPath) {
    if (this.watchers.has(dirPath)) {
      return { success: false, message: 'Directory already being watched' };
    }

    try {
      // Verify directory exists
      await fs.access(dirPath);
      
      // Scan existing files first
      console.log(`Scanning existing files in ${dirPath}...`);
      const fileCount = await this.scanExistingFiles(dirPath);
      console.log(`Found ${fileCount} image files`);
      
      // Create watcher
      const watcher = chokidar.watch(dirPath, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true // We already scanned, so ignore initial events
      });

      // Set up event handlers
      watcher
        .on('add', (filePath) => this.handleFileAdded(filePath))
        .on('unlink', (filePath) => this.handleFileRemoved(filePath))
        .on('error', (error) => console.error('Watcher error:', error));

      this.watchers.set(dirPath, watcher);
      
      return { 
        success: true, 
        message: `Directory added successfully. Found ${fileCount} images.` 
      };
    } catch (error) {
      return { success: false, message: `Failed to add directory: ${error.message}` };
    }
  }

  async removeDirectory(dirPath) {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(dirPath);
      return { success: true, message: 'Directory removed successfully' };
    }
    return { success: false, message: 'Directory not found' };
  }

  async handleFileAdded(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!this.supportedExtensions.has(ext)) {
      return;
    }

    try {
      const stats = await fs.stat(filePath);
      const filename = path.basename(filePath);
      
      // Check if file already exists in database
      const existing = this.database.db.prepare('SELECT id FROM images WHERE path = ?').get(filePath);
      if (existing) {
        return;
      }

      // Add to database with basic info
      const imageData = {
        path: filePath,
        filename: filename,
        fileSize: stats.size,
        dateTaken: stats.mtime, // Will be updated with EXIF data if available
        width: null,
        height: null,
        hash: null
      };

      const imageId = await this.database.addImage(imageData);
      
      // Queue for metadata extraction
      this.metadataExtractor.queueImage(imageId, filePath);
      
    } catch (error) {
      console.error('Error handling file added:', error);
    }
  }

  async handleFileRemoved(filePath) {
    try {
      // Remove from database
      const stmt = this.database.db.prepare('DELETE FROM images WHERE path = ?');
      stmt.run(filePath);
    } catch (error) {
      console.error('Error handling file removed:', error);
    }
  }

  async scanExistingFiles(dirPath) {
    const glob = require('fast-glob');
    const patterns = Array.from(this.supportedExtensions).map(ext => `**/*${ext}`);
    
    try {
      const files = await glob(patterns, {
        cwd: dirPath,
        absolute: true,
        caseSensitiveMatch: false
      });

      for (const filePath of files) {
        await this.handleFileAdded(filePath);
      }
      
      return files.length;
    } catch (error) {
      console.error('Error scanning existing files:', error);
      return 0;
    }
  }

  close() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = FileWatcher;
