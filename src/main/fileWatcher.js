const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;
const yauzl = require('yauzl');
const { promisify } = require('util');

class FileWatcher {
  constructor(database, metadataExtractor, mainWindow = null) {
    this.database = database;
    this.metadataExtractor = metadataExtractor;
    this.mainWindow = mainWindow;
    this.watchers = new Map();
    this.supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp']);
    this.supportedArchives = new Set(['.zip']);
    this.vitals = {
      lastScanStartTime: null,
      lastScanEndTime: null,
      lastScanDuration: null,
      lastScanFileCount: 0,
      totalScansPerformed: 0,
      averageScanTime: 0,
      totalScanTime: 0
    };
  }

  async addDirectory(dirPath) {
    if (this.watchers.has(dirPath)) {
      return { success: false, message: 'Path already being watched' };
    }

    try {
      // Start timing
      const scanStartTime = Date.now();
      this.vitals.lastScanStartTime = scanStartTime;
      
      // Verify path exists
      await fs.access(dirPath);
      
      const stats = await fs.stat(dirPath);
      let fileCount = 0;
      
      if (stats.isDirectory()) {
        // Handle directory
        console.log(`Scanning existing files in directory ${dirPath}...`);
        fileCount = await this.scanExistingFiles(dirPath);
        console.log(`Found ${fileCount} files`);
        
        // Create watcher for directory
        const watcher = chokidar.watch(dirPath, {
          ignored: /(^|[\/\\])\../, // ignore dotfiles
          persistent: true,
          ignoreInitial: true // We already scanned, so ignore initial events
        });

        // Set up event handlers
        watcher
          .on('add', (filePath) => {
            console.log(`WATCHER ADD: ${filePath}`);
            this.handleFileAdded(filePath);
          })
          .on('unlink', (filePath) => {
            console.log(`WATCHER UNLINK: ${filePath}`);
            this.handleFileRemoved(filePath);
          })
          .on('error', (error) => console.error('Watcher error:', error));

        this.watchers.set(dirPath, watcher);
      } else if (stats.isFile() && path.extname(dirPath).toLowerCase() === '.zip') {
        // Handle single ZIP file
        console.log(`Processing single ZIP file: ${dirPath}`);
        await this.handleArchiveFile(dirPath);
        fileCount = 1;
        
        // For ZIP files, we don't need a watcher since they don't change
        this.watchers.set(dirPath, null);
      } else {
        return { success: false, message: 'Selected path must be a directory or ZIP file' };
      }
      
      // End timing and update vitals
      const scanEndTime = Date.now();
      const scanDuration = scanEndTime - scanStartTime;
      
      this.vitals.lastScanEndTime = scanEndTime;
      this.vitals.lastScanDuration = scanDuration;
      this.vitals.lastScanFileCount = fileCount;
      this.vitals.totalScansPerformed++;
      this.vitals.totalScanTime += scanDuration;
      this.vitals.averageScanTime = this.vitals.totalScanTime / this.vitals.totalScansPerformed;
      
      console.log(`Scan completed in ${scanDuration}ms for ${fileCount} files`);
      
      return { 
        success: true, 
        message: `Path added successfully. Found ${fileCount} files in ${scanDuration}ms.` 
      };
    } catch (error) {
      console.error('Error adding directory/file:', error);
      return { success: false, message: `Failed to add path: ${error.message}` };
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
    
    if (this.supportedExtensions.has(ext)) {
      await this.handleImageFile(filePath);
    } else if (this.supportedArchives.has(ext)) {
      await this.handleArchiveFile(filePath);
    }
  }

  async handleImageFile(filePath) {
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
        dateTaken: stats.mtime.toISOString(), // Convert Date to ISO string
        width: null,
        height: null,
        hash: null,
        isArchive: false
      };

      const imageId = await this.database.addImage(imageData);
      
      // Queue for metadata extraction
      this.metadataExtractor.queueImage(imageId, filePath);
      
      // Notify frontend that photos were updated
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('photos-updated');
      }
      
    } catch (error) {
      console.error('Error handling image file:', error);
    }
  }

  async handleArchiveFile(filePath) {
    try {
      console.log(`Processing ZIP archive: ${filePath}`);
      const images = await this.extractImageListFromZip(filePath);
      console.log(`ZIP contains ${images.length} image entries`);
      
      let addedCount = 0;
      for (const imageInfo of images) {
        const archiveImagePath = `${filePath}::${imageInfo.entryName}`;
        
        // Check if this archive entry already exists
        const existing = this.database.db.prepare('SELECT id FROM images WHERE path = ?').get(archiveImagePath);
        if (existing) {
          console.log(`Skipping existing entry: ${imageInfo.entryName}`);
          continue;
        }

        console.log(`Adding ZIP entry: ${imageInfo.entryName}`);
        const imageId = await this.database.addImage({
          path: archiveImagePath,
          filename: imageInfo.filename,
          fileSize: imageInfo.uncompressedSize || 0,
          dateTaken: null,
          width: null,
          height: null,
          hash: null,
          isArchive: true,
          archivePath: filePath
        });

        // Queue for metadata extraction
        this.metadataExtractor.queueImage(imageId, archiveImagePath);
        addedCount++;
      }
      
      // Notify frontend that photos were updated (only if we added new images)
      if (addedCount > 0 && this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('photos-updated');
      }
      
      console.log(`Added ${addedCount} new images from ZIP: ${path.basename(filePath)}`);
    } catch (error) {
      console.error('Error handling archive file:', error);
      throw error;
    }
  }

  async extractImageListFromZip(zipPath) {
    return new Promise((resolve, reject) => {
      const images = [];
      
      console.log(`Opening ZIP file: ${zipPath}`);
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          console.error('Error opening ZIP file:', err);
          return reject(err);
        }
        
        console.log('ZIP file opened successfully, reading entries...');
        zipfile.readEntry();
        
        zipfile.on('entry', (entry) => {
          console.log(`ZIP entry: ${entry.fileName}`);
          const entryExt = path.extname(entry.fileName).toLowerCase();
          
          if (this.supportedExtensions.has(entryExt) && !entry.fileName.endsWith('/')) {
            console.log(`Found image: ${entry.fileName}`);
            images.push({
              entryName: entry.fileName,
              filename: path.basename(entry.fileName),
              uncompressedSize: entry.uncompressedSize
            });
          }
          
          zipfile.readEntry();
        });
        
        zipfile.on('end', () => {
          console.log(`ZIP scan complete. Found ${images.length} images.`);
          resolve(images);
        });
        
        zipfile.on('error', (err) => {
          console.error('ZIP file error:', err);
          reject(err);
        });
      });
    });
  }

  async handleFileRemoved(filePath) {
    try {
      console.log(`FILE REMOVED EVENT: ${filePath}`);
      
      // Normalize path to forward slashes for database consistency
      const normalizedPath = filePath.replace(/\\/g, '/');
      console.log(`Normalized path: ${normalizedPath}`);
      
      // Check if file exists in database first (try both formats)
      let existing = this.database.db.prepare('SELECT id, path FROM images WHERE path = ?').get(filePath);
      if (!existing) {
        existing = this.database.db.prepare('SELECT id, path FROM images WHERE path = ?').get(normalizedPath);
      }
      console.log(`Database lookup for removed file:`, existing);
      
      // Remove from database (try both formats)
      const stmt = this.database.db.prepare('DELETE FROM images WHERE path = ? OR path = ?');
      const result = stmt.run(filePath, normalizedPath);
      
      console.log(`Delete result: ${result.changes} rows affected`);
      
      // Only notify if we actually removed something
      if (result.changes > 0) {
        console.log(`Successfully removed file from database: ${filePath}`);
        
        // Notify frontend that photos were updated
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('photos-updated');
        }
      } else {
        console.log(`No database entry found for removed file: ${filePath}`);
      }
    } catch (error) {
      console.error('Error handling file removed:', error);
    }
  }

  async scanExistingFiles(dirPath) {
    const glob = require('fast-glob');
    const imagePatterns = Array.from(this.supportedExtensions).map(ext => `**/*${ext}`);
    const archivePatterns = Array.from(this.supportedArchives).map(ext => `**/*${ext}`);
    const allPatterns = [...imagePatterns, ...archivePatterns];
    
    try {
      const files = await glob(allPatterns, {
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

  getVitals() {
    return {
      ...this.vitals,
      lastScanStartTime: this.vitals.lastScanStartTime ? new Date(this.vitals.lastScanStartTime).toISOString() : null,
      lastScanEndTime: this.vitals.lastScanEndTime ? new Date(this.vitals.lastScanEndTime).toISOString() : null,
      lastScanDurationFormatted: this.vitals.lastScanDuration ? `${this.vitals.lastScanDuration}ms` : null,
      averageScanTimeFormatted: this.vitals.averageScanTime ? `${Math.round(this.vitals.averageScanTime)}ms` : null,
      totalScanTimeFormatted: this.vitals.totalScanTime ? `${this.vitals.totalScanTime}ms` : null
    };
  }

  close() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = FileWatcher;
