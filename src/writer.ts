import { extname, dirname, basename } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { rename, unlink } from 'node:fs/promises';
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

interface ProbeResult {
  codec: string;
  correctExtension: string;
}

const CODEC_TO_EXTENSION: Record<string, string> = {
  opus: '.opus',
  vorbis: '.ogg',
  aac: '.m4a',
  mp3: '.mp3',
  flac: '.flac',
  alac: '.m4a',
  pcm_s16le: '.wav',
  pcm_s24le: '.wav',
  pcm_s32le: '.wav',
};

async function probeCodec(filePath: string): Promise<ProbeResult> {
  const escapedPath = filePath.replace(/'/g, "'\\''");
  const cmd = `ffprobe -v quiet -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 '${escapedPath}'`;

  try {
    const { stdout } = await execAsync(cmd);
    const codec = stdout.trim().toLowerCase();
    const correctExtension = CODEC_TO_EXTENSION[codec] ?? extname(filePath).toLowerCase();

    return { codec, correctExtension };
  } catch {
    return { codec: 'unknown', correctExtension: extname(filePath).toLowerCase() };
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

  const { correctExtension } = await probeCodec(filePath);
  const currentExtension = extname(filePath).toLowerCase();
  const dir = dirname(filePath);
  const baseName = basename(filePath, currentExtension);

  const needsRename = correctExtension !== currentExtension;
  const tempPath = `${dir}/${baseName}_temp${correctExtension}`;
  const finalPath = needsRename ? `${dir}/${baseName}${correctExtension}` : filePath;

  const escapeShell = (str: string): string => str.replace(/'/g, "'\\''");

  const metadataArgs: string[] = [];

  if (metadata.artist) {
    metadataArgs.push('-metadata', `artist=${escapeShell(metadata.artist)}`);
  }

  if (metadata.title) {
    metadataArgs.push('-metadata', `title=${escapeShell(metadata.title)}`);
  }

  if (metadata.genre) {
    metadataArgs.push('-metadata', `genre=${escapeShell(metadata.genre)}`);
  }

  if (metadata.album) {
    metadataArgs.push('-metadata', `album=${escapeShell(metadata.album)}`);
  }

  const escapedInput = escapeShell(filePath);
  const escapedOutput = escapeShell(tempPath);

  const cmd = `ffmpeg -y -i '${escapedInput}' -c copy ${metadataArgs.map(a => `'${a}'`).join(' ')} '${escapedOutput}'`;

  await execAsync(cmd);

  if (needsRename) {
    await rename(tempPath, finalPath);
    await unlink(filePath);
    console.log(`  Note: Renamed to ${basename(finalPath)} (correct format for codec)`);
  } else {
    await rename(tempPath, filePath);
  }
}

export async function writeMetadata(filePath: string, metadata: MusicMetadata): Promise<void> {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.mp3') {
    await writeMp3Tags(filePath, metadata);
    return;
  }

  await writeWithFfmpeg(filePath, metadata);
}
