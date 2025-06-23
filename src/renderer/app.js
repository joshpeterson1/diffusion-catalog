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
        this.nsfwOnly = false;
        this.selectedFolders = [];
        this.totalPhotosInDatabase = 0;
        this.thumbnailDensity = 'medium'; // 'small', 'medium', 'large'
        this.config = {};
        this.currentSearchQuery = null; // Track current search query
        
        this.initializeEventListeners();
        
        // More robust initialization to handle DOM readiness
        this.initializeApp();
    }

    initializeEventListeners() {
        // Search functionality with more robust event binding
        const searchBtn = document.getElementById('searchBtn');
        const searchInput = document.getElementById('searchInput');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        
        // Use onclick instead of addEventListener to ensure it always works
        if (searchBtn) {
            searchBtn.onclick = () => this.handleSearch();
        }
        
        if (clearSearchBtn) {
            clearSearchBtn.onclick = () => this.clearSearch();
        }
        
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleSearch();
            });
            
            // Add additional event listeners to ensure input stays interactive
            searchInput.addEventListener('focus', () => {
                searchInput.disabled = false;
                searchInput.style.pointerEvents = 'auto';
            });
            
            searchInput.addEventListener('blur', () => {
                // Ensure it doesn't get disabled on blur
                setTimeout(() => {
                    searchInput.disabled = false;
                    searchInput.style.pointerEvents = 'auto';
                }, 10);
            });
        }

        // Menu event listeners
        window.electronAPI.onMenuAddDirectory(() => this.addDirectory());
        window.electronAPI.onMenuClearDb(() => this.clearDatabase());
        window.electronAPI.onMenuDebugDb(() => this.debugDatabase());
        window.electronAPI.onMenuViewDb(() => this.viewDatabase());
        window.electronAPI.onMenuPreferences(() => this.openPreferences());
        window.electronAPI.onMenuClearFavorites(() => this.clearAllFavorites());
        window.electronAPI.onMenuClearNsfw(() => this.clearAllNsfw());
        window.electronAPI.onMenuRebuildDb(() => this.rebuildDatabase());
        window.electronAPI.onMenuUpdateDatabase(() => this.updateDatabase());

        // Listen for automatic photo updates from file watcher
        window.electronAPI.onPhotosUpdated(() => {
            console.log('Photos updated event received, refreshing gallery...');
            this.handlePhotosUpdated();
        });

        // View controls
        document.getElementById('gridViewBtn').addEventListener('click', () => this.setViewMode('grid'));
        document.getElementById('listViewBtn').addEventListener('click', () => this.setViewMode('list'));

        // Filters
        document.getElementById('favoritesFilter').addEventListener('click', () => this.toggleFavorites());
        document.getElementById('nsfwFilter').addEventListener('click', (e) => this.toggleNsfw(e));
        document.getElementById('sortBy').addEventListener('change', () => {
            this.refreshPhotos();
            this.saveConfig(); // Save sort setting
        });
        document.getElementById('sortOrder').addEventListener('change', () => {
            this.refreshPhotos();
            this.saveConfig(); // Save sort setting
        });
        
        // Density control
        document.getElementById('densitySelect').addEventListener('change', (e) => this.changeDensity(e.target.value));

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

    async loadWatchedDirectories() {
        try {
            console.log('Loading watched directories...');
            const watchedDirs = await window.electronAPI.getWatchedDirectories();
            console.log('Received watched directories:', watchedDirs);
            this.renderWatchedDirectoriesList(watchedDirs);
        } catch (error) {
            console.error('Error loading watched directories:', error);
        }
    }

    renderWatchedDirectoriesList(watchedDirs) {
        const watchedList = document.getElementById('watchedDirectoriesList');
        console.log('Rendering watched directories list, element found:', !!watchedList);
        console.log('Watched dirs to render:', watchedDirs);
        
        if (!watchedList) {
            console.error('watchedDirectoriesList element not found!');
            return;
        }
        
        if (!watchedDirs || watchedDirs.length === 0) {
            watchedList.innerHTML = '<div class="no-watched-dirs">No directories being watched</div>';
            return;
        }

        watchedList.innerHTML = '';
        
        watchedDirs.forEach(dir => {
            const dirItem = document.createElement('div');
            dirItem.className = 'watched-dir-item';
            
            const dirInfo = document.createElement('div');
            dirInfo.className = 'watched-dir-info';
            
            // Check if this is a ZIP file
            const isZipFile = dir.path.toLowerCase().endsWith('.zip');
            const icon = isZipFile ? '<i class="bi bi-archive-fill"></i>' : '<i class="bi bi-folder-fill"></i>';
            
            dirInfo.innerHTML = `
                <div class="watched-dir-name">
                    ${icon}
                    <span class="dir-name" title="${dir.path}">${dir.name}</span>
                    <span class="dir-status ${dir.isActive ? 'active' : 'inactive'}">
                        ${dir.isActive ? '●' : '○'}
                    </span>
                </div>
            `;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-watched-dir-btn';
            removeBtn.innerHTML = '<i class="bi bi-x-circle"></i>';
            removeBtn.title = 'Remove from watching';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeWatchedDirectory(dir.path);
            });
            
            dirItem.appendChild(dirInfo);
            dirItem.appendChild(removeBtn);
            watchedList.appendChild(dirItem);
        });
    }

    async removeWatchedDirectory(dirPath) {
        if (confirm(`Stop watching "${dirPath}"?\n\nThis will remove the directory from monitoring but won't delete any photos from the database.`)) {
            try {
                const result = await window.electronAPI.removeWatchDirectory(dirPath);
                if (result.success) {
                    // Reload the watched directories list
                    await this.loadWatchedDirectories();
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Error removing watched directory:', error);
                alert('Failed to remove watched directory');
            }
        }
    }

    async loadSubfolders() {
        try {
            const folderTree = await window.electronAPI.getSubfolders();
            this.folderTree = folderTree; // Store for expansion/collapse
            this.renderFolderList(folderTree);
        } catch (error) {
            console.error('Error loading subfolders:', error);
        }
    }

    renderFolderList(folderTree) {
        const folderList = document.getElementById('folderList');
        
        if (!folderTree || folderTree.length === 0) {
            folderList.innerHTML = '<div class="no-folders">No folders found</div>';
            return;
        }

        folderList.innerHTML = '';
        this.renderFolderTreeNodes(folderTree, folderList, 0);
    }

    renderFolderTreeNodes(nodes, container, level) {
        nodes.forEach(node => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            folderItem.style.paddingLeft = `${level * 8}px`; // Conservative indentation: 8px per level
            
            // Create expand/collapse button for nodes with children
            let expandButton = '';
            if (node.children && node.children.length > 0) {
                const expandIcon = node.isExpanded ? 'bi-chevron-down' : 'bi-chevron-right';
                expandButton = `<i class="bi ${expandIcon} expand-icon" data-path="${node.path}"></i>`;
            } else {
                expandButton = '<span class="expand-spacer"></span>'; // Spacer for alignment
            }
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `folder-${node.path}`;
            checkbox.checked = this.selectedFolders.includes(node.path);
            checkbox.addEventListener('change', () => this.toggleFolder(node.path));
            
            const label = document.createElement('label');
            label.htmlFor = `folder-${node.path}`;
            
            // Check if this is a ZIP archive folder
            const isZipFolder = node.path.toLowerCase().endsWith('.zip');
            const archiveIcon = isZipFolder ? '<i class="bi bi-archive-fill" style="margin-left: 4px; color: #888;"></i>' : '';
            const folderIcon = isZipFolder ? '' : '<i class="bi bi-folder-fill" style="margin-right: 4px; color: #ffd700;"></i>';
            
            folderItem.innerHTML = `
                ${expandButton}
                <input type="checkbox" id="folder-${node.path}" ${this.selectedFolders.includes(node.path) ? 'checked' : ''}>
                <label for="folder-${node.path}">
                    ${folderIcon}
                    <span class="folder-name">${node.name}${archiveIcon}</span>
                    <span class="folder-count">(${node.imageCount})</span>
                </label>
            `;
            
            // Re-add event listeners since innerHTML overwrites them
            const newCheckbox = folderItem.querySelector('input[type="checkbox"]');
            newCheckbox.addEventListener('change', () => this.toggleFolder(node.path));
            
            // Add expand/collapse functionality
            const expandIcon = folderItem.querySelector('.expand-icon');
            if (expandIcon) {
                expandIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleFolderExpansion(node.path);
                });
            }
            
            container.appendChild(folderItem);
            
            // Render children if expanded
            if (node.isExpanded && node.children && node.children.length > 0) {
                this.renderFolderTreeNodes(node.children, container, level + 1);
            }
        });
    }

    toggleFolderExpansion(folderPath) {
        // Find the node in the tree and toggle its expansion
        const toggleNodeExpansion = (nodes) => {
            for (const node of nodes) {
                if (node.path === folderPath) {
                    node.isExpanded = !node.isExpanded;
                    return true;
                }
                if (node.children && toggleNodeExpansion(node.children)) {
                    return true;
                }
            }
            return false;
        };
        
        if (this.folderTree) {
            toggleNodeExpansion(this.folderTree);
            this.renderFolderList(this.folderTree); // Re-render the tree
        }
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
            this.gridDimensions = { cols: 5, rows: 4, photosPerPage: 20, imageSize: 160, spacing: 15 };
            return;
        }

        // Force layout calculation
        gallery.offsetHeight;
        
        const galleryRect = gallery.getBoundingClientRect();
        console.log('Gallery rect:', galleryRect);
        
        // Get available space
        let availableWidth, availableHeight;
        
        if (galleryRect.width === 0 || galleryRect.height === 0) {
            console.log('Gallery has no dimensions, checking parent...');
            const parent = gallery.parentElement;
            if (parent) {
                const parentRect = parent.getBoundingClientRect();
                if (parentRect.width > 0 && parentRect.height > 0) {
                    availableWidth = parentRect.width - 40; // Account for padding
                    availableHeight = parentRect.height - 40;
                } else {
                    // Fallback
                    this.gridDimensions = { cols: 5, rows: 4, photosPerPage: 20, imageSize: 160, spacing: 15 };
                    return;
                }
            } else {
                // Fallback
                this.gridDimensions = { cols: 5, rows: 4, photosPerPage: 20, imageSize: 160, spacing: 15 };
                return;
            }
        } else {
            availableWidth = galleryRect.width - 40;
            availableHeight = galleryRect.height - 40;
        }

        // Define thumbnail sizes and spacing based on density
        const densitySettings = {
            small: { imageSize: 120, spacing: 12 },
            medium: { imageSize: 160, spacing: 15 },
            large: { imageSize: 200, spacing: 20 }
        };

        const { imageSize, spacing } = densitySettings[this.thumbnailDensity] || densitySettings.medium;

        // Calculate how many columns and rows fit
        const cols = Math.max(2, Math.floor((availableWidth + spacing) / (imageSize + spacing)));
        const rows = Math.max(2, Math.floor((availableHeight + spacing) / (imageSize + spacing)));

        this.gridDimensions = {
            cols: cols,
            rows: rows,
            photosPerPage: cols * rows,
            imageSize: imageSize,
            spacing: spacing
        };

        console.log(`Grid dimensions (${this.thumbnailDensity}): ${cols}x${rows} = ${this.gridDimensions.photosPerPage} photos per page`);
    }

    updateGridLayout() {
        const gallery = document.getElementById('galleryGrid');
        if (!gallery) return;

        if (this.viewMode === 'grid') {
            const { cols, imageSize, spacing } = this.gridDimensions;
            gallery.style.gridTemplateColumns = `repeat(${cols}, ${imageSize}px)`;
            gallery.style.gap = `${spacing}px`;
        } else {
            // Clear grid styles for list view
            gallery.style.gridTemplateColumns = '';
            gallery.style.gap = '';
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
        
        // Update button states
        document.getElementById('gridViewBtn').classList.toggle('active', mode === 'grid');
        document.getElementById('listViewBtn').classList.toggle('active', mode === 'list');
        
        // Show/hide density controls based on view mode
        const densityControls = document.querySelector('.density-controls');
        densityControls.style.display = mode === 'grid' ? 'flex' : 'none';
        
        // Update gallery class and clear any conflicting inline styles
        const gallery = document.getElementById('galleryGrid');
        gallery.className = mode === 'grid' ? 'gallery-grid' : 'gallery-list';
        
        if (mode === 'grid') {
            this.calculateGridDimensions();
            this.updateGridLayout();
        } else {
            // Clear all grid-related inline styles for list view
            gallery.style.gridTemplateColumns = '';
            gallery.style.gap = '';
            gallery.style.display = '';
        }
        
        this.renderGallery();
        this.saveConfig(); // Save setting
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
            
            // Also get total photos in database (no filters)
            const allPhotosInDb = await window.electronAPI.getPhotos({ limit: 999999, offset: 0 });
            this.totalPhotosInDatabase = allPhotosInDb.length;
            
            console.log('LOADPHOTOS: Total photos in range:', this.totalPhotosInRange);
            console.log('LOADPHOTOS: Total photos in database:', this.totalPhotosInDatabase);
            console.log('LOADPHOTOS: Current photos array length:', this.photos.length);

            this.renderGallery();
            await this.updatePhotoCount();
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
        
        if (this.photos.length === 0) {
            // Only show "add directory" message if database is truly empty
            if (this.totalPhotosInDatabase === 0) {
                this.showEmptyState();
            } else {
                this.showNoResultsState();
            }
        } else {
            this.appendToGallery(this.photos);
        }
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
            
            // Show seed if found (moved below negative prompt)
            if (parsedParams.seed) {
                aiContent += '<div><strong>Seed:</strong></div>';
                aiContent += `<div class="clickable-text" data-copy="${parsedParams.seed}" style="margin-bottom: 15px; font-family: monospace; background: #2a2a2a; padding: 8px; border-radius: 4px; cursor: pointer;">${parsedParams.seed}</div>`;
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
        this.currentSearchQuery = query; // Store current search query
        
        if (query) {
            try {
                this.showLoading(true);
                
                // Build search filters with current filter state
                const searchFilters = { ...this.currentFilters };
                
                // Add favorites filter if enabled
                if (this.favoritesOnly) {
                    searchFilters.isFavorite = true;
                }
                
                // Add NSFW filters
                if (this.nsfwOnly) {
                    searchFilters.nsfwOnly = true;
                } else if (!this.includeNsfw) {
                    searchFilters.excludeNsfw = true;
                }
                
                console.log('Search filters:', searchFilters);
                const results = await window.electronAPI.searchPhotos(query, searchFilters);
                this.photos = results;
                this.totalPhotosInRange = results.length; // Update count for search results
                this.renderGallery();
                await this.updatePhotoCount();
                this.updatePaginationControls();
                this.updateClearSearchButton();
            } catch (error) {
                console.error('Error searching photos:', error);
            } finally {
                this.showLoading(false);
            }
        } else {
            this.clearSearch();
        }
    }

    clearSearch() {
        document.getElementById('searchInput').value = '';
        this.currentSearchQuery = null;
        this.updateClearSearchButton();
        this.refreshPhotos();
    }

    updateClearSearchButton() {
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) {
            clearBtn.style.display = this.currentSearchQuery ? 'inline-block' : 'none';
        }
    }

    toggleFavorites() {
        this.favoritesOnly = !this.favoritesOnly;
        const button = document.getElementById('favoritesFilter');
        button.classList.toggle('active', this.favoritesOnly);
        console.log('TOGGLE FAVORITES:', this.favoritesOnly);
        this.refreshPhotos();
        this.saveConfig(); // Save setting
    }

    toggleNsfw(event) {
        if (event && event.shiftKey) {
            // Shift+click: toggle NSFW-only mode
            this.nsfwOnly = !this.nsfwOnly;
            if (this.nsfwOnly) {
                this.includeNsfw = true; // Must include NSFW to show only NSFW
            }
            const button = document.getElementById('nsfwFilter');
            button.classList.toggle('nsfw-only', this.nsfwOnly);
            button.classList.toggle('active', this.includeNsfw);
            console.log('TOGGLE NSFW ONLY:', this.nsfwOnly);
        } else {
            // Regular click: toggle NSFW inclusion
            this.includeNsfw = !this.includeNsfw;
            if (!this.includeNsfw) {
                this.nsfwOnly = false; // Can't show only NSFW if not including NSFW
            }
            const button = document.getElementById('nsfwFilter');
            button.classList.toggle('active', this.includeNsfw);
            button.classList.toggle('nsfw-only', this.nsfwOnly);
            console.log('TOGGLE NSFW:', this.includeNsfw);
        }
        this.refreshPhotos();
        this.saveConfig(); // Save setting
    }

    initializeFilters() {
        // Filter initialization is now handled by loadConfig()
        // No need to set initial states here since config will override them
    }

    refreshPhotos() {
        // If we have an active search, re-run the search with new filters
        if (this.currentSearchQuery) {
            this.handleSearch();
            return;
        }
        
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

        // Add NSFW filter - exclude NSFW unless explicitly included, or show only NSFW
        if (this.nsfwOnly) {
            filters.nsfwOnly = true;
            console.log('SHOWING ONLY NSFW CONTENT');
        } else if (!this.includeNsfw) {
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
                    // Reload watched directories, subfolders and photos
                    await this.loadWatchedDirectories();
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

    async updatePhotoCount() {
        let filterText = 'All folders';
        if (this.selectedFolders.length > 0) {
            if (this.selectedFolders.length === 1) {
                const folderName = this.selectedFolders[0].split(/[\/\\]/).pop();
                filterText = `Folder: ${folderName}`;
            } else {
                filterText = `${this.selectedFolders.length} folders selected`;
            }
        }
        
        let countText = `${this.totalPhotosInRange} photos (${filterText})`;
        
        // Show NSFW exclusion count when favorites only is enabled but NSFW is excluded
        if (this.favoritesOnly && !this.includeNsfw) {
            try {
                const excludedCount = await this.getExcludedNsfwCount();
                if (excludedCount > 0) {
                    const photoText = excludedCount === 1 ? 'favorite' : 'favorites';
                    countText += ` • ${excludedCount} NSFW ${photoText} not shown`;
                }
            } catch (error) {
                console.error('Error getting excluded NSFW count:', error);
            }
        }
        
        document.getElementById('photoCount').textContent = countText;
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
            
            let message = `Database & System Debug Info\n`;
            message += `Generated: ${new Date(debug.timestamp).toLocaleString()}\n\n`;
            
            message += `Database Statistics:\n`;
            message += `• Total images: ${debug.database.imageCount}\n`;
            message += `• User metadata entries: ${debug.database.userMetaCount}\n`;
            message += `• Favorite images: ${debug.database.favoriteCount}\n\n`;
            
            message += `File Watcher Performance:\n`;
            message += `• Total scans performed: ${debug.fileWatcher.totalScansPerformed}\n`;
            message += `• Last scan duration: ${debug.fileWatcher.lastScanDurationFormatted || 'N/A'}\n`;
            message += `• Last scan file count: ${debug.fileWatcher.lastScanFileCount}\n`;
            message += `• Average scan time: ${debug.fileWatcher.averageScanTimeFormatted || 'N/A'}\n`;
            message += `• Total scan time: ${debug.fileWatcher.totalScanTimeFormatted || 'N/A'}\n`;
            message += `• Last scan started: ${debug.fileWatcher.lastScanStartTime ? new Date(debug.fileWatcher.lastScanStartTime).toLocaleString() : 'N/A'}\n`;
            message += `• Last scan ended: ${debug.fileWatcher.lastScanEndTime ? new Date(debug.fileWatcher.lastScanEndTime).toLocaleString() : 'N/A'}\n`;
            
            if (debug.fileWatcher.totalScansPerformed > 0) {
                const avgFilesPerScan = debug.fileWatcher.lastScanFileCount / debug.fileWatcher.totalScansPerformed;
                const avgTimePerFile = debug.fileWatcher.averageScanTime / Math.max(1, debug.fileWatcher.lastScanFileCount);
                message += `\nPerformance Metrics:\n`;
                message += `• Average files per scan: ${Math.round(avgFilesPerScan)}\n`;
                message += `• Average time per file: ${Math.round(avgTimePerFile)}ms\n`;
            }
            
            alert(message);
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


    async rebuildDatabase() {
        if (confirm('Are you sure you want to rebuild the database? This will clear all data and re-scan all watched directories. This cannot be undone.')) {
            try {
                this.showLoading(true);
                const result = await window.electronAPI.rebuildDatabase();
                if (result.success) {
                    alert(result.message);
                    // Reload subfolders and photos
                    await this.loadSubfolders();
                    await this.loadPhotos(true);
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Error rebuilding database:', error);
                alert('Failed to rebuild database');
            } finally {
                this.showLoading(false);
            }
        }
    }

    async updateDatabase() {
        if (confirm('Update database by scanning all watched directories for new files?')) {
            try {
                this.showLoading(true);
                console.log('Starting database update...');
                const result = await window.electronAPI.updateDatabase();
                console.log('Database update result:', result);
                if (result.success) {
                    alert(`Database update completed successfully!\n\nFiles processed: ${result.filesProcessed}\nNew files added: ${result.newFilesAdded}\nScan duration: ${result.scanDuration}`);
                    // Reload subfolders and photos to show any new content
                    await this.loadSubfolders();
                    await this.loadPhotos(true);
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Error updating database:', error);
                alert('Failed to update database');
            } finally {
                this.showLoading(false);
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
        
        // Load config first
        await this.loadConfig();
        
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
        await this.loadWatchedDirectories();
        await this.loadSubfolders();
        // Don't call loadPhotos() here since refreshPhotos() is called in loadConfig()
    }

    async loadConfig() {
        try {
            this.config = await window.electronAPI.getConfig();
            console.log('Loaded config:', this.config);
            
            // Apply config to UI
            this.thumbnailDensity = this.config.thumbnailDensity || 'medium';
            this.includeNsfw = this.config.includeNsfw !== undefined ? this.config.includeNsfw : true;
            this.nsfwOnly = this.config.nsfwOnly || false;
            this.favoritesOnly = this.config.favoritesOnly || false;
            this.viewMode = this.config.viewMode || 'grid';
            
            // Update UI elements
            document.getElementById('densitySelect').value = this.thumbnailDensity;
            document.getElementById('sortBy').value = this.config.sortBy || 'date_taken';
            document.getElementById('sortOrder').value = this.config.sortOrder || 'DESC';
            
            // Update filter button states
            const nsfwButton = document.getElementById('nsfwFilter');
            nsfwButton.classList.toggle('active', this.includeNsfw);
            nsfwButton.classList.toggle('nsfw-only', this.nsfwOnly);
            document.getElementById('favoritesFilter').classList.toggle('active', this.favoritesOnly);
            
            // Update view mode
            this.setViewMode(this.viewMode);
            
            // Apply filters after config is loaded
            this.refreshPhotos();
            
            // Update clear search button state
            this.updateClearSearchButton();
            
        } catch (error) {
            console.error('Error loading config:', error);
        }
    }

    async saveConfig() {
        try {
            const configUpdates = {
                thumbnailDensity: this.thumbnailDensity,
                includeNsfw: this.includeNsfw,
                nsfwOnly: this.nsfwOnly,
                favoritesOnly: this.favoritesOnly,
                sortBy: document.getElementById('sortBy').value,
                sortOrder: document.getElementById('sortOrder').value,
                viewMode: this.viewMode
            };
            
            this.config = await window.electronAPI.updateConfig(configUpdates);
            console.log('Config saved:', this.config);
        } catch (error) {
            console.error('Error saving config:', error);
        }
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

    showEmptyState() {
        const gallery = document.getElementById('galleryGrid');
        gallery.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-file-earmark-plus"></i>
                <h3>No Photos</h3>
                <p>Click here to add a directory or ZIP archive</p>
            </div>
        `;
        
        // Add click handler to the empty state
        const emptyState = gallery.querySelector('.empty-state');
        emptyState.addEventListener('click', () => {
            this.addDirectory();
        });
    }

    showNoResultsState() {
        const gallery = document.getElementById('galleryGrid');
        gallery.innerHTML = `
            <div class="no-results-state">
                <i class="bi bi-search"></i>
                <h3>No Results Found</h3>
                <p>Try adjusting your search or filters</p>
            </div>
        `;
    }

    restoreInputFocus() {
        // Ensure all inputs are properly enabled and focusable
        const searchInput = document.getElementById('searchInput');
        const searchBtn = document.getElementById('searchBtn');
        
        if (searchInput) {
            searchInput.disabled = false;
            searchInput.style.pointerEvents = '';
            searchInput.style.opacity = '';
            searchInput.removeAttribute('readonly');
            searchInput.style.cursor = '';
        }
        
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.style.pointerEvents = '';
            searchBtn.style.cursor = '';
        }
        
        // Ensure all buttons are enabled but don't override their styles
        const allButtons = document.querySelectorAll('button');
        allButtons.forEach(btn => {
            btn.disabled = false;
            btn.style.pointerEvents = '';
        });
    }

    async handlePhotosUpdated() {
        try {
            // Reload subfolders and photos (watched directories don't change during file updates)
            await this.loadSubfolders();
            await this.loadPhotos(true);
            console.log('Gallery refreshed automatically after file changes');
        } catch (error) {
            console.error('Error handling photos updated event:', error);
        }
    }

    changeDensity(density) {
        this.thumbnailDensity = density;
        this.calculateGridDimensions();
        if (this.viewMode === 'grid') {
            this.updateGridLayout();
            this.loadPhotos(true); // Reload with new page size
        }
        this.saveConfig(); // Save setting
    }

    async getExcludedNsfwCount() {
        // Build filter options for NSFW favorites that would be excluded
        const nsfwFilters = {
            ...this.currentFilters,
            isFavorite: true,  // Only favorites
            nsfwOnly: true,    // Only NSFW content
            excludeNsfw: false // Don't exclude NSFW for this count
        };
        
        // Remove conflicting filters
        delete nsfwFilters.excludeNsfw;
        
        try {
            const nsfwFavorites = await window.electronAPI.getPhotos({ 
                ...nsfwFilters, 
                limit: 999999, 
                offset: 0 
            });
            return nsfwFavorites.length;
        } catch (error) {
            console.error('Error getting NSFW count:', error);
            return 0;
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
