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
      return { success: false, message: 'Path already being watched' };
    }

    try {
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
          .on('add', (filePath) => this.handleFileAdded(filePath))
          .on('unlink', (filePath) => this.handleFileRemoved(filePath))
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
      
      return { 
        success: true, 
        message: `Path added successfully. Found ${fileCount} files.` 
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
        addedCount++;
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
