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
  }

  async getPhotos(options = {}) {
    const {
      limit = 200,
      offset = 0,
      startDate,
      endDate,
      sortBy = 'date_taken',
      sortOrder = 'DESC',
      isFavorite
    } = options;

    let query = `
      SELECT i.*, u.is_favorite, u.is_nsfw, u.custom_tags, u.rating
      FROM images i
      LEFT JOIN user_metadata u ON i.id = u.image_id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (startDate) {
      query += ' AND i.date_taken >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND i.date_taken <= ?';
      params.push(endDate);
    }
    
    if (isFavorite !== undefined) {
      query += ' AND u.is_favorite = ?';
      params.push(isFavorite ? 1 : 0);
    }
    
    query += ` ORDER BY i.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
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

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = DatabaseManager;
