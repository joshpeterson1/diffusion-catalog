class PhotoCatalogApp {
    constructor() {
        this.photos = [];
        this.currentOffset = 0;
        this.currentFilters = {};
        this.currentPhoto = null;
        this.isLoading = false;
        this.viewMode = 'grid'; // 'grid' or 'list'
        this.currentPage = 1;
        this.favoritesOnly = false;
        this.totalPhotosInRange = 0;
        this.gridDimensions = { cols: 5, rows: 5, photosPerPage: 25 };
        
        this.initializeEventListeners();
        this.setDefaultDateRange();
        this.calculateGridDimensions();
        this.loadPhotos();
    }

    initializeEventListeners() {
        // Search functionality
        document.getElementById('searchBtn').addEventListener('click', () => this.handleSearch());
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch();
        });

        // Directory management
        document.getElementById('addDirectoryBtn').addEventListener('click', () => this.addDirectory());

        // View controls
        document.getElementById('gridViewBtn').addEventListener('click', () => this.setViewMode('grid'));
        document.getElementById('listViewBtn').addEventListener('click', () => this.setViewMode('list'));

        // Filters
        document.getElementById('favoritesFilter').addEventListener('click', () => this.toggleFavorites());
        document.getElementById('nsfwFilter').addEventListener('change', () => this.applyFilters());
        document.getElementById('startDate').addEventListener('change', () => this.applyFilters());
        document.getElementById('endDate').addEventListener('change', () => this.applyFilters());
        document.getElementById('sortBy').addEventListener('change', () => this.applyFilters());
        document.getElementById('sortOrder').addEventListener('change', () => this.applyFilters());

        // Pagination
        document.getElementById('prevPageBtn').addEventListener('click', () => this.previousPage());
        document.getElementById('nextPageBtn').addEventListener('click', () => this.nextPage());

        // Modal controls
        document.querySelector('.close').addEventListener('click', () => this.closeModal());
        document.getElementById('photoModal').addEventListener('click', (e) => {
            if (e.target.id === 'photoModal') this.closeModal();
        });

        // Metadata saving
        document.getElementById('saveMetadata').addEventListener('click', () => this.savePhotoMetadata());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });

        // Window resize handler
        window.addEventListener('resize', () => {
            this.calculateGridDimensions();
            if (this.viewMode === 'grid') {
                this.updateGridLayout();
                this.loadPhotos(true); // Reload with new page size
            }
        });
    }

    setDefaultDateRange() {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        
        document.getElementById('startDate').value = thirtyDaysAgo.toISOString().split('T')[0];
        document.getElementById('endDate').value = now.toISOString().split('T')[0];
    }

    calculateGridDimensions() {
        const gallery = document.getElementById('galleryGrid');
        if (!gallery) return;

        const galleryRect = gallery.getBoundingClientRect();
        const availableWidth = galleryRect.width - 40; // Account for padding
        const availableHeight = galleryRect.height - 40;

        const spacing = 50;
        const minImageSize = 120; // Minimum viable image size

        // Calculate maximum columns that fit with spacing
        const maxCols = Math.floor((availableWidth + spacing) / (minImageSize + spacing));
        const maxRows = Math.floor((availableHeight + spacing) / (minImageSize + spacing));

        // Ensure minimum of 2x2 and maximum reasonable limits
        const cols = Math.max(2, Math.min(maxCols, 12));
        const rows = Math.max(2, Math.min(maxRows, 8));

        // Calculate actual image size based on available space
        const imageSize = Math.floor((availableWidth - (cols - 1) * spacing) / cols);

        this.gridDimensions = {
            cols: cols,
            rows: rows,
            photosPerPage: cols * rows,
            imageSize: imageSize,
            spacing: spacing
        };

        console.log(`Grid dimensions: ${cols}x${rows} = ${this.gridDimensions.photosPerPage} photos per page`);
    }

    updateGridLayout() {
        const gallery = document.getElementById('galleryGrid');
        if (!gallery || this.viewMode !== 'grid') return;

        const { cols, imageSize, spacing } = this.gridDimensions;
        
        gallery.style.gridTemplateColumns = `repeat(${cols}, ${imageSize}px)`;
        gallery.style.gap = `${spacing}px`;
    }

    setViewMode(mode) {
        this.viewMode = mode;
        
        // Update button states
        document.getElementById('gridViewBtn').classList.toggle('active', mode === 'grid');
        document.getElementById('listViewBtn').classList.toggle('active', mode === 'list');
        
        // Update gallery class
        const gallery = document.getElementById('galleryGrid');
        gallery.className = mode === 'grid' ? 'gallery-grid' : 'gallery-list';
        
        if (mode === 'grid') {
            this.calculateGridDimensions();
            this.updateGridLayout();
        }
        
        this.renderGallery();
    }

    async loadPhotos(reset = true) {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading(true);

        try {
            if (reset) {
                this.currentPage = 1;
                this.currentOffset = 0;
            }

            const options = {
                limit: this.gridDimensions.photosPerPage,
                offset: this.currentOffset,
                ...this.currentFilters
            };

            console.log('Loading photos with options:', options);
            const photos = await window.electronAPI.getPhotos(options);
            console.log('Received photos:', photos.length);
            
            this.photos = photos;
            
            // Get total count for pagination - use a separate query without limit/offset
            const countOptions = { ...this.currentFilters };
            delete countOptions.limit;
            delete countOptions.offset;
            const allPhotos = await window.electronAPI.getPhotos({ ...countOptions, limit: 999999, offset: 0 });
            this.totalPhotosInRange = allPhotos.length;
            
            console.log('Total photos in range:', this.totalPhotosInRange);

            this.renderGallery();
            this.updatePhotoCount();
            this.updatePaginationControls();

        } catch (error) {
            console.error('Error loading photos:', error);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }


    renderGallery() {
        const gallery = document.getElementById('galleryGrid');
        gallery.innerHTML = '';
        this.appendToGallery(this.photos);
    }

    appendToGallery(photos) {
        const gallery = document.getElementById('galleryGrid');
        
        photos.forEach(photo => {
            const photoElement = this.createPhotoElement(photo);
            gallery.appendChild(photoElement);
        });
    }

    createPhotoElement(photo) {
        const photoDiv = document.createElement('div');
        photoDiv.className = this.viewMode === 'grid' ? 'photo-item' : 'photo-item-list';
        photoDiv.addEventListener('click', () => this.openPhotoModal(photo));

        const img = document.createElement('img');
        img.src = photo.thumbnail_path ? `file://${photo.thumbnail_path}` : `file://${photo.path}`;
        img.alt = photo.filename;
        img.loading = 'lazy';

        if (this.viewMode === 'grid') {
            const overlay = document.createElement('div');
            overlay.className = 'photo-overlay';
            
            const filename = document.createElement('div');
            filename.className = 'filename';
            filename.textContent = photo.filename;
            
            const metadata = document.createElement('div');
            metadata.className = 'metadata';
            metadata.textContent = photo.date_taken ? 
                new Date(photo.date_taken).toLocaleDateString() : 
                'No date';

            overlay.appendChild(filename);
            overlay.appendChild(metadata);
            photoDiv.appendChild(overlay);
        } else {
            // List view layout
            const infoDiv = document.createElement('div');
            infoDiv.className = 'photo-info';
            
            const filename = document.createElement('div');
            filename.className = 'filename';
            filename.textContent = photo.filename;
            
            const metadata = document.createElement('div');
            metadata.className = 'metadata';
            metadata.textContent = photo.date_taken ? 
                new Date(photo.date_taken).toLocaleString() : 
                'No date';
            
            infoDiv.appendChild(filename);
            infoDiv.appendChild(metadata);
            photoDiv.appendChild(infoDiv);
        }

        if (photo.is_favorite) {
            const favoriteIcon = document.createElement('div');
            favoriteIcon.className = 'favorite-indicator';
            favoriteIcon.textContent = '★';
            photoDiv.appendChild(favoriteIcon);
        }

        photoDiv.appendChild(img);

        return photoDiv;
    }

    async openPhotoModal(photo) {
        this.currentPhoto = photo;
        
        // Load full metadata
        const fullMetadata = await window.electronAPI.getPhotoMetadata(photo.id);
        
        // Set image
        const modalImage = document.getElementById('modalImage');
        modalImage.src = `file://${photo.path}`;
        
        // Populate metadata
        this.populateMetadata(fullMetadata);
        
        // Show modal
        document.getElementById('photoModal').style.display = 'block';
    }

    populateMetadata(metadata) {
        // File info
        const fileInfo = document.getElementById('fileInfo');
        fileInfo.innerHTML = `
            <div><strong>Filename:</strong> ${metadata.filename}</div>
            <div><strong>Size:</strong> ${this.formatFileSize(metadata.file_size)}</div>
            <div><strong>Dimensions:</strong> ${metadata.width} × ${metadata.height}</div>
            <div><strong>Date Taken:</strong> ${metadata.date_taken ? new Date(metadata.date_taken).toLocaleString() : 'Unknown'}</div>
            <div><strong>Path:</strong> ${metadata.path}</div>
        `;

        // AI info
        const aiInfo = document.getElementById('aiInfo');
        if (metadata.prompt || metadata.model) {
            aiInfo.innerHTML = `
                ${metadata.prompt ? `<div><strong>Prompt:</strong> ${metadata.prompt}</div>` : ''}
                ${metadata.negative_prompt ? `<div><strong>Negative Prompt:</strong> ${metadata.negative_prompt}</div>` : ''}
                ${metadata.model ? `<div><strong>Model:</strong> ${metadata.model}</div>` : ''}
                ${metadata.steps ? `<div><strong>Steps:</strong> ${metadata.steps}</div>` : ''}
                ${metadata.cfg_scale ? `<div><strong>CFG Scale:</strong> ${metadata.cfg_scale}</div>` : ''}
                ${metadata.seed ? `<div><strong>Seed:</strong> ${metadata.seed}</div>` : ''}
                ${metadata.sampler ? `<div><strong>Sampler:</strong> ${metadata.sampler}</div>` : ''}
            `;
        } else {
            aiInfo.innerHTML = '<div>No AI metadata found</div>';
        }

        // User metadata
        document.getElementById('favoriteCheck').checked = metadata.is_favorite || false;
        document.getElementById('nsfwCheck').checked = metadata.is_nsfw || false;
        document.getElementById('customTags').value = metadata.custom_tags || '';
        document.getElementById('rating').value = metadata.rating || '';
        document.getElementById('notes').value = metadata.notes || '';
    }

    async savePhotoMetadata() {
        if (!this.currentPhoto) return;

        const metadata = {
            isFavorite: document.getElementById('favoriteCheck').checked,
            isNsfw: document.getElementById('nsfwCheck').checked,
            customTags: document.getElementById('customTags').value,
            rating: document.getElementById('rating').value || null,
            notes: document.getElementById('notes').value
        };

        try {
            await window.electronAPI.updateUserMetadata(this.currentPhoto.id, metadata);
            
            // Update the photo in our local array with the correct field names
            const photoIndex = this.photos.findIndex(p => p.id === this.currentPhoto.id);
            if (photoIndex !== -1) {
                this.photos[photoIndex].is_favorite = metadata.isFavorite ? 1 : 0;
                this.photos[photoIndex].is_nsfw = metadata.isNsfw ? 1 : 0;
                this.photos[photoIndex].custom_tags = metadata.customTags;
                this.photos[photoIndex].rating = metadata.rating;
                this.photos[photoIndex].notes = metadata.notes;
                this.renderGallery(); // Re-render to show favorite star
            }
            
            // Also update the current photo object
            this.currentPhoto.is_favorite = metadata.isFavorite ? 1 : 0;
            this.currentPhoto.is_nsfw = metadata.isNsfw ? 1 : 0;
            
        } catch (error) {
            console.error('Error saving metadata:', error);
        }
    }

    closeModal() {
        document.getElementById('photoModal').style.display = 'none';
        this.currentPhoto = null;
    }

    async handleSearch() {
        const query = document.getElementById('searchInput').value.trim();
        
        if (query) {
            try {
                this.showLoading(true);
                const results = await window.electronAPI.searchPhotos(query, this.currentFilters);
                this.photos = results;
                this.renderGallery();
                this.updatePhotoCount();
                this.updatePaginationControls();
            } catch (error) {
                console.error('Error searching photos:', error);
            } finally {
                this.showLoading(false);
            }
        } else {
            this.applyFilters();
        }
    }

    toggleFavorites() {
        this.favoritesOnly = !this.favoritesOnly;
        const button = document.getElementById('favoritesFilter');
        button.classList.toggle('active', this.favoritesOnly);
        this.applyFilters();
    }

    applyFilters() {
        this.currentFilters = {
            sortBy: document.getElementById('sortBy').value,
            sortOrder: document.getElementById('sortOrder').value
        };

        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        if (startDate) this.currentFilters.startDate = startDate;
        if (endDate) this.currentFilters.endDate = endDate;
        
        if (this.favoritesOnly) {
            this.currentFilters.isFavorite = true;
        } else {
            // Explicitly remove the filter when favorites is turned off
            delete this.currentFilters.isFavorite;
        }

        console.log('Applying filters:', this.currentFilters);
        this.loadPhotos(true);
    }

    async previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.currentOffset = (this.currentPage - 1) * this.gridDimensions.photosPerPage;
            await this.loadPhotos(false);
        }
    }

    async nextPage() {
        const maxPages = Math.ceil(this.totalPhotosInRange / this.gridDimensions.photosPerPage);
        if (this.currentPage < maxPages) {
            this.currentPage++;
            this.currentOffset = (this.currentPage - 1) * this.gridDimensions.photosPerPage;
            await this.loadPhotos(false);
        }
    }

    async addDirectory() {
        try {
            const dirPath = await window.electronAPI.openDirectoryDialog();
            if (dirPath) {
                this.showLoading(true);
                const result = await window.electronAPI.addWatchDirectory(dirPath);
                if (result.success) {
                    alert('Directory added successfully! Scanning for images...');
                    // Trigger a scan of existing files
                    await this.loadPhotos(true);
                } else {
                    alert(`Error: ${result.message}`);
                }
            }
        } catch (error) {
            console.error('Error adding directory:', error);
            alert('Failed to add directory');
        } finally {
            this.showLoading(false);
        }
    }

    updatePhotoCount() {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const dateRangeText = startDate && endDate ? 
            `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}` : 
            'All dates';
        
        document.getElementById('photoCount').textContent = `${this.totalPhotosInRange} photos in range (${dateRangeText})`;
    }

    updatePaginationControls() {
        const maxPages = Math.ceil(this.totalPhotosInRange / this.gridDimensions.photosPerPage);
        
        // Update pagination buttons
        document.getElementById('prevPageBtn').disabled = this.currentPage === 1;
        document.getElementById('nextPageBtn').disabled = this.currentPage >= maxPages;
        document.getElementById('pageInfo').textContent = `Page ${this.currentPage} of ${maxPages} (${this.gridDimensions.photosPerPage} per page)`;
    }

    showLoading(show) {
        document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
    }

    formatFileSize(bytes) {
        if (!bytes) return 'Unknown';
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PhotoCatalogApp();
});
