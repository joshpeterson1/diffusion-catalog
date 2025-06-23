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
        hash TEXT,
        is_archive BOOLEAN DEFAULT FALSE,
        archive_path TEXT
      )
    `);

    // Add new columns if they don't exist (for existing databases)
    try {
      this.db.exec(`ALTER TABLE images ADD COLUMN is_archive BOOLEAN DEFAULT FALSE`);
    } catch (error) {
      // Column already exists, ignore
    }
    
    try {
      this.db.exec(`ALTER TABLE images ADD COLUMN archive_path TEXT`);
    } catch (error) {
      // Column already exists, ignore
    }

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
        raw_exif_data TEXT,
        FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
      )
    `);

    // Add raw_exif_data column if it doesn't exist (for existing databases)
    try {
      this.db.exec(`ALTER TABLE ai_metadata ADD COLUMN raw_exif_data TEXT`);
    } catch (error) {
      // Column already exists, ignore
    }

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
        (path, filename, date_taken, file_size, width, height, hash, is_archive, archive_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        imageData.path || '',
        imageData.filename || '',
        imageData.dateTaken || null,
        imageData.fileSize || 0,
        imageData.width || null,
        imageData.height || null,
        imageData.hash || null,
        imageData.isArchive ? 1 : 0,
        imageData.archivePath || null
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
      isFavorite,
      excludeNsfw,
      nsfwOnly
    } = options;

    console.log('isFavorite value:', isFavorite, 'type:', typeof isFavorite);
    console.log('excludeNsfw value:', excludeNsfw, 'type:', typeof excludeNsfw);
    console.log('nsfwOnly value:', nsfwOnly, 'type:', typeof nsfwOnly);
    console.log('selectedFolders:', selectedFolders);

    let query, params = [];

    // Always use LEFT JOIN to ensure we get all images with their metadata
    console.log('BUILDING QUERY WITH LEFT JOIN');
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
    
    // Apply favorite filter if specified
    if (isFavorite === true) {
      query += ' AND COALESCE(u.is_favorite, 0) = 1';
      console.log('Added favorites filter');
    }
    
    // Apply NSFW filter if specified
    if (nsfwOnly === true) {
      query += ' AND COALESCE(u.is_nsfw, 0) = 1';
      console.log('Added NSFW-only filter');
    } else if (excludeNsfw === true) {
      query += ' AND COALESCE(u.is_nsfw, 0) = 0';
      console.log('Added NSFW exclusion filter');
    }
    
    // Filter by selected folders if any are specified
    if (selectedFolders && selectedFolders.length > 0) {
      const folderConditions = selectedFolders.map(() => {
        // Handle both ZIP archives and regular folders
        return '(i.path LIKE ? OR i.archive_path = ?)';
      }).join(' OR ');
      query += ` AND (${folderConditions})`;
      selectedFolders.forEach(folder => {
        if (folder.toLowerCase().endsWith('.zip')) {
          // For ZIP files, match archive_path exactly and path starting with ZIP path
          params.push(`${folder}::%`, folder);
        } else {
          // For regular folders, match path starting with folder path
          params.push(`${folder}%`, folder);
        }
      });
      console.log('Added folder filters for:', selectedFolders);
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
    console.log('SEARCH: Query:', searchQuery, 'Filters:', filters);
    
    let query = `
      SELECT i.*, 
             COALESCE(u.is_favorite, 0) as is_favorite, 
             COALESCE(u.is_nsfw, 0) as is_nsfw, 
             u.custom_tags, 
             u.rating,
             ai.prompt, 
             ai.model
      FROM images i
      LEFT JOIN user_metadata u ON i.id = u.image_id
      LEFT JOIN ai_metadata ai ON i.id = ai.image_id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add search term filter
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
    
    // Apply favorite filter if specified
    if (filters.isFavorite === true) {
      query += ' AND COALESCE(u.is_favorite, 0) = 1';
      console.log('SEARCH: Added favorites filter');
    }
    
    // Apply NSFW filter if specified
    if (filters.nsfwOnly === true) {
      query += ' AND COALESCE(u.is_nsfw, 0) = 1';
      console.log('SEARCH: Added NSFW-only filter');
    } else if (filters.excludeNsfw === true) {
      query += ' AND COALESCE(u.is_nsfw, 0) = 0';
      console.log('SEARCH: Added NSFW exclusion filter');
    }
    
    // Filter by selected folders if any are specified
    if (filters.selectedFolders && filters.selectedFolders.length > 0) {
      const folderConditions = filters.selectedFolders.map(() => {
        return '(i.path LIKE ? OR i.archive_path = ?)';
      }).join(' OR ');
      query += ` AND (${folderConditions})`;
      filters.selectedFolders.forEach(folder => {
        if (folder.toLowerCase().endsWith('.zip')) {
          params.push(`${folder}::%`, folder);
        } else {
          params.push(`${folder}%`, folder);
        }
      });
      console.log('SEARCH: Added folder filters for:', filters.selectedFolders);
    }
    
    query += ' ORDER BY i.date_taken DESC LIMIT 500';
    
    console.log('SEARCH: Final query:', query);
    console.log('SEARCH: Final params:', params);
    
    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);
    
    console.log(`SEARCH: Found ${results.length} results`);
    return results;
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

      // First, ensure a record exists
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO user_metadata (image_id) VALUES (?)
      `);
      insertStmt.run(imageId);

      // Build dynamic UPDATE query to only update provided fields
      const updateFields = [];
      const updateValues = [];

      if (metadata.hasOwnProperty('isFavorite')) {
        updateFields.push('is_favorite = ?');
        updateValues.push(metadata.isFavorite ? 1 : 0);
      }

      if (metadata.hasOwnProperty('isNsfw')) {
        updateFields.push('is_nsfw = ?');
        updateValues.push(metadata.isNsfw ? 1 : 0);
      }

      if (metadata.hasOwnProperty('customTags')) {
        updateFields.push('custom_tags = ?');
        updateValues.push(metadata.customTags || null);
      }

      if (metadata.hasOwnProperty('rating')) {
        updateFields.push('rating = ?');
        updateValues.push(metadata.rating || null);
      }

      if (metadata.hasOwnProperty('notes')) {
        updateFields.push('notes = ?');
        updateValues.push(metadata.notes || null);
      }

      if (updateFields.length > 0) {
        const updateQuery = `
          UPDATE user_metadata 
          SET ${updateFields.join(', ')}
          WHERE image_id = ?
        `;
        updateValues.push(imageId);

        const updateStmt = this.db.prepare(updateQuery);
        return updateStmt.run(...updateValues);
      }

      return { changes: 0 };
    } catch (error) {
      console.error('Error updating user metadata:', error);
      throw error;
    }
  }

  async addAiMetadata(imageId, aiData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ai_metadata 
      (image_id, prompt, negative_prompt, model, steps, cfg_scale, seed, sampler, scheduler, raw_exif_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      aiData.scheduler,
      aiData.rawExifData
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
      // Get all unique directory paths from images, including ZIP archives
      const stmt = this.db.prepare(`
        SELECT DISTINCT 
          CASE 
            WHEN is_archive = 1 THEN archive_path
            ELSE SUBSTR(path, 1, LENGTH(path) - LENGTH(filename) - 1)
          END as folder_path,
          COUNT(*) as image_count
        FROM images 
        WHERE folder_path IS NOT NULL AND folder_path != ''
        GROUP BY folder_path
        ORDER BY folder_path
      `);
      
      const folders = stmt.all();
      
      // Build hierarchical tree structure
      return this.buildFolderTree(folders);
    } catch (error) {
      console.error('Error getting subfolders:', error);
      return [];
    }
  }

  buildFolderTree(folders) {
    if (folders.length === 0) return [];
    
    // Get watched directories to determine root paths
    const watchedDirs = this.db.prepare('SELECT path FROM watch_directories').all();
    const watchedPaths = watchedDirs.map(dir => dir.path.replace(/\\/g, '/'));
    
    // Group folders by their watched directory root
    const rootTrees = [];
    
    watchedPaths.forEach(watchedPath => {
      const relevantFolders = folders.filter(folder => {
        const normalizedFolderPath = folder.folder_path.replace(/\\/g, '/');
        return normalizedFolderPath.startsWith(watchedPath);
      });
      
      if (relevantFolders.length === 0) return;
      
      // Create root node for this watched directory
      const rootName = watchedPath.split('/').pop() || watchedPath;
      const rootNode = {
        name: rootName,
        path: watchedPath,
        imageCount: 0,
        children: [],
        isExpanded: true, // Expand root by default
        level: 0
      };
      
      // Build subtree for this watched directory
      relevantFolders.forEach(folder => {
        const normalizedPath = folder.folder_path.replace(/\\/g, '/');
        
        // Get relative path from watched directory
        let relativePath = normalizedPath;
        if (normalizedPath.startsWith(watchedPath)) {
          relativePath = normalizedPath.substring(watchedPath.length);
          if (relativePath.startsWith('/')) {
            relativePath = relativePath.substring(1);
          }
        }
        
        // Skip if this is the root directory itself
        if (!relativePath) {
          rootNode.imageCount += folder.image_count;
          return;
        }
        
        const segments = relativePath.split('/').filter(segment => segment.length > 0);
        
        // Build tree structure starting from root
        let currentLevel = rootNode.children;
        let currentPath = watchedPath;
        
        segments.forEach((segment, index) => {
          currentPath += '/' + segment;
          
          // Check if this path segment already exists at current level
          let existingNode = currentLevel.find(node => node.name === segment);
          
          if (!existingNode) {
            // Create new node
            const isLeaf = index === segments.length - 1;
            existingNode = {
              name: segment,
              path: currentPath,
              imageCount: isLeaf ? folder.image_count : 0,
              children: [],
              isExpanded: false,
              level: index + 1
            };
            currentLevel.push(existingNode);
          } else if (index === segments.length - 1) {
            // Update image count for leaf node
            existingNode.imageCount = folder.image_count;
          }
          
          currentLevel = existingNode.children;
        });
      });
      
      // Calculate total image counts for this tree
      this.calculateParentCounts([rootNode]);
      rootTrees.push(rootNode);
    });
    
    return rootTrees;
  }

  calculateParentCounts(nodes) {
    nodes.forEach(node => {
      if (node.children.length > 0) {
        this.calculateParentCounts(node.children);
        // Sum up children's image counts
        node.imageCount = node.children.reduce((sum, child) => sum + child.imageCount, 0);
      }
    });
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

  async clearAllFavorites() {
    try {
      const result = this.db.prepare('UPDATE user_metadata SET is_favorite = 0 WHERE is_favorite = 1').run();
      return { success: true, count: result.changes, message: 'All favorites cleared successfully' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async clearAllNsfw() {
    try {
      const result = this.db.prepare('UPDATE user_metadata SET is_nsfw = 0 WHERE is_nsfw = 1').run();
      return { success: true, count: result.changes, message: 'All NSFW tags cleared successfully' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getTableData(tableName) {
    try {
      // Validate table name to prevent SQL injection
      const validTables = ['images', 'user_metadata', 'ai_metadata', 'watch_directories'];
      if (!validTables.includes(tableName)) {
        throw new Error('Invalid table name');
      }

      const stmt = this.db.prepare(`SELECT * FROM ${tableName} ORDER BY ROWID LIMIT 1000`);
      return stmt.all();
    } catch (error) {
      console.error('Error getting table data:', error);
      throw error;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = DatabaseManager;
