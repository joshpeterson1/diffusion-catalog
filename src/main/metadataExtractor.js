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
      console.log(`Extracting metadata for: ${path.basename(filePath)}`);
      
      // Extract comprehensive EXIF data with more options
      const exifData = await exifr.parse(filePath, {
        tiff: true,
        exif: true,
        gps: true,
        interop: true,
        ifd0: true,
        ifd1: true,
        iptc: true,
        icc: true,
        jfif: true,
        ihdr: true,
        iptc: true,
        xmp: true,
        chunked: true,
        mergeOutput: true
      });
      
      console.log(`EXIF data found:`, exifData ? Object.keys(exifData).length : 0, 'fields');
      if (exifData) {
        console.log('Sample EXIF fields:', Object.keys(exifData).slice(0, 10));
      }
      
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
      console.log(`Date taken extracted: ${dateTaken}`);
      updateStmt.run(dateTaken, metadata.width, metadata.height, thumbnailPath, imageId);
      
      // Extract AI metadata if present
      const aiMetadata = this.extractAiMetadata(exifData, filePath);
      if (aiMetadata) {
        console.log(`Saving AI metadata for ${path.basename(filePath)}:`, JSON.stringify(aiMetadata, null, 2));
        await this.database.addAiMetadata(imageId, aiMetadata);
      } else {
        console.log(`No AI metadata found for ${path.basename(filePath)}`);
      }
      
    } catch (error) {
      console.error(`Error extracting metadata for ${filePath}:`, error);
    }
  }

  extractDateTaken(exifData) {
    if (!exifData) {
      console.log('No EXIF data for date extraction');
      return null;
    }
    
    // Try different date fields in order of preference
    const dateFields = [
      'DateTimeOriginal', 
      'CreateDate', 
      'ModifyDate',
      'DateTime',
      'DateTimeDigitized'
    ];
    
    console.log('Available EXIF date fields:', dateFields.filter(field => exifData[field]));
    
    for (const field of dateFields) {
      if (exifData[field]) {
        try {
          const date = new Date(exifData[field]);
          if (!isNaN(date.getTime())) {
            console.log(`Using date from ${field}: ${date.toISOString()}`);
            return date.toISOString();
          }
        } catch (error) {
          console.log(`Error parsing date from ${field}:`, error);
        }
      }
    }
    
    console.log('No valid date found in EXIF data');
    return null;
  }

  extractAiMetadata(exifData, filePath) {
    if (!exifData) {
      console.log('No EXIF data for AI metadata extraction');
      return null;
    }
    
    console.log('Checking for AI metadata in EXIF fields...');
    let aiData = {};
    
    // Check all possible EXIF fields that might contain AI metadata
    const textFields = [
      { name: 'Parameters', value: exifData.Parameters },
      { name: 'UserComment', value: exifData.UserComment },
      { name: 'ImageDescription', value: exifData.ImageDescription },
      { name: 'Software', value: exifData.Software },
      { name: 'Artist', value: exifData.Artist },
      { name: 'Copyright', value: exifData.Copyright },
      { name: 'XPComment', value: exifData.XPComment },
      { name: 'XPKeywords', value: exifData.XPKeywords },
      { name: 'prompt', value: exifData.prompt },
      { name: 'workflow', value: exifData.workflow },
      { name: 'Comment', value: exifData.Comment }
    ];
    
    // Log which fields have data
    const fieldsWithData = textFields.filter(field => field.value);
    console.log('EXIF fields with text data:', fieldsWithData.map(f => f.name));
    
    // Try to parse AI data from each field
    for (const field of textFields) {
      if (field.value && typeof field.value === 'string') {
        console.log(`Parsing AI data from ${field.name}: ${field.value.substring(0, 100)}...`);
        const parsedData = this.parseAiText(field.value);
        if (Object.keys(parsedData).length > 0) {
          console.log(`Found AI data in ${field.name}:`, parsedData);
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
