import { readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { parseFile } from 'music-metadata';
import type { FileWithMissingTags, MusicMetadata, Config } from './types.js';

const MUSIC_EXTENSIONS = new Set(['.mp3', '.mp4', '.m4a', '.aac', '.flac', '.ogg', '.wav', '.wma']);
const REQUIRED_TAGS = ['artist', 'genre', 'title', 'album'] as const;

type RequiredTag = (typeof REQUIRED_TAGS)[number];

export async function findMusicFiles(dir: string): Promise<string[]> {
  const musicFiles: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await findMusicFiles(fullPath);
      musicFiles.push(...nestedFiles);
      continue;
    }

    const ext = extname(entry.name).toLowerCase();

    if (MUSIC_EXTENSIONS.has(ext)) {
      musicFiles.push(fullPath);
    }
  }

  return musicFiles;
}

export async function scanWithRipgrep(
  scanPaths: string[],
  extensions: string[],
  excludePatterns: string[],
  onFile: (path: string) => void
): Promise<number> {
  let totalFiles = 0;

  for (const scanPath of scanPaths) {
    const count = await scanPathWithRipgrep(scanPath, extensions, excludePatterns, onFile);
    totalFiles += count;
  }

  return totalFiles;
}

async function scanPathWithRipgrep(
  scanPath: string,
  extensions: string[],
  excludePatterns: string[],
  onFile: (path: string) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = ['--files'];

    for (const ext of extensions) {
      args.push('-g', `*.${ext}`);
    }

    for (const pattern of excludePatterns) {
      args.push('-g', `!${pattern}`);
    }

    args.push(scanPath);

    const rg = spawn('rg', args);
    let fileCount = 0;
    let buffer = '';

    rg.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed) {
          fileCount++;
          onFile(trimmed);
        }
      }
    });

    rg.stderr.on('data', (data: Buffer) => {
      const error = data.toString();

      if (!error.includes('Permission denied') && !error.includes('No such file')) {
        console.error('rg stderr:', error);
      }
    });

    rg.on('close', (code) => {
      if (buffer.trim()) {
        fileCount++;
        onFile(buffer.trim());
      }

      if (code === 0 || code === 1) {
        resolve(fileCount);
      } else {
        reject(new Error(`ripgrep exited with code ${code}`));
      }
    });

    rg.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('ripgrep (rg) is not installed. Please install it: brew install ripgrep'));
      } else {
        reject(err);
      }
    });
  });
}

export async function checkMissingTags(filePath: string): Promise<FileWithMissingTags | null> {
  try {
    const metadata = await parseFile(filePath);
    const { common } = metadata;

    const missingTags: RequiredTag[] = [];
    const existingMetadata: Partial<MusicMetadata> = {};

    if (!common.artist && !common.artists?.length) {
      missingTags.push('artist');
    } else {
      existingMetadata.artist = common.artist ?? common.artists?.[0];
    }

    if (!common.genre?.length) {
      missingTags.push('genre');
    } else {
      existingMetadata.genre = common.genre[0];
    }

    if (!common.title) {
      missingTags.push('title');
    } else {
      existingMetadata.title = common.title;
    }

    if (!common.album) {
      missingTags.push('album');
    } else {
      existingMetadata.album = common.album;
    }

    if (missingTags.length === 0) {
      return null;
    }

    return {
      path: filePath,
      filename: basename(filePath),
      missingTags,
      existingMetadata,
    };
  } catch (error) {
    console.error(`Error reading metadata for ${filePath}:`, error);
    return null;
  }
}
