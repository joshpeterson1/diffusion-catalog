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
      // Extract comprehensive EXIF data
      const exifData = await exifr.parse(filePath);
      
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
        console.log(`Saving AI metadata for ${path.basename(filePath)}:`, aiMetadata);
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
    
    // Check all possible EXIF fields that might contain AI metadata
    const textFields = [
      exifData.Parameters,        // Put Parameters first since that's where AI data usually is
      exifData.UserComment,
      exifData.ImageDescription,
      exifData.Software,
      exifData.Artist,
      exifData.Copyright,
      exifData.XPComment,
      exifData.XPKeywords,
      exifData.prompt,
      exifData.workflow,
      exifData.Comment
    ];
    
    // Try to parse AI data from each field
    for (const text of textFields) {
      if (text && typeof text === 'string') {
        const parsedData = this.parseAiText(text);
        if (Object.keys(parsedData).length > 0) {
          // Merge parsed data, giving priority to first found values
          aiData = { ...parsedData, ...aiData };
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
    
    // Enhanced patterns for AI metadata - more comprehensive matching
    const patterns = {
      prompt: [
        /(?:^|\n)(?:Prompt|prompt):\s*(.+?)(?:\n(?:[A-Z][a-z]+:|$)|$)/is,
        /(?:^|\n)(?:Positive prompt|positive_prompt):\s*(.+?)(?:\n(?:[A-Z][a-z]+:|$)|$)/is,
        /^(.+?)(?:\nNegative prompt:|$)/is // Fallback: everything before "Negative prompt:"
      ],
      negativePrompt: [
        /(?:^|\n)(?:Negative prompt|negative_prompt):\s*(.+?)(?:\n(?:[A-Z][a-z]+:|$)|$)/is,
        /(?:^|\n)(?:Negative|neg):\s*(.+?)(?:\n(?:[A-Z][a-z]+:|$)|$)/is
      ],
      model: [
        /(?:^|\n)(?:Model|model):\s*(.+?)(?:\n|,|$)/i,
        /(?:^|\n)(?:Model hash|model_hash):\s*(.+?)(?:\n|,|$)/i,
        /(?:^|\n)(?:Checkpoint|checkpoint):\s*(.+?)(?:\n|,|$)/i
      ],
      steps: [
        /(?:^|\n)(?:Steps|steps):\s*(\d+)/i,
        /(?:^|\n)(?:Sampling steps|sampling_steps):\s*(\d+)/i
      ],
      cfgScale: [
        /(?:^|\n)(?:CFG Scale|cfg_scale|CFG|cfg):\s*([\d.]+)/i,
        /(?:^|\n)(?:Guidance scale|guidance_scale):\s*([\d.]+)/i
      ],
      seed: [
        /(?:^|\n)(?:Seed|seed):\s*(-?\d+)/i
      ],
      sampler: [
        /(?:^|\n)(?:Sampler|sampler):\s*(.+?)(?:\n|,|$)/i,
        /(?:^|\n)(?:Sampling method|sampling_method):\s*(.+?)(?:\n|,|$)/i
      ],
      scheduler: [
        /(?:^|\n)(?:Schedule type|schedule_type|Scheduler|scheduler):\s*(.+?)(?:\n|,|$)/i
      ],
      size: [
        /(?:^|\n)(?:Size|size):\s*(\d+x\d+)/i,
        /(?:^|\n)(?:Resolution|resolution):\s*(\d+x\d+)/i
      ]
    };
    
    // Try each pattern for each field
    for (const [key, patternArray] of Object.entries(patterns)) {
      for (const pattern of patternArray) {
        const match = text.match(pattern);
        if (match && !aiData[key]) { // Only set if not already found
          let value = match[1].trim();
          
          // Clean up common artifacts
          value = value.replace(/,$/, ''); // Remove trailing comma
          value = value.replace(/\s+/g, ' '); // Normalize whitespace
          
          // Type conversion
          if (key === 'steps' || key === 'seed') {
            value = parseInt(value);
          } else if (key === 'cfgScale') {
            value = parseFloat(value);
          }
          
          if (value !== '' && !isNaN(value) || typeof value === 'string') {
            aiData[key] = value;
          }
          break; // Found a match, move to next field
        }
      }
    }
    
    return aiData;
  }

  async generateThumbnail(imageId, filePath) {
    const thumbnailFilename = `thumb_${imageId}.webp`;
    const thumbnailPath = path.join(this.thumbnailDir, thumbnailFilename);
    
    try {
      // Check if thumbnail already exists
      try {
        await fs.access(thumbnailPath);
        return thumbnailPath; // Thumbnail already exists
      } catch {
        // Thumbnail doesn't exist, create it
      }

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
      // Return original file path as fallback
      return filePath;
    }
  }
}

module.exports = MetadataExtractor;
