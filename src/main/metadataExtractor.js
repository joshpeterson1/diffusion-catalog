const exifr = require('exifr');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');

class MetadataExtractor {
  constructor(database) {
    this.database = database;
    this.queue = [];
    this.processing = false;
    this.thumbnailDir = path.join(app.getPath('userData'), 'thumbnails');
    this.ensureThumbnailDir();
  }

  async ensureThumbnailDir() {
    try {
      await fs.mkdir(this.thumbnailDir, { recursive: true });
    } catch (error) {
      console.error('Error creating thumbnail directory:', error);
    }
  }

  queueImage(imageId, filePath) {
    this.queue.push({ imageId, filePath });
    if (!this.processing) {
      this.processQueue();
    }
  }

  async processQueue() {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const { imageId, filePath } = this.queue.shift();
      try {
        await this.extractMetadata(imageId, filePath);
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
      }
    }
    
    this.processing = false;
  }

  async extractMetadata(imageId, filePath) {
    try {
      // Extract EXIF data
      const exifData = await exifr.parse(filePath, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'ImageWidth', 'ImageHeight', 'UserComment', 'ImageDescription']
      });

      // Get image dimensions using Sharp
      const metadata = await sharp(filePath).metadata();
      
      // Generate thumbnail
      const thumbnailPath = await this.generateThumbnail(imageId, filePath);
      
      // Update image record with extracted data
      const updateStmt = this.database.db.prepare(`
        UPDATE images 
        SET date_taken = ?, width = ?, height = ?, thumbnail_path = ?
        WHERE id = ?
      `);
      
      const dateTaken = this.extractDateTaken(exifData);
      updateStmt.run(dateTaken, metadata.width, metadata.height, thumbnailPath, imageId);
      
      // Extract AI metadata if present
      const aiMetadata = this.extractAiMetadata(exifData, filePath);
      if (aiMetadata) {
        await this.database.addAiMetadata(imageId, aiMetadata);
      }
      
    } catch (error) {
      console.error(`Error extracting metadata for ${filePath}:`, error);
    }
  }

  extractDateTaken(exifData) {
    if (!exifData) return null;
    
    // Try different date fields in order of preference
    const dateFields = ['DateTimeOriginal', 'CreateDate', 'ModifyDate'];
    for (const field of dateFields) {
      if (exifData[field]) {
        return exifData[field].toISOString();
      }
    }
    return null;
  }

  extractAiMetadata(exifData, filePath) {
    if (!exifData) return null;
    
    let aiData = {};
    
    // Check common AI metadata locations
    const textFields = [exifData.UserComment, exifData.ImageDescription];
    
    for (const text of textFields) {
      if (text && typeof text === 'string') {
        // Parse common AI generation formats
        aiData = this.parseAiText(text);
        if (Object.keys(aiData).length > 0) {
          break;
        }
      }
    }
    
    // For PNG files, check text chunks (would need additional parsing)
    if (path.extname(filePath).toLowerCase() === '.png') {
      // PNG text chunk parsing would go here
      // This requires additional PNG parsing logic
    }
    
    return Object.keys(aiData).length > 0 ? aiData : null;
  }

  parseAiText(text) {
    const aiData = {};
    
    // Common patterns for AI metadata
    const patterns = {
      prompt: /(?:^|\n)(?:Prompt|prompt):\s*(.+?)(?:\n|$)/i,
      negativePrompt: /(?:^|\n)(?:Negative prompt|negative_prompt):\s*(.+?)(?:\n|$)/i,
      model: /(?:^|\n)(?:Model|model):\s*(.+?)(?:\n|$)/i,
      steps: /(?:^|\n)(?:Steps|steps):\s*(\d+)/i,
      cfgScale: /(?:^|\n)(?:CFG Scale|cfg_scale):\s*([\d.]+)/i,
      seed: /(?:^|\n)(?:Seed|seed):\s*(\d+)/i,
      sampler: /(?:^|\n)(?:Sampler|sampler):\s*(.+?)(?:\n|$)/i
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match) {
        let value = match[1].trim();
        if (key === 'steps' || key === 'seed') {
          value = parseInt(value);
        } else if (key === 'cfgScale') {
          value = parseFloat(value);
        }
        aiData[key] = value;
      }
    }
    
    return aiData;
  }

  async generateThumbnail(imageId, filePath) {
    const thumbnailFilename = `thumb_${imageId}.webp`;
    const thumbnailPath = path.join(this.thumbnailDir, thumbnailFilename);
    
    try {
      await sharp(filePath)
        .resize(300, 300, { 
          fit: 'cover',
          position: 'center'
        })
        .webp({ quality: 80 })
        .toFile(thumbnailPath);
        
      return thumbnailPath;
    } catch (error) {
      console.error(`Error generating thumbnail for ${filePath}:`, error);
      return null;
    }
  }
}

module.exports = MetadataExtractor;
