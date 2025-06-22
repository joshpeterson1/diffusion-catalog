const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs').promises;
const yauzl = require('yauzl');
const { promisify } = require('util');

class FileWatcher {
  constructor(database, metadataExtractor) {
    this.database = database;
    this.metadataExtractor = metadataExtractor;
    this.watchers = new Map();
    this.supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp']);
    this.supportedArchives = new Set(['.zip']);
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
      
    } catch (error) {
      console.error('Error handling image file:', error);
    }
  }

  async handleArchiveFile(filePath) {
    try {
      console.log(`Processing ZIP archive: ${filePath}`);
      const images = await this.extractImageListFromZip(filePath);
      
      for (const imageInfo of images) {
        const archiveImagePath = `${filePath}::${imageInfo.entryName}`;
        
        // Check if this archive entry already exists
        const existing = this.database.db.prepare('SELECT id FROM images WHERE path = ?').get(archiveImagePath);
        if (existing) {
          continue;
        }

        const imageId = await this.database.addImage({
          path: archiveImagePath,
          filename: imageInfo.filename,
          fileSize: imageInfo.uncompressedSize,
          dateTaken: null,
          width: null,
          height: null,
          hash: null,
          isArchive: true,
          archivePath: filePath
        });

        // Queue for metadata extraction
        this.metadataExtractor.queueImage(imageId, archiveImagePath);
      }
      
      console.log(`Found ${images.length} images in ZIP: ${path.basename(filePath)}`);
    } catch (error) {
      console.error('Error handling archive file:', error);
    }
  }

  async extractImageListFromZip(zipPath) {
    return new Promise((resolve, reject) => {
      const images = [];
      
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);
        
        zipfile.readEntry();
        
        zipfile.on('entry', (entry) => {
          const entryExt = path.extname(entry.fileName).toLowerCase();
          
          if (this.supportedExtensions.has(entryExt) && !entry.fileName.endsWith('/')) {
            images.push({
              entryName: entry.fileName,
              filename: path.basename(entry.fileName),
              uncompressedSize: entry.uncompressedSize
            });
          }
          
          zipfile.readEntry();
        });
        
        zipfile.on('end', () => {
          resolve(images);
        });
        
        zipfile.on('error', reject);
      });
    });
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

  close() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = FileWatcher;
