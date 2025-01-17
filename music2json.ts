#!/usr/bin/env node

// Import required libraries
import { promises as fs } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { parseFile } from 'music-metadata';
import { config } from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPPORTED_FILE_TYPES = [".m4a", ".aac", ".mp4", ".mp3", ".flac", ".ogg"] as const;
type SupportedFileType = typeof SUPPORTED_FILE_TYPES[number];

type Track = {
  title: string;
};

type Album = {
  albumTitle: string;
  genres: string[];
  tracks: Track[];
};

type Artist = {
  artistName: string;
  albums: Album[];
};

type ProcessingError = {
  file: string;
  error: string;
};

process.on('uncaughtException', (err: unknown) => {
  // Only log and continue for file descriptor errors
  if (err && typeof err === 'object' && 'code' in err && 'syscall' in err) {
    if (err.code === 'EBADF' && err.syscall === 'close') {
      // Try to extract the file path from the error message
      let filePath = 'unknown file';
      if ('stack' in err && typeof err.stack === 'string') {
        // Look for paths in the stack trace
        const match = err.stack.match(/Processing track ([^:]+):/);
        if (match) {
          filePath = match[1];
        }
      }
      console.error(`Warning: File descriptor error occurred but processing will continue: ${filePath}`);
      return;
    }
  }
  // For other errors, log and exit
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function getVersion(): Promise<string> {
  try {
    const packageJson = JSON.parse(
      await readFile(join(__dirname, 'package.json'), 'utf-8')
    );
    return packageJson.version;
  } catch (err) {
    return '1.0.0';
  }
}

async function processAlbum(albumPath: string, albumName: string): Promise<{ album: Album | null; errors: ProcessingError[] }> {
  const errors: ProcessingError[] = [];
  try {
    const album: Album = { albumTitle: albumName, tracks: [], genres: [] };
    
    // Get the list of music files
    const trackFiles = await fs.readdir(albumPath, { withFileTypes: true });
    const musicFiles = trackFiles.filter(file => 
      file.isFile() && SUPPORTED_FILE_TYPES.includes(extname(file.name).toLowerCase() as SupportedFileType)
    );

    if (musicFiles.length === 0) return { album: null, errors };

    // Process files in batches of 10
    const batchSize = 10;
    let allGenres = new Set<string>();
    for (let i = 0; i < musicFiles.length; i += batchSize) {
      const batch = musicFiles.slice(i, Math.min(i + batchSize, musicFiles.length));
      const batchPromises = batch.map(async (trackFile) => {
        const filePath = join(albumPath, trackFile.name);
        try {
          const { common } = await parseFile(filePath, { 
            duration: false,
            skipPostHeaders: true,
            skipCovers: true,
          });
          
          if (common.genre) {
            common.genre.forEach(genre => allGenres.add(genre));
          }
          
          return {
            title: common.title || trackFile.name,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({ file: filePath, error: errorMessage });
          return null;
        }
      });

      // Wait for the current batch to complete before moving to the next
      const tracks = (await Promise.all(batchPromises)).filter((track): track is Track => track !== null);
      album.tracks.push(...tracks);
    }

    album.genres = Array.from(allGenres);

    return { 
      album: album.tracks.length > 0 ? album : null, 
      errors 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push({ file: albumPath, error: errorMessage });
    return { album: null, errors };
  }
}

async function scanDirectory(directory: string, limit: number): Promise<{ artists: Artist[]; errors: ProcessingError[] }> {
  const artists: Artist[] = [];
  const errors: ProcessingError[] = [];
  console.log(`Scanning directory: ${directory}`);

  // Get the list of artist directories
  const artistDirs = await fs.readdir(directory, { withFileTypes: true });
  const dirsToProcess = limit > 0 ? artistDirs.slice(0, limit) : artistDirs;

  // Process artists sequentially
  for (const artistDir of dirsToProcess) {
    if (artistDir.isDirectory()) {
      const artistPath = join(directory, artistDir.name);
      console.log(`Processing artist: ${artistDir.name}`);
      const artist: Artist = { artistName: artistDir.name, albums: [] };

      // Get the list of album directories
      const albumDirs = await fs.readdir(artistPath, { withFileTypes: true });

      // Process albums sequentially
      for (const albumDir of albumDirs) {
        if (albumDir.isDirectory()) {
          const result = await processAlbum(join(artistPath, albumDir.name), albumDir.name);
          if (result.album) {
            artist.albums.push(result.album);
          }
          errors.push(...result.errors);
        }
      }

      if (artist.albums.length > 0) {
        artists.push(artist);
      }
    }
  }

  return { artists, errors };
}

async function main() {
  // Load environment variables from .env file
  config();

  const version = await getVersion();

  // Parse command line arguments
  const argv = await yargs(hideBin(process.argv))
    .option('music-dir', {
      alias: 'm',
      type: 'string',
      description: 'Path to your music directory',
      default: process.env.MUSIC_PATH
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output directory or file path',
      default: process.env.OUTPUT_PATH || '.'
    })
    .option('limit', {
      alias: 'l',
      type: 'number',
      description: 'Limit the number of artists to process',
      default: 0
    })
    .version('version', 'Show version number', version)
    .alias('version', 'v')
    .help()
    .argv;

  const musicDirectory = argv['music-dir'];
  let outputPath = argv.output;
  const limit = argv.limit;

  if (!musicDirectory) {
    console.error('Error: Music directory not specified. Please provide it via .env file or --music-dir argument');
    process.exit(1);
  }

  try {
    // Check if music directory exists
    try {
      await fs.access(musicDirectory);
    } catch (err) {
      console.error(`Error: Music directory "${musicDirectory}" does not exist or is not accessible`);
      process.exit(1);
    }

    // Determine if outputPath is a directory or file
    let outputFile: string;
    try {
      const stats = await fs.stat(outputPath);
      if (stats.isDirectory()) {
        outputFile = join(outputPath, 'music_metadata.json');
      } else {
        outputFile = outputPath;
      }
    } catch (err) {
      // If path doesn't exist, check if it has a file extension
      if (extname(outputPath)) {
        // If it has an extension, assume it's a file path
        outputFile = outputPath;
      } else {
        // If no extension, treat as directory and append default filename
        outputFile = join(outputPath, 'music_metadata.json');
      }
    }

    console.log(`Starting scan of music directory: ${musicDirectory}`);
    console.log(`Will save results to: ${outputFile}`);

    // Create output directory if it doesn't exist
    const outputDir = dirname(outputFile);
    await fs.mkdir(outputDir, { recursive: true });

    const { artists, errors } = await scanDirectory(musicDirectory, limit);
    
    // Save progress even if we encounter errors
    if (artists.length > 0) {
      console.log(`\nWriting ${artists.length} artists to file...`);
      const jsonString = JSON.stringify(artists, null, 2);
      
      // Replace multi-line genre arrays with single-line
      const compactJson = jsonString.replace(
        /("genres":\s*\[)([\s\n]*)((?:[^[\]]|\[[^\]]*\])*)([\s\n]*)(\])/g,
        (_, start, ws1, items, ws2, end) => `${start}${items.trim().replace(/\s+/g, ' ')}${end}`
      );
      
      await fs.writeFile(outputFile, compactJson, "utf-8");
      console.log(`Music library JSON saved to ${outputFile}`);
    }

    if (errors.length > 0) {
      console.log(`\nEncountered ${errors.length} errors during processing:`);
      const errorFile = join(dirname(outputFile), 'music_metadata_errors.json');
      await fs.writeFile(errorFile, JSON.stringify(errors, null, 2), "utf-8");
      console.log(`Processing errors saved to ${errorFile}`);
      
      // Log a sample of errors
      console.log('\nSample of errors encountered:');
      errors.slice(0, 5).forEach(({ file, error }) => {
        console.log(`  - ${file}: ${error}`);
      });
      if (errors.length > 5) {
        console.log(`  ... and ${errors.length - 5} more errors (see ${errorFile} for full list)`);
      }
    }

    // Exit successfully even if we had some errors
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
