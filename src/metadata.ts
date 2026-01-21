import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { parseFile } from 'music-metadata';
import type { AudioFileMetadata } from './types.js';

const LOSSLESS_FORMATS = new Set(['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv']);

export async function extractMetadata(filePath: string): Promise<AudioFileMetadata | null> {
  try {
    const [fileStats, metadata] = await Promise.all([
      stat(filePath),
      parseFile(filePath, { duration: true }),
    ]);

    const format = extname(filePath).slice(1).toLowerCase();

    return {
      path: filePath,
      filename: basename(filePath),
      size: fileStats.size,
      duration: metadata.format.duration ?? null,
      bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) : null,
      sampleRate: metadata.format.sampleRate ?? null,
      bitDepth: metadata.format.bitsPerSample ?? null,
      title: metadata.common.title ?? null,
      artist: metadata.common.artist ?? metadata.common.artists?.[0] ?? null,
      album: metadata.common.album ?? null,
      year: metadata.common.year ?? null,
      trackNumber: metadata.common.track?.no ?? null,
      genre: metadata.common.genre?.[0] ?? null,
      format,
      lossless: LOSSLESS_FORMATS.has(format),
      scannedAt: new Date().toISOString(),
    };
  } catch (error) {
    return null;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return 'unknown';
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function countFilledTags(metadata: AudioFileMetadata): number {
  let count = 0;

  if (metadata.title) count++;
  if (metadata.artist) count++;
  if (metadata.album) count++;
  if (metadata.year) count++;
  if (metadata.trackNumber) count++;
  if (metadata.genre) count++;

  return count;
}

export function getQualityScore(metadata: AudioFileMetadata): number {
  let score = 0;

  if (metadata.lossless) {
    score += 1000;
  }

  if (metadata.bitrate) {
    score += metadata.bitrate;
  }

  if (metadata.sampleRate) {
    score += metadata.sampleRate / 100;
  }

  if (metadata.bitDepth) {
    score += metadata.bitDepth * 10;
  }

  return score;
}
