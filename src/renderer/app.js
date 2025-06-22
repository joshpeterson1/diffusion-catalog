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
        this.currentPhotoIndex = -1;
        this.includeNsfw = true;
        this.selectedFolders = [];
        
        this.initializeEventListeners();
        
        // More robust initialization to handle DOM readiness
        this.initializeApp();
    }

    initializeEventListeners() {
        // Search functionality
        document.getElementById('searchBtn').addEventListener('click', () => this.handleSearch());
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch();
        });

        // Menu event listeners
        window.electronAPI.onMenuAddDirectory(() => this.addDirectory());
        window.electronAPI.onMenuClearDb(() => this.clearDatabase());
        window.electronAPI.onMenuDebugDb(() => this.debugDatabase());
        window.electronAPI.onMenuViewDb(() => this.viewDatabase());
        window.electronAPI.onMenuPreferences(() => this.openPreferences());
        window.electronAPI.onMenuClearFavorites(() => this.clearAllFavorites());
        window.electronAPI.onMenuClearNsfw(() => this.clearAllNsfw());

        // View controls
        document.getElementById('gridViewBtn').addEventListener('click', () => this.setViewMode('grid'));
        document.getElementById('listViewBtn').addEventListener('click', () => this.setViewMode('list'));

        // Filters
        document.getElementById('favoritesFilter').addEventListener('click', () => this.toggleFavorites());
        document.getElementById('nsfwFilter').addEventListener('click', () => this.toggleNsfw());
        document.getElementById('sortBy').addEventListener('change', () => this.refreshPhotos());
        document.getElementById('sortOrder').addEventListener('change', () => this.refreshPhotos());

        // Pagination
        document.getElementById('prevPageBtn').addEventListener('click', () => this.previousPage());
        document.getElementById('nextPageBtn').addEventListener('click', () => this.nextPage());

        // Modal controls
        document.querySelector('.close').addEventListener('click', () => this.closeModal());
        document.getElementById('photoModal').addEventListener('click', (e) => {
            if (e.target.id === 'photoModal') this.closeModal();
        });
        document.getElementById('prevImageBtn').addEventListener('click', () => this.showPreviousImage());
        document.getElementById('nextImageBtn').addEventListener('click', () => this.showNextImage());

        // Metadata saving
        document.getElementById('saveMetadata').addEventListener('click', () => this.savePhotoMetadata());
        document.getElementById('openInDirectory').addEventListener('click', () => this.openInDirectory());
        
        // Filter toggle buttons in modal
        document.getElementById('favoriteToggle').addEventListener('click', () => this.toggleModalFavorite());
        document.getElementById('nsfwToggle').addEventListener('click', () => this.toggleModalNsfw());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
            if (e.key === 'ArrowLeft') this.showPreviousImage();
            if (e.key === 'ArrowRight') this.showNextImage();
        });

        // Window resize handler
        window.addEventListener('resize', () => {
            setTimeout(() => {
                this.calculateGridDimensions();
                if (this.viewMode === 'grid') {
                    this.updateGridLayout();
                    this.loadPhotos(true); // Reload with new page size
                }
            }, 100);
        });
    }

    async loadSubfolders() {
        try {
            const subfolders = await window.electronAPI.getSubfolders();
            this.renderFolderList(subfolders);
        } catch (error) {
            console.error('Error loading subfolders:', error);
        }
    }

    renderFolderList(subfolders) {
        const folderList = document.getElementById('folderList');
        
        if (!subfolders || subfolders.length === 0) {
            folderList.innerHTML = '<div class="no-folders">No folders found</div>';
            return;
        }

        folderList.innerHTML = '';
        
        subfolders.forEach(folder => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `folder-${folder.path}`;
            checkbox.checked = this.selectedFolders.includes(folder.path);
            checkbox.addEventListener('change', () => this.toggleFolder(folder.path));
            
            const label = document.createElement('label');
            label.htmlFor = `folder-${folder.path}`;
            
            // Check if this is a ZIP archive folder
            const isZipFolder = folder.path.toLowerCase().endsWith('.zip');
            const archiveIcon = isZipFolder ? '<i class="bi bi-archive-fill" style="margin-left: 4px; color: #888;"></i>' : '';
            
            label.innerHTML = `
                <span class="folder-name">${folder.name}${archiveIcon}</span>
                <span class="folder-count">(${folder.imageCount})</span>
            `;
            
            folderItem.appendChild(checkbox);
            folderItem.appendChild(label);
            folderList.appendChild(folderItem);
        });
    }

    toggleFolder(folderPath) {
        const index = this.selectedFolders.indexOf(folderPath);
        if (index === -1) {
            this.selectedFolders.push(folderPath);
        } else {
            this.selectedFolders.splice(index, 1);
        }
        
        console.log('Selected folders:', this.selectedFolders);
        this.refreshPhotos();
    }

    calculateGridDimensions() {
        const gallery = document.getElementById('galleryGrid');
        if (!gallery) {
            console.log('Gallery element not found, using fallback dimensions');
            this.gridDimensions = { cols: 5, rows: 5, photosPerPage: 25, imageSize: 200, spacing: 50 };
            return;
        }

        // Force layout calculation
        gallery.offsetHeight;
        
        const galleryRect = gallery.getBoundingClientRect();
        console.log('Gallery rect:', galleryRect);
        
        // If gallery has no dimensions yet, try to get parent dimensions or use fallback
        if (galleryRect.width === 0 || galleryRect.height === 0) {
            console.log('Gallery has no dimensions, checking parent...');
            const parent = gallery.parentElement;
            if (parent) {
                const parentRect = parent.getBoundingClientRect();
                console.log('Parent rect:', parentRect);
                if (parentRect.width > 0 && parentRect.height > 0) {
                    // Use parent dimensions minus some padding
                    const availableWidth = parentRect.width - 80;
                    const availableHeight = parentRect.height - 120;
                    
                    const spacing = 50;
                    const minImageSize = 120;
                    
                    const maxCols = Math.floor((availableWidth + spacing) / (minImageSize + spacing));
                    const maxRows = Math.floor((availableHeight + spacing) / (minImageSize + spacing));
                    
                    const cols = Math.max(2, Math.min(maxCols, 12));
                    const rows = Math.max(2, Math.min(maxRows, 8));
                    
                    const imageSize = Math.floor((availableWidth - (cols - 1) * spacing) / cols);
                    
                    this.gridDimensions = {
                        cols: cols,
                        rows: rows,
                        photosPerPage: cols * rows,
                        imageSize: imageSize,
                        spacing: spacing
                    };
                    
                    console.log(`Grid dimensions from parent: ${cols}x${rows} = ${this.gridDimensions.photosPerPage} photos per page`);
                    return;
                }
            }
            
            console.log('Using fallback dimensions');
            this.gridDimensions = { cols: 5, rows: 5, photosPerPage: 25, imageSize: 200, spacing: 50 };
            return;
        }

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

            console.log('LOADPHOTOS: Sending options to backend:', JSON.stringify(options, null, 2));
            const photos = await window.electronAPI.getPhotos(options);
            console.log('LOADPHOTOS: Received photos from backend:', photos.length);
            
            this.photos = photos;
            
            // Get total count for pagination - use a separate query without limit/offset
            const countOptions = { ...this.currentFilters };
            delete countOptions.limit;
            delete countOptions.offset;
            console.log('LOADPHOTOS: Getting total count with options:', JSON.stringify(countOptions, null, 2));
            const allPhotos = await window.electronAPI.getPhotos({ ...countOptions, limit: 999999, offset: 0 });
            this.totalPhotosInRange = allPhotos.length;
            
            console.log('LOADPHOTOS: Total photos in range:', this.totalPhotosInRange);
            console.log('LOADPHOTOS: Current photos array length:', this.photos.length);

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
        // For ZIP entries, always use thumbnail since we can't directly access the file
        if (photo.path.includes('::')) {
            img.src = photo.thumbnail_path ? `file://${photo.thumbnail_path}` : '';
        } else {
            img.src = photo.thumbnail_path ? `file://${photo.thumbnail_path}` : `file://${photo.path}`;
        }
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

        // Add favorite toggle icon (always present)
        const favoriteIcon = document.createElement('div');
        favoriteIcon.className = photo.is_favorite ? 'favorite-indicator active' : 'favorite-indicator';
        if (this.viewMode === 'list') {
            favoriteIcon.classList.add('list-view');
        }
        favoriteIcon.innerHTML = photo.is_favorite ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
        favoriteIcon.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent opening the modal
            this.togglePhotoFavorite(photo);
        });
        photoDiv.appendChild(favoriteIcon);

        // Add NSFW toggle icon (always present)
        const nsfwIcon = document.createElement('div');
        nsfwIcon.className = photo.is_nsfw ? 'nsfw-indicator active' : 'nsfw-indicator';
        if (this.viewMode === 'list') {
            nsfwIcon.classList.add('list-view');
        }
        nsfwIcon.innerHTML = photo.is_nsfw ? '<i class="bi bi-person-fill-lock"></i>' : '<i class="bi bi-person-lock"></i>';
        nsfwIcon.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent opening the modal
            this.togglePhotoNsfw(photo);
        });
        photoDiv.appendChild(nsfwIcon);

        photoDiv.appendChild(img);

        return photoDiv;
    }

    async openPhotoModal(photo) {
        this.currentPhoto = photo;
        this.currentPhotoIndex = this.photos.findIndex(p => p.id === photo.id);
        
        // Load full metadata
        const fullMetadata = await window.electronAPI.getPhotoMetadata(photo.id);
        
        // Load raw EXIF data on demand
        let rawExifData = {};
        try {
            rawExifData = await window.electronAPI.getRawExifData(photo.path);
        } catch (error) {
            console.error('Error loading raw EXIF data:', error);
        }
        
        // Set image
        const modalImage = document.getElementById('modalImage');
        // For ZIP entries, we need to use a different approach since we can't directly access file://
        if (photo.path.includes('::')) {
            // For now, use the thumbnail for ZIP entries in the modal
            // TODO: Implement a way to extract and serve ZIP entries
            modalImage.src = photo.thumbnail_path ? `file://${photo.thumbnail_path}` : '';
        } else {
            modalImage.src = `file://${photo.path}`;
        }
        
        // Populate metadata with raw EXIF data
        this.populateMetadata(fullMetadata, rawExifData);
        
        // Update navigation buttons
        this.updateNavigationButtons();
        
        // Show modal
        document.getElementById('photoModal').style.display = 'block';
    }

    populateMetadata(metadata, rawExifData = {}) {
        // File info
        const fileInfo = document.getElementById('fileInfo');
        fileInfo.innerHTML = `
            <div><strong>Filename:</strong> <span class="clickable-text" data-copy="${metadata.filename}">${metadata.filename}</span></div>
            <div><strong>Size:</strong> ${this.formatFileSize(metadata.file_size)}</div>
            <div><strong>Dimensions:</strong> ${metadata.width} × ${metadata.height}</div>
            <div><strong>Date Created:</strong> ${metadata.date_taken ? new Date(metadata.date_taken).toLocaleString() : 'Unknown'}</div>
            <div><strong>Path:</strong> <span class="clickable-text" data-copy="${metadata.path}" style="word-break: break-all; overflow-wrap: break-word;">${metadata.path}</span></div>
        `;

        // AI info - show specific EXIF data
        const aiInfo = document.getElementById('aiInfo');
        
        let aiContent = '';
        
        // Parse and show parameters with enhanced formatting
        if (rawExifData.parameters) {
            const parsedParams = this.parseParametersField(rawExifData.parameters);
            
            // Show seed if found
            if (parsedParams.seed) {
                aiContent += '<div><strong>Seed:</strong></div>';
                aiContent += `<div class="clickable-text" data-copy="${parsedParams.seed}" style="margin-bottom: 15px; font-family: monospace; background: #2a2a2a; padding: 8px; border-radius: 4px; cursor: pointer;">${parsedParams.seed}</div>`;
            }
            
            // Show prompt if found
            if (parsedParams.prompt) {
                aiContent += '<div><strong>Prompt:</strong></div>';
                aiContent += `<div class="clickable-text" data-copy="${parsedParams.prompt}" style="margin-bottom: 15px; background: #1a1a1a; padding: 10px; border-radius: 4px; font-size: 12px; line-height: 1.4; cursor: pointer;">${parsedParams.prompt}</div>`;
            }
            
            // Show negative prompt if found
            if (parsedParams.negativePrompt) {
                aiContent += '<div><strong>Negative Prompt:</strong></div>';
                aiContent += `<div class="clickable-text" data-copy="${parsedParams.negativePrompt}" style="margin-bottom: 15px; background: #1a1a1a; padding: 10px; border-radius: 4px; font-size: 12px; line-height: 1.4; cursor: pointer;">${parsedParams.negativePrompt}</div>`;
            }
            
            // Show generation parameters if found
            if (parsedParams.generationParams && parsedParams.generationParams.length > 0) {
                aiContent += '<div><strong>Generation Parameters:</strong></div>';
                aiContent += '<div style="margin-bottom: 15px; background: #1a1a1a; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 11px;">';
                parsedParams.generationParams.forEach(param => {
                    aiContent += `<div style="margin-bottom: 4px;">${param}</div>`;
                });
                aiContent += '</div>';
            }
            
        }
        
        // Show raw EXIF data (collapsed by default)
        if (Object.keys(rawExifData).length > 0) {
            aiContent += '<details style="margin-top: 10px;">';
            aiContent += '<summary style="cursor: pointer; font-weight: bold;">Raw EXIF Data</summary>';
            aiContent += '<div style="max-height: 300px; overflow-y: auto; background: #1a1a1a; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; margin-top: 5px;">';
            aiContent += JSON.stringify(rawExifData, null, 2);
            aiContent += '</div>';
            aiContent += '</details>';
        } else {
            aiContent += '<div>No EXIF data found</div>';
        }
        
        aiInfo.innerHTML = aiContent;
        
        // Add click-to-copy functionality
        this.addClickToCopyListeners();

        // User metadata - update button states and text
        const favoriteBtn = document.getElementById('favoriteToggle');
        const nsfwBtn = document.getElementById('nsfwToggle');
        
        const isFavorite = metadata.is_favorite || false;
        const isNsfw = metadata.is_nsfw || false;
        
        favoriteBtn.classList.toggle('active', isFavorite);
        favoriteBtn.innerHTML = isFavorite ? '<i class="bi bi-star-fill"></i> Remove Favorite' : '<i class="bi bi-star"></i> Add Favorite';
        
        nsfwBtn.classList.toggle('active', isNsfw);
        nsfwBtn.innerHTML = isNsfw ? '<i class="bi bi-person-fill-lock"></i> Remove NSFW' : '<i class="bi bi-person-lock"></i> Mark NSFW';
        
        document.getElementById('customTags').value = metadata.custom_tags || '';
        document.getElementById('rating').value = metadata.rating || '';
        document.getElementById('notes').value = metadata.notes || '';
    }

    async savePhotoMetadata() {
        if (!this.currentPhoto) return;

        // Validate inputs
        const customTags = document.getElementById('customTags').value.trim();
        const rating = document.getElementById('rating').value;
        const notes = document.getElementById('notes').value.trim();

        // Validate rating if provided
        if (rating && (isNaN(rating) || rating < 1 || rating > 5)) {
            alert('Rating must be between 1 and 5');
            return;
        }

        // Only save custom tags, rating, and notes (favorite/nsfw are saved instantly)
        const metadata = {
            customTags: customTags || null,
            rating: rating || null,
            notes: notes || null
        };

        try {
            // Show loading state
            const saveBtn = document.getElementById('saveMetadata');
            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'Saving...';
            saveBtn.disabled = true;

            await window.electronAPI.updateUserMetadata(this.currentPhoto.id, metadata);
            
            // Update the photo in our local array
            const photoIndex = this.photos.findIndex(p => p.id === this.currentPhoto.id);
            if (photoIndex !== -1) {
                this.photos[photoIndex].custom_tags = metadata.customTags;
                this.photos[photoIndex].rating = metadata.rating;
                this.photos[photoIndex].notes = metadata.notes;
            }

            // Show success feedback
            saveBtn.textContent = 'Saved!';
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.disabled = false;
            }, 1000);
            
        } catch (error) {
            console.error('Error saving metadata:', error);
            alert('Failed to save metadata. Please try again.');
            
            // Reset button
            const saveBtn = document.getElementById('saveMetadata');
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
        }
    }

    async openInDirectory() {
        if (!this.currentPhoto) return;
        
        try {
            // For ZIP entries, open the ZIP file location instead of the internal path
            if (this.currentPhoto.path.includes('::')) {
                const zipPath = this.currentPhoto.path.split('::')[0];
                await window.electronAPI.openInDirectory(zipPath);
            } else {
                await window.electronAPI.openInDirectory(this.currentPhoto.path);
            }
        } catch (error) {
            console.error('Error opening in directory:', error);
            alert('Failed to open directory');
        }
    }

    showPreviousImage() {
        if (this.currentPhotoIndex > 0) {
            this.currentPhotoIndex--;
            const prevPhoto = this.photos[this.currentPhotoIndex];
            this.openPhotoModal(prevPhoto);
        }
    }

    showNextImage() {
        if (this.currentPhotoIndex < this.photos.length - 1) {
            this.currentPhotoIndex++;
            const nextPhoto = this.photos[this.currentPhotoIndex];
            this.openPhotoModal(nextPhoto);
        }
    }

    updateNavigationButtons() {
        const prevBtn = document.getElementById('prevImageBtn');
        const nextBtn = document.getElementById('nextImageBtn');
        
        prevBtn.disabled = this.currentPhotoIndex <= 0;
        nextBtn.disabled = this.currentPhotoIndex >= this.photos.length - 1;
    }

    closeModal() {
        document.getElementById('photoModal').style.display = 'none';
        this.currentPhoto = null;
        this.currentPhotoIndex = -1;
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
            this.refreshPhotos();
        }
    }

    toggleFavorites() {
        this.favoritesOnly = !this.favoritesOnly;
        const button = document.getElementById('favoritesFilter');
        button.classList.toggle('active', this.favoritesOnly);
        console.log('TOGGLE FAVORITES:', this.favoritesOnly);
        this.refreshPhotos();
    }

    toggleNsfw() {
        this.includeNsfw = !this.includeNsfw;
        const button = document.getElementById('nsfwFilter');
        button.classList.toggle('active', this.includeNsfw);
        console.log('TOGGLE NSFW:', this.includeNsfw);
        this.refreshPhotos();
    }

    initializeFilters() {
        // Set initial NSFW button state
        const nsfwButton = document.getElementById('nsfwFilter');
        nsfwButton.classList.add('active');
    }

    refreshPhotos() {
        // Reset pagination
        this.currentPage = 1;
        this.currentOffset = 0;
        
        // Build fresh filter object
        const filters = {
            sortBy: document.getElementById('sortBy').value,
            sortOrder: document.getElementById('sortOrder').value
        };

        // Add selected folders filter
        if (this.selectedFolders.length > 0) {
            filters.selectedFolders = this.selectedFolders;
            console.log('ADDING FOLDER FILTERS:', this.selectedFolders);
        } else {
            console.log('NO FOLDERS SELECTED - SHOWING ALL PHOTOS');
        }
        
        // Add favorites filter only if enabled
        if (this.favoritesOnly) {
            filters.isFavorite = true;
            console.log('ADDING FAVORITES FILTER TO QUERY');
        } else {
            console.log('NOT ADDING FAVORITES FILTER - SHOULD SHOW ALL PHOTOS');
        }

        // Add NSFW filter - exclude NSFW unless explicitly included
        if (!this.includeNsfw) {
            filters.excludeNsfw = true;
            console.log('EXCLUDING NSFW CONTENT');
        } else {
            console.log('INCLUDING NSFW CONTENT');
        }

        this.currentFilters = filters;
        console.log('FINAL FILTERS BEING SENT:', JSON.stringify(this.currentFilters, null, 2));
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
                    alert(result.message);
                    // Reload subfolders and photos
                    await this.loadSubfolders();
                    await this.loadPhotos(true);
                } else {
                    alert(`Error: ${result.message}`);
                }
            }
        } catch (error) {
            console.error('Error adding directory:', error);
            alert('Failed to add directory or ZIP file');
        } finally {
            this.showLoading(false);
        }
    }

    updatePhotoCount() {
        let filterText = 'All folders';
        if (this.selectedFolders.length > 0) {
            if (this.selectedFolders.length === 1) {
                const folderName = this.selectedFolders[0].split(/[\/\\]/).pop();
                filterText = `Folder: ${folderName}`;
            } else {
                filterText = `${this.selectedFolders.length} folders selected`;
            }
        }
        
        document.getElementById('photoCount').textContent = `${this.totalPhotosInRange} photos (${filterText})`;
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

    async clearDatabase() {
        if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            try {
                const result = await window.electronAPI.clearDatabase();
                if (result.success) {
                    alert('Database cleared successfully');
                    this.refreshPhotos();
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Error clearing database:', error);
                alert('Failed to clear database');
            }
        }
    }

    async debugDatabase() {
        try {
            const debug = await window.electronAPI.debugDatabase();
            console.log('Database debug info:', debug);
            alert(`Images: ${debug.imageCount}, User Meta: ${debug.userMetaCount}, Favorites: ${debug.favoriteCount}`);
        } catch (error) {
            console.error('Error getting debug info:', error);
        }
    }

    async viewDatabase() {
        try {
            const debug = await window.electronAPI.debugDatabase();
            console.log('Full database debug info:', debug);
            
            let message = `Database Contents:\n\n`;
            message += `Images: ${debug.imageCount}\n`;
            message += `User Metadata: ${debug.userMetaCount}\n`;
            message += `Favorites: ${debug.favoriteCount}\n\n`;
            
            if (debug.sampleImages && debug.sampleImages.length > 0) {
                message += `Sample Images:\n`;
                debug.sampleImages.forEach(img => {
                    message += `- ${img.filename} (ID: ${img.id})\n`;
                });
                message += `\n`;
            }
            
            if (debug.sampleUserMeta && debug.sampleUserMeta.length > 0) {
                message += `Sample User Metadata:\n`;
                debug.sampleUserMeta.forEach(meta => {
                    message += `- Image ${meta.image_id}: Favorite: ${meta.is_favorite}, NSFW: ${meta.is_nsfw}\n`;
                });
            }
            
            alert(message);
        } catch (error) {
            console.error('Error viewing database:', error);
            alert('Failed to view database');
        }
    }

    openPreferences() {
        alert('Preferences dialog coming soon!');
    }

    async clearAllFavorites() {
        if (confirm('Are you sure you want to clear all favorite tags? This cannot be undone.')) {
            try {
                const result = await window.electronAPI.clearAllFavorites();
                if (result.success) {
                    alert(`Successfully cleared ${result.count} favorite tags`);
                    this.refreshPhotos();
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Error clearing favorites:', error);
                alert('Failed to clear favorites');
            }
        }
    }

    async clearAllNsfw() {
        if (confirm('Are you sure you want to clear all NSFW tags? This cannot be undone.')) {
            try {
                const result = await window.electronAPI.clearAllNsfw();
                if (result.success) {
                    alert(`Successfully cleared ${result.count} NSFW tags`);
                    this.refreshPhotos();
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Error clearing NSFW tags:', error);
                alert('Failed to clear NSFW tags');
            }
        }
    }

    isValidDate(dateString) {
        const date = new Date(dateString);
        return date instanceof Date && !isNaN(date);
    }

    cleanup() {
        // Clean up event listeners and resources
        window.removeEventListener('resize', this.handleResize);
        document.removeEventListener('keydown', this.handleKeydown);
        
        // Clean up any object URLs if we were using them
        this.photos.forEach(photo => {
            if (photo.objectUrl) {
                URL.revokeObjectURL(photo.objectUrl);
            }
        });
    }

    parseParametersField(parametersText) {
        const result = {
            prompt: null,
            negativePrompt: null,
            generationParams: [],
            seed: null
        };
        
        // Check if parameters contain newlines for structured parsing
        if (parametersText.includes('\n')) {
            const lines = parametersText.split('\n');
            
            // First line is typically the prompt
            if (lines[0] && lines[0].trim()) {
                result.prompt = lines[0].trim();
            }
            
            // Look for negative prompt line
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.toLowerCase().startsWith('negative prompt:')) {
                    result.negativePrompt = line.substring(line.indexOf(':') + 1).trim();
                } else if (line && !line.toLowerCase().startsWith('negative prompt:')) {
                    // This should be the generation parameters line
                    // Split by comma and clean up each parameter
                    const params = line.split(',').map(param => param.trim()).filter(param => param);
                    result.generationParams = params;
                    
                    // Extract seed from generation parameters
                    const seedParam = params.find(param => param.toLowerCase().includes('seed:'));
                    if (seedParam) {
                        const seedMatch = seedParam.match(/seed:\s*(\d+)/i);
                        if (seedMatch) {
                            result.seed = seedMatch[1];
                        }
                    }
                    break;
                }
            }
        } else {
            // No newlines, treat as single parameter string
            result.generationParams = parametersText.split(',').map(param => param.trim()).filter(param => param);
            
            // Still try to extract seed
            const seedMatch = parametersText.match(/seed:\s*(\d+)/i);
            if (seedMatch) {
                result.seed = seedMatch[1];
            }
        }
        
        return result;
    }

    async initializeApp() {
        // Wait for DOM to be fully ready
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }
        
        // Additional delay to ensure layout is complete
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Force a layout calculation
        const gallery = document.getElementById('galleryGrid');
        if (gallery) {
            gallery.offsetHeight; // Force layout
        }
        
        this.calculateGridDimensions();
        this.updateGridLayout();
        
        // Initialize filters
        this.initializeFilters();
        
        // Load data
        await this.loadSubfolders();
        await this.loadPhotos();
    }

    addClickToCopyListeners() {
        const clickableElements = document.querySelectorAll('.clickable-text');
        clickableElements.forEach(element => {
            element.addEventListener('click', async () => {
                const textToCopy = element.getAttribute('data-copy');
                const originalText = element.textContent;
                
                try {
                    await navigator.clipboard.writeText(textToCopy);
                    
                    // Show "Copied!" text feedback
                    element.textContent = 'Copied!';
                    element.style.backgroundColor = '#007acc';
                    element.style.transition = 'background-color 0.2s';
                    
                    setTimeout(() => {
                        element.textContent = originalText;
                        element.style.backgroundColor = '';
                    }, 1000);
                    
                    console.log('Copied to clipboard:', textToCopy);
                } catch (error) {
                    console.error('Failed to copy to clipboard:', error);
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = textToCopy;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    // Show "Copied!" even for fallback method
                    element.textContent = 'Copied!';
                    element.style.backgroundColor = '#007acc';
                    
                    setTimeout(() => {
                        element.textContent = originalText;
                        element.style.backgroundColor = '';
                    }, 1000);
                }
            });
        });
    }

    async toggleModalFavorite() {
        const button = document.getElementById('favoriteToggle');
        const isActive = button.classList.toggle('active');
        button.innerHTML = isActive ? '<i class="bi bi-star-fill"></i> Remove Favorite' : '<i class="bi bi-star"></i> Add Favorite';
        
        // Save immediately
        await this.saveInstantMetadata('favorite', isActive);
    }

    async toggleModalNsfw() {
        const button = document.getElementById('nsfwToggle');
        const isActive = button.classList.toggle('active');
        button.innerHTML = isActive ? '<i class="bi bi-person-fill-lock"></i> Remove NSFW' : '<i class="bi bi-person-lock"></i> Mark NSFW';
        
        // Save immediately
        await this.saveInstantMetadata('nsfw', isActive);
    }

    async saveInstantMetadata(type, value) {
        if (!this.currentPhoto) return;

        try {
            const metadata = {};
            if (type === 'favorite') {
                metadata.isFavorite = value;
            } else if (type === 'nsfw') {
                metadata.isNsfw = value;
            }

            await window.electronAPI.updateUserMetadata(this.currentPhoto.id, metadata);
            
            // Update the photo in our local array
            const photoIndex = this.photos.findIndex(p => p.id === this.currentPhoto.id);
            if (photoIndex !== -1) {
                if (type === 'favorite') {
                    this.photos[photoIndex].is_favorite = value ? 1 : 0;
                    this.currentPhoto.is_favorite = value ? 1 : 0;
                } else if (type === 'nsfw') {
                    this.photos[photoIndex].is_nsfw = value ? 1 : 0;
                    this.currentPhoto.is_nsfw = value ? 1 : 0;
                }
                this.renderGallery(); // Re-render to show updated indicators
            }
            
        } catch (error) {
            console.error(`Error saving ${type} metadata:`, error);
            // Revert the button state on error
            const button = document.getElementById(type === 'favorite' ? 'favoriteToggle' : 'nsfwToggle');
            button.classList.toggle('active', !value);
            button.innerHTML = type === 'favorite' 
                ? (!value ? '<i class="bi bi-star-fill"></i> Remove Favorite' : '<i class="bi bi-star"></i> Add Favorite')
                : (!value ? '<i class="bi bi-person-fill-lock"></i> Remove NSFW' : '<i class="bi bi-person-lock"></i> Mark NSFW');
        }
    }

    async togglePhotoFavorite(photo) {
        try {
            const newValue = !photo.is_favorite;
            await window.electronAPI.updateUserMetadata(photo.id, { isFavorite: newValue });
            
            // Update the photo object and re-render
            photo.is_favorite = newValue ? 1 : 0;
            this.renderGallery();
            
        } catch (error) {
            console.error('Error toggling favorite:', error);
        }
    }

    async togglePhotoNsfw(photo) {
        try {
            const newValue = !photo.is_nsfw;
            await window.electronAPI.updateUserMetadata(photo.id, { isNsfw: newValue });
            
            // Update the photo object and re-render
            photo.is_nsfw = newValue ? 1 : 0;
            this.renderGallery();
            
        } catch (error) {
            console.error('Error toggling NSFW:', error);
        }
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
