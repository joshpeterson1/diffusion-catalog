const exifr = require('exifr');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const yauzl = require('yauzl');

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
      let imageBuffer, metadata, dateCreated;
      
      if (filePath.includes('::')) {
        // Handle ZIP archive entry
        const [zipPath, entryName] = filePath.split('::');
        imageBuffer = await this.extractImageFromZip(zipPath, entryName);
        
        // Get ZIP file stats for date
        const zipStats = await fs.stat(zipPath);
        dateCreated = zipStats.birthtime.toISOString();
        
        // Process buffer with Sharp
        metadata = await sharp(imageBuffer).metadata();
      } else {
        // Handle regular file
        const fileStats = await fs.stat(filePath);
        dateCreated = fileStats.birthtime.toISOString();
        metadata = await sharp(filePath).metadata();
        imageBuffer = await fs.readFile(filePath);
      }
      
      // Extract EXIF data from buffer
      const exifData = await exifr.parse(imageBuffer, {
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
        xmp: true,
        chunked: true,
        mergeOutput: true
      });
      
      // Generate thumbnail
      const thumbnailPath = await this.generateThumbnail(imageId, imageBuffer, filePath);
      
      // Update image record with extracted data
      const updateStmt = this.database.db.prepare(`
        UPDATE images 
        SET date_taken = ?, width = ?, height = ?, thumbnail_path = ?
        WHERE id = ?
      `);
      
      updateStmt.run(dateCreated, metadata.width, metadata.height, thumbnailPath, imageId);
      
      // Extract AI metadata if present
      const aiMetadata = this.extractAiMetadata(exifData, filePath);
      if (aiMetadata || exifData) {
        // Always store raw EXIF data if available, even if no AI metadata is parsed
        const aiDataToStore = aiMetadata || {};
        
        // Add raw EXIF data, filtering out large binary data to save space
        if (exifData) {
          const filteredExifData = this.filterExifData(exifData);
          aiDataToStore.rawExifData = JSON.stringify(filteredExifData);
        }
        
        await this.database.addAiMetadata(imageId, aiDataToStore);
      }
      
    } catch (error) {
      console.error(`Error extracting metadata for ${filePath}:`, error);
    }
  }

  async extractImageFromZip(zipPath, entryName) {
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);
        
        zipfile.readEntry();
        
        zipfile.on('entry', (entry) => {
          if (entry.fileName === entryName) {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) return reject(err);
              
              const chunks = [];
              readStream.on('data', chunk => chunks.push(chunk));
              readStream.on('end', () => resolve(Buffer.concat(chunks)));
              readStream.on('error', reject);
            });
          } else {
            zipfile.readEntry();
          }
        });
        
        zipfile.on('end', () => {
          reject(new Error(`Entry ${entryName} not found in ZIP`));
        });
      });
    });
  }

  // New method to extract raw EXIF data on demand
  async extractRawExifData(filePath) {
    console.log(`EXTRACTING RAW EXIF for: ${filePath}`);
    try {
      let imageBuffer;
      
      if (filePath.includes('::')) {
        // Handle ZIP archive entry
        const [zipPath, entryName] = filePath.split('::');
        imageBuffer = await this.extractImageFromZip(zipPath, entryName);
      } else {
        // Handle regular file
        imageBuffer = await fs.readFile(filePath);
      }
      
      const exifData = await exifr.parse(imageBuffer, {
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
        xmp: true,
        chunked: true,
        mergeOutput: true
      });
      
      console.log(`RAW EXIF RESULT:`, exifData ? Object.keys(exifData).length + ' fields found' : 'No EXIF data');
      if (exifData && exifData.parameters) {
        console.log(`parameters field found, length: ${exifData.parameters.length}`);
      }
      
      return exifData || {};
    } catch (error) {
      console.error(`Error extracting raw EXIF data for ${filePath}:`, error);
      return {};
    }
  }

  extractDateTaken(exifData) {
    if (!exifData) return null;
    
    // Try different date fields in order of preference
    const dateFields = [
      'DateTimeOriginal', 
      'CreateDate', 
      'ModifyDate',
      'DateTime',
      'DateTimeDigitized'
    ];
    
    for (const field of dateFields) {
      if (exifData[field]) {
        try {
          const date = new Date(exifData[field]);
          if (!isNaN(date.getTime())) {
            return date.toISOString();
          }
        } catch (error) {
          // Continue to next field
        }
      }
    }
    
    return null;
  }

  extractAiMetadata(exifData, filePath) {
    if (!exifData) return null;
    
    let aiData = {};
    
    // Debug: Log what EXIF fields we have
    if (path.basename(filePath).includes('00000-3604720350')) {
      console.log('DEBUG: EXIF fields for sample image:', Object.keys(exifData));
      if (exifData.Parameters) {
        console.log('DEBUG: Parameters field length:', exifData.Parameters.length);
        console.log('DEBUG: Parameters preview:', exifData.Parameters.substring(0, 200) + '...');
      }
    }
    
    // Check all possible EXIF fields that might contain AI metadata
    const textFields = [
      exifData.parameters,  // lowercase - this is the correct field name
      exifData.Parameters,  // uppercase - keep as fallback
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
          // Debug: Log successful parsing
          if (path.basename(filePath).includes('00000-3604720350')) {
            console.log('DEBUG: Successfully parsed AI data:', parsedData);
          }
          // Merge parsed data, giving priority to first found values
          aiData = { ...parsedData, ...aiData };
        }
      }
    }
    
    return Object.keys(aiData).length > 0 ? aiData : null;
  }

  filterExifData(exifData) {
    // Create a filtered copy of EXIF data, excluding large binary fields
    const filtered = {};
    const excludeFields = [
      'thumbnail', 'Thumbnail', 'ThumbnailImage',
      'PreviewImage', 'JpgFromRaw', 'OtherImage',
      'ICC_Profile', 'ColorSpace', 'WhitePoint',
      'PrimaryChromaticities', 'YCbCrCoefficients',
      'ReferenceBlackWhite', 'PrintIM'
    ];
    
    for (const [key, value] of Object.entries(exifData)) {
      // Skip large binary data and thumbnail images
      if (excludeFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        continue;
      }
      
      // Skip very large values (likely binary data)
      if (typeof value === 'string' && value.length > 10000) {
        continue;
      }
      
      // Skip Buffer objects
      if (Buffer.isBuffer(value)) {
        continue;
      }
      
      // Include the field
      filtered[key] = value;
    }
    
    return filtered;
  }

  parseAiText(text) {
    const aiData = {};
    
    // Handle the specific format from your EXIF data
    // The text contains a long prompt followed by "Negative prompt:" and then parameters
    
    // Extract the main prompt (everything before "Negative prompt:")
    const negativePromptSplit = text.split('Negative prompt:');
    if (negativePromptSplit.length > 0) {
      let prompt = negativePromptSplit[0].trim();
      if (prompt) {
        aiData.prompt = prompt;
      }
    }
    
    // Extract negative prompt and parameters (everything after "Negative prompt:")
    if (negativePromptSplit.length > 1) {
      const afterNegative = negativePromptSplit[1];
      
      // Look for "Steps:" to separate negative prompt from parameters
      const stepsSplit = afterNegative.split(/\s+Steps:/);
      if (stepsSplit.length > 0) {
        let negativePrompt = stepsSplit[0].trim();
        if (negativePrompt) {
          aiData.negativePrompt = negativePrompt;
        }
      }
      
      // Parse parameters from the full text after "Negative prompt:"
      const paramText = afterNegative;
      
      // More flexible patterns to handle the actual format
      const patterns = {
        steps: /Steps:\s*(\d+)/i,
        sampler: /Sampler:\s*([^,]+?)(?:,|\s+[A-Z]|$)/i,
        cfgScale: /CFG scale:\s*([\d.]+)/i,
        seed: /Seed:\s*(\d+)/i,
        size: /Size:\s*(\d+x\d+)/i,
        model: /Model:\s*([^,]+?)(?:,|\s+[A-Z]|$)/i,
        modelHash: /Model hash:\s*([a-fA-F0-9]+)/i
      };
      
      for (const [key, pattern] of Object.entries(patterns)) {
        const match = paramText.match(pattern);
        if (match) {
          let value = match[1].trim();
          
          // Type conversion
          if (key === 'steps' || key === 'seed') {
            value = parseInt(value);
          } else if (key === 'cfgScale') {
            value = parseFloat(value);
          }
          
          if (value !== '' && (typeof value === 'string' || !isNaN(value))) {
            aiData[key] = value;
          }
        }
      }
    }
    
    return aiData;
  }

  async generateThumbnail(imageId, imageSource, originalPath) {
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

      // imageSource can be either a file path or a Buffer
      await sharp(imageSource)
        .resize(300, 300, { 
          fit: 'cover',
          position: 'center'
        })
        .webp({ quality: 80 })
        .toFile(thumbnailPath);
        
      return thumbnailPath;
    } catch (error) {
      console.error(`Error generating thumbnail for ${originalPath}:`, error);
      // Return original file path as fallback
      return originalPath;
    }
  }
}

module.exports = MetadataExtractor;
