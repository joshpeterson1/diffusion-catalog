const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class ConfigManager {
    constructor() {
        this.configPath = path.join(app.getPath('userData'), 'config.json');
        this.defaultConfig = {
            thumbnailDensity: 'medium',
            includeNsfw: true,
            nsfwOnly: false,
            favoritesOnly: false,
            sortBy: 'date_taken',
            sortOrder: 'DESC',
            viewMode: 'grid'
        };
        this.config = { ...this.defaultConfig };
    }

    async loadConfig() {
        try {
            const configData = await fs.readFile(this.configPath, 'utf8');
            const loadedConfig = JSON.parse(configData);
            
            // Merge with defaults to ensure all properties exist
            this.config = { ...this.defaultConfig, ...loadedConfig };
            
            console.log('Config loaded:', this.config);
            return this.config;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('Config file not found, using defaults');
                await this.saveConfig();
                return this.config;
            } else {
                console.error('Error loading config:', error);
                return this.config;
            }
        }
    }

    async saveConfig() {
        try {
            await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
            console.log('Config saved:', this.config);
        } catch (error) {
            console.error('Error saving config:', error);
        }
    }

    async updateConfig(updates) {
        this.config = { ...this.config, ...updates };
        await this.saveConfig();
        return this.config;
    }

    getConfig() {
        return { ...this.config };
    }

    resetConfig() {
        this.config = { ...this.defaultConfig };
        return this.saveConfig();
    }
}

module.exports = ConfigManager;
