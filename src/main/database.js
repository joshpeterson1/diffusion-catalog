const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

class DatabaseManager {
  constructor() {
    this.db = null;
  }

  async initialize() {
    const dbPath = path.join(app.getPath('userData'), 'photo-catalog.db');
    this.db = new Database(dbPath);
    
    // Enable WAL mode for better performance
    this.db.pragma('journal_mode = WAL');
    
    this.createTables();
    this.createIndexes();
  }

  createTables() {
    // Core image data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        date_taken DATETIME,
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        thumbnail_path TEXT,
        hash TEXT
      )
    `);

    // User annotations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_metadata (
        image_id INTEGER PRIMARY KEY,
        is_favorite BOOLEAN DEFAULT FALSE,
        is_nsfw BOOLEAN DEFAULT FALSE,
        custom_tags TEXT,
        rating INTEGER,
        notes TEXT,
        FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
      )
    `);

    // AI metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_metadata (
        image_id INTEGER PRIMARY KEY,
        prompt TEXT,
        negative_prompt TEXT,
        model TEXT,
        steps INTEGER,
        cfg_scale REAL,
        seed INTEGER,
        sampler TEXT,
        scheduler TEXT,
        FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
      )
    `);

    // Watch directories
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watch_directories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        recursive BOOLEAN DEFAULT TRUE,
        active BOOLEAN DEFAULT TRUE,
        date_added DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  createIndexes() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_images_date_taken ON images (date_taken DESC);
      CREATE INDEX IF NOT EXISTS idx_images_date_added ON images (date_added DESC);
      CREATE INDEX IF NOT EXISTS idx_images_filename ON images (filename);
      CREATE INDEX IF NOT EXISTS idx_user_metadata_favorite ON user_metadata (is_favorite);
      CREATE INDEX IF NOT EXISTS idx_user_metadata_nsfw ON user_metadata (is_nsfw);
      CREATE INDEX IF NOT EXISTS idx_ai_metadata_model ON ai_metadata (model);
    `);
  }

  async addImage(imageData) {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO images 
        (path, filename, date_taken, file_size, width, height, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        imageData.path,
        imageData.filename,
        imageData.dateTaken,
        imageData.fileSize,
        imageData.width,
        imageData.height,
        imageData.hash
      );
      
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Error adding image to database:', error);
      throw error;
    }
  }

  async getPhotos(options = {}) {
    console.log('DATABASE getPhotos called with options:', JSON.stringify(options, null, 2));
    
    const {
      limit = 200,
      offset = 0,
      selectedFolders = [],
      sortBy = 'date_taken',
      sortOrder = 'DESC',
      isFavorite
    } = options;

    console.log('isFavorite value:', isFavorite, 'type:', typeof isFavorite);
    console.log('selectedFolders:', selectedFolders);

    let query, params = [];

    if (isFavorite === true) {
      console.log('BUILDING FAVORITES QUERY WITH INNER JOIN');
      // When filtering for favorites, use INNER JOIN
      query = `
        SELECT i.*, 
               u.is_favorite, 
               u.is_nsfw, 
               u.custom_tags, 
               u.rating
        FROM images i
        INNER JOIN user_metadata u ON i.id = u.image_id
        WHERE u.is_favorite = 1
      `;
    } else {
      console.log('BUILDING ALL PHOTOS QUERY WITH LEFT JOIN');
      // When not filtering for favorites, use LEFT JOIN
      query = `
        SELECT i.*, 
               COALESCE(u.is_favorite, 0) as is_favorite, 
               COALESCE(u.is_nsfw, 0) as is_nsfw, 
               u.custom_tags, 
               u.rating
        FROM images i
        LEFT JOIN user_metadata u ON i.id = u.image_id
        WHERE 1=1
      `;
    }
    
    // Filter by selected folders if any are specified
    if (selectedFolders && selectedFolders.length > 0) {
      const folderConditions = selectedFolders.map(() => 'i.path LIKE ?').join(' OR ');
      query += ` AND (${folderConditions})`;
      selectedFolders.forEach(folder => {
        params.push(`${folder}%`);
      });
      console.log('Added folder filters for:', selectedFolders);
    }

    if (options.excludeNsfw) {
      if (isFavorite === true) {
        // For favorites query, add NSFW exclusion to existing WHERE clause
        query += ' AND (u.is_nsfw IS NULL OR u.is_nsfw = 0)';
      } else {
        // For all photos query, exclude NSFW
        query += ' AND (u.is_nsfw IS NULL OR u.is_nsfw = 0)';
      }
      console.log('Added NSFW exclusion filter');
    }
    
    query += ` ORDER BY i.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    console.log('FINAL QUERY:', query);
    console.log('FINAL PARAMS:', JSON.stringify(params));
    
    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);
    
    console.log(`QUERY RESULTS: ${results.length} rows returned`);
    if (results.length > 0) {
      console.log('First result sample:', {
        id: results[0].id,
        filename: results[0].filename,
        is_favorite: results[0].is_favorite,
        is_nsfw: results[0].is_nsfw
      });
    } else {
      console.log('NO RESULTS RETURNED FROM QUERY');
    }
    
    return results;
  }

  async searchPhotos(searchQuery, filters = {}) {
    let query = `
      SELECT i.*, u.is_favorite, u.is_nsfw, u.custom_tags, u.rating,
             ai.prompt, ai.model
      FROM images i
      LEFT JOIN user_metadata u ON i.id = u.image_id
      LEFT JOIN ai_metadata ai ON i.id = ai.image_id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (searchQuery) {
      query += ` AND (
        i.filename LIKE ? OR 
        u.custom_tags LIKE ? OR 
        ai.prompt LIKE ? OR 
        ai.model LIKE ?
      )`;
      const searchTerm = `%${searchQuery}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    if (filters.isFavorite !== undefined) {
      query += ' AND u.is_favorite = ?';
      params.push(filters.isFavorite ? 1 : 0);
    }
    
    if (filters.isNsfw !== undefined) {
      query += ' AND u.is_nsfw = ?';
      params.push(filters.isNsfw ? 1 : 0);
    }
    
    query += ' ORDER BY i.date_taken DESC LIMIT 500';
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  async updateUserMetadata(imageId, metadata) {
    try {
      // Validate inputs
      if (!imageId || typeof imageId !== 'number') {
        throw new Error('Invalid image ID');
      }

      if (metadata.rating && (metadata.rating < 1 || metadata.rating > 5)) {
        throw new Error('Rating must be between 1 and 5');
      }

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO user_metadata 
        (image_id, is_favorite, is_nsfw, custom_tags, rating, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      return stmt.run(
        imageId,
        metadata.isFavorite ? 1 : 0,  // Convert boolean to integer
        metadata.isNsfw ? 1 : 0,      // Convert boolean to integer
        metadata.customTags || null,
        metadata.rating || null,
        metadata.notes || null
      );
    } catch (error) {
      console.error('Error updating user metadata:', error);
      throw error;
    }
  }

  async addAiMetadata(imageId, aiData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ai_metadata 
      (image_id, prompt, negative_prompt, model, steps, cfg_scale, seed, sampler, scheduler)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(
      imageId,
      aiData.prompt,
      aiData.negativePrompt,
      aiData.model,
      aiData.steps,
      aiData.cfgScale,
      aiData.seed,
      aiData.sampler,
      aiData.scheduler
    );
  }

  async getPhotoMetadata(imageId) {
    const stmt = this.db.prepare(`
      SELECT i.*, u.*, ai.*
      FROM images i
      LEFT JOIN user_metadata u ON i.id = u.image_id
      LEFT JOIN ai_metadata ai ON i.id = ai.image_id
      WHERE i.id = ?
    `);
    
    return stmt.get(imageId);
  }

  async clearAll() {
    try {
      this.db.exec('DELETE FROM user_metadata');
      this.db.exec('DELETE FROM ai_metadata');
      this.db.exec('DELETE FROM images');
      this.db.exec('DELETE FROM watch_directories');
      return { success: true, message: 'Database cleared successfully' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getSubfolders() {
    try {
      // Get all unique directory paths from images
      const stmt = this.db.prepare(`
        SELECT DISTINCT 
          SUBSTR(path, 1, LENGTH(path) - LENGTH(filename) - 1) as folder_path,
          COUNT(*) as image_count
        FROM images 
        GROUP BY folder_path
        ORDER BY folder_path
      `);
      
      const folders = stmt.all();
      
      // Process folders to extract meaningful subfolder names
      const subfolders = folders.map(folder => {
        const parts = folder.folder_path.split(/[\/\\]/);
        const folderName = parts[parts.length - 1] || parts[parts.length - 2];
        
        return {
          name: folderName,
          path: folder.folder_path,
          imageCount: folder.image_count
        };
      }).filter(folder => folder.name && folder.name.trim() !== '');
      
      return subfolders;
    } catch (error) {
      console.error('Error getting subfolders:', error);
      return [];
    }
  }

  async debugInfo() {
    try {
      const imageCount = this.db.prepare('SELECT COUNT(*) as count FROM images').get();
      const userMetaCount = this.db.prepare('SELECT COUNT(*) as count FROM user_metadata').get();
      const favoriteCount = this.db.prepare('SELECT COUNT(*) as count FROM user_metadata WHERE is_favorite = 1').get();
      
      const sampleImages = this.db.prepare('SELECT id, filename, date_taken FROM images LIMIT 5').all();
      const sampleUserMeta = this.db.prepare('SELECT image_id, is_favorite, is_nsfw FROM user_metadata LIMIT 5').all();
      
      return {
        imageCount: imageCount.count,
        userMetaCount: userMetaCount.count,
        favoriteCount: favoriteCount.count,
        sampleImages,
        sampleUserMeta
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = DatabaseManager;
