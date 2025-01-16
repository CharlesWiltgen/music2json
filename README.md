# music2json

A TypeScript utility that scans a music library directory and generates a JSON file containing metadata about artists, albums, and tracks.

## Features

- Extracts metadata from various audio formats (MP3, M4A, FLAC, OGG, etc.)
- Processes files in batches for improved performance
- Handles large music libraries efficiently
- Provides detailed error reporting
- Configurable via environment variables or command line arguments

## Installation

```bash
# Install globally
npm install -g music2json

# Or clone and install locally
git clone https://github.com/CharlesWiltgen/music2json.git
cd music2json
npm install
```

## Configuration

Create a `.env` file in the project root:

```env
MUSIC_PATH=/path/to/your/music/library
OUTPUT_PATH=/path/to/output/directory
```

Or use command line arguments:

```bash
music2json --music-dir="/path/to/music" --output="/path/to/output"
```

## Usage

```bash
# Using environment variables from .env
music2json

# Or with explicit paths
music2json --music-dir="/Volumes/Media/Music" --output="/path/to/output"

# Show version
music2json --version

# Show help
music2json --help
```

The script will generate:
- `music_metadata.json`: Contains the successfully processed music library metadata
- `music_metadata_errors.json`: Lists any files that couldn't be processed (if any)

## Output Format

The generated JSON follows this structure:

```typescript
interface Track {
  title: string;
  genres: string[];
}

interface Album {
  name: string;
  tracks: Track[];
}

interface Artist {
  name: string;
  albums: Album[];
}
```

## Known Issues

- Some FLAC files may show "Invalid FLAC preamble" errors. This is usually due to corrupted FLAC files or files that don't strictly follow the FLAC format specification. The script will skip these files and continue processing.

## Error Handling

- The script handles file descriptor errors gracefully
- Processes files in batches to manage system resources
- Continues processing even if individual files fail
- Provides detailed error logs for troubleshooting

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Charles Wiltgen
