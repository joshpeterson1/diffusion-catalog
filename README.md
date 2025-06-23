# Diffusion Catalog

A desktop application for managing and cataloging diffusion-generated photos with smart metadata handling and efficient performance for large collections.

## Features

- **Photo Gallery**: Thumbnail grid and list views with smooth scrolling
- **Hierarchical Folder Navigation**: Tree view with expand/collapse for organized browsing
- **Smart Metadata**: Automatic extraction of AI prompts, generation parameters, and EXIF data
- **Archive Support**: Browse images inside ZIP files without extraction
- **File Watching**: Auto-updates as new photos are added to watched directories
- **Fast Search**: Search by prompts, models, parameters, tags, dates, and filenames
- **Advanced Filtering**: NSFW filtering, favorites-only mode, folder-specific filtering
- **User Annotations**: Favorites, custom tags, NSFW markers, ratings, and notes
- **Debug Tools**: Database statistics, performance monitoring, manual database updates
- **Performance Optimized**: Handles 100k+ photos with lazy loading and efficient pagination

## Installation (Executable)
1. Check releases, download, and run the installer

## Installation (Manual)

1. Clone the repository:
```bash
git clone https://github.com/your-username/diffusion-catalog
cd diffusion-catalog
```

2. Install dependencies:
```bash
npm install
```

3. Run the application:
```bash
npm start
```

## Development

Run in development mode with DevTools:
```bash
npm run dev
```

Build for distribution:
```bash
npm run build
```

## Usage

1. **Add Directories**: Use File → Add Directory to watch folders containing your images
2. **Browse Photos**: Navigate using the hierarchical folder tree or view all photos
3. **Search & Filter**: Use the search bar and filter options to find specific images
4. **View Details**: Click any photo to see full metadata, AI parameters, and EXIF data
5. **Organize**: Mark favorites, add tags, set NSFW flags, and rate your images

## Architecture

- **Main Process**: File operations, metadata extraction, database management
- **Renderer Process**: Gallery UI, search interface, photo viewer
- **Database**: SQLite for fast queries and metadata storage
- **File Watching**: Real-time monitoring of photo directories

## Supported Formats

- **Images**: JPEG (.jpg, .jpeg), PNG (.png), WebP (.webp), TIFF (.tiff), BMP (.bmp)
- **Archives**: ZIP files (.zip) containing images

## AI Metadata Support

The app automatically extracts AI generation parameters from:
- EXIF UserComment and ImageDescription fields
- PNG text chunks (common in AI tools)
- Common formats from Stable Diffusion, ComfyUI, Automatic1111, and other AI tools
- Supports prompts, negative prompts, seeds, models, samplers, and generation parameters

## Performance Features

- Lazy thumbnail generation
- Hierarchical folder tree for efficient navigation
- Smart pagination and virtual scrolling
- JIT metadata parsing
- Background file processing
- Manual database scanning and updates

## Configuration

- **Database**: Stored in your system's user data directory
- **Thumbnails**: Cached locally for fast loading
- **Settings**: Automatically saved (view mode, filters, sort preferences)

## License

MIT License
