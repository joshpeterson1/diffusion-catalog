class PhotoCatalogApp {
    constructor() {
        this.photos = [];
        this.currentOffset = 0;
        this.currentFilters = {};
        this.currentPhoto = null;
        this.isLoading = false;
        
        this.initializeEventListeners();
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

        // Filters
        document.getElementById('favoritesFilter').addEventListener('change', () => this.applyFilters());
        document.getElementById('nsfwFilter').addEventListener('change', () => this.applyFilters());
        document.getElementById('startDate').addEventListener('change', () => this.applyFilters());
        document.getElementById('endDate').addEventListener('change', () => this.applyFilters());
        document.getElementById('sortBy').addEventListener('change', () => this.applyFilters());
        document.getElementById('sortOrder').addEventListener('change', () => this.applyFilters());

        // Load more
        document.getElementById('loadMoreBtn').addEventListener('click', () => this.loadMorePhotos());

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
    }

    async loadPhotos(reset = true) {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading(true);

        try {
            const options = {
                limit: 200,
                offset: reset ? 0 : this.currentOffset,
                ...this.currentFilters
            };

            const photos = await window.electronAPI.getPhotos(options);
            
            if (reset) {
                this.photos = photos;
                this.currentOffset = photos.length;
                this.renderGallery();
            } else {
                this.photos.push(...photos);
                this.currentOffset += photos.length;
                this.appendToGallery(photos);
            }

            this.updatePhotoCount();
            this.updateLoadMoreButton(photos.length === 200);

        } catch (error) {
            console.error('Error loading photos:', error);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    async loadMorePhotos() {
        await this.loadPhotos(false);
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
        photoDiv.className = 'photo-item';
        photoDiv.addEventListener('click', () => this.openPhotoModal(photo));

        const img = document.createElement('img');
        img.src = photo.thumbnail_path ? `file://${photo.thumbnail_path}` : `file://${photo.path}`;
        img.alt = photo.filename;
        img.loading = 'lazy';

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

        if (photo.is_favorite) {
            const favoriteIcon = document.createElement('div');
            favoriteIcon.className = 'favorite-indicator';
            favoriteIcon.textContent = '★';
            photoDiv.appendChild(favoriteIcon);
        }

        photoDiv.appendChild(img);
        photoDiv.appendChild(overlay);

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
            
            // Update the photo in our local array
            const photoIndex = this.photos.findIndex(p => p.id === this.currentPhoto.id);
            if (photoIndex !== -1) {
                Object.assign(this.photos[photoIndex], metadata);
                this.renderGallery(); // Re-render to show favorite star
            }
            
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
                this.updateLoadMoreButton(false);
            } catch (error) {
                console.error('Error searching photos:', error);
            } finally {
                this.showLoading(false);
            }
        } else {
            this.applyFilters();
        }
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
        
        if (document.getElementById('favoritesFilter').checked) {
            this.currentFilters.isFavorite = true;
        }

        this.loadPhotos(true);
    }

    async addDirectory() {
        // This would typically open a directory picker dialog
        // For now, we'll use a simple prompt
        const dirPath = prompt('Enter directory path to watch:');
        if (dirPath) {
            try {
                const result = await window.electronAPI.addWatchDirectory(dirPath);
                if (result.success) {
                    alert('Directory added successfully!');
                    this.loadPhotos(true);
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Error adding directory:', error);
                alert('Failed to add directory');
            }
        }
    }

    updatePhotoCount() {
        document.getElementById('photoCount').textContent = `${this.photos.length} photos`;
    }

    updateLoadMoreButton(show) {
        document.getElementById('loadMoreBtn').style.display = show ? 'block' : 'none';
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
