import { extname } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import NodeID3 from 'node-id3';
import type { MusicMetadata } from './types.js';

const execAsync = promisify(exec);

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch {
    return false;
  }
}

async function writeMp3Tags(filePath: string, metadata: MusicMetadata): Promise<void> {
  const tags: NodeID3.Tags = {};

  if (metadata.artist) {
    tags.artist = metadata.artist;
  }

  if (metadata.title) {
    tags.title = metadata.title;
  }

  if (metadata.genre) {
    tags.genre = metadata.genre;
  }

  if (metadata.album) {
    tags.album = metadata.album;
  }

  const success = NodeID3.update(tags, filePath);

  if (!success) {
    throw new Error('Failed to write MP3 tags');
  }
}

async function writeWithFfmpeg(filePath: string, metadata: MusicMetadata): Promise<void> {
  const hasFfmpeg = await checkFfmpeg();

  if (!hasFfmpeg) {
    throw new Error('ffmpeg is required for non-MP3 files. Please install ffmpeg.');
  }

  const tempPath = filePath.replace(/(\.[^.]+)$/, '_temp$1');

  const metadataArgs: string[] = [];

  if (metadata.artist) {
    metadataArgs.push('-metadata', `artist=${metadata.artist}`);
  }

  if (metadata.title) {
    metadataArgs.push('-metadata', `title=${metadata.title}`);
  }

  if (metadata.genre) {
    metadataArgs.push('-metadata', `genre=${metadata.genre}`);
  }

  if (metadata.album) {
    metadataArgs.push('-metadata', `album=${metadata.album}`);
  }

  const escapedInput = filePath.replace(/'/g, "'\\''");
  const escapedOutput = tempPath.replace(/'/g, "'\\''");

  const cmd = `ffmpeg -y -i '${escapedInput}' -c copy ${metadataArgs.map(a => `'${a}'`).join(' ')} '${escapedOutput}'`;

  await execAsync(cmd);
  await execAsync(`mv '${escapedOutput}' '${escapedInput}'`);
}

export async function writeMetadata(filePath: string, metadata: MusicMetadata): Promise<void> {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.mp3') {
    await writeMp3Tags(filePath, metadata);
    return;
  }

  await writeWithFfmpeg(filePath, metadata);
}
