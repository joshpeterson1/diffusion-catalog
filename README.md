# Diffusion Catalog

A desktop application for managing and cataloging AI-generated photos with smart metadata handling and efficient performance for large collections.

## Features

- **Photo Gallery**: Thumbnail grid view with smooth scrolling
- **Smart Metadata**: Automatic extraction of AI prompts, generation parameters, and EXIF data
- **File Watching**: Auto-updates as new photos are added to watched directories
- **Fast Search**: Search by tags, dates, AI parameters, and filenames
- **User Annotations**: Favorites, custom tags, NSFW markers, ratings, and notes
- **Performance Optimized**: Handles 100k+ photos with lazy loading and virtual scrolling

## Installation (Executable)
1. Hit up releases, download, run

## Installation (Manual)

1. Clone the repository:
```bash
git clone https://github.com/joshpeterson1/diffusion-catalog
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

## Architecture

- **Main Process**: File operations, metadata extraction, database management
- **Renderer Process**: Gallery UI, search interface, photo viewer
- **Database**: SQLite for fast queries and metadata storage
- **File Watching**: Real-time monitoring of photo directories

## Supported Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- TIFF (.tiff)
- BMP (.bmp)

## AI Metadata Support

The app automatically extracts AI generation parameters from:
- EXIF UserComment and ImageDescription fields
- PNG text chunks (common in AI tools)
- Common formats from Stable Diffusion, Midjourney, and other AI tools

## Performance Features

- Lazy thumbnail generation
- Virtual scrolling for large collections
- JIT metadata parsing
- Smart pagination by date ranges
- Background file processing

## License

MIT License
