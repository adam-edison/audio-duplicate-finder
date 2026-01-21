import levenshtein from 'fast-levenshtein';
import type { AudioFileMetadata, DuplicateGroup, Config } from './types.js';
import { countFilledTags, getQualityScore } from './metadata.js';

interface MatchResult {
  isMatch: boolean;
  confidence: number;
  reasons: string[];
}

export function findDuplicates(
  files: Map<string, AudioFileMetadata>,
  config: Config
): DuplicateGroup[] {
  const fileList = Array.from(files.values());
  const pairs: DuplicateGroup[] = [];
  let pairId = 1;

  for (let i = 0; i < fileList.length; i++) {
    for (let j = i + 1; j < fileList.length; j++) {
      const result = compareFiles(fileList[i], fileList[j], config);

      if (!result.isMatch) {
        continue;
      }

      const pathA = fileList[i].path;
      const pathB = fileList[j].path;
      const suggestedKeep = selectBestFile([pathA, pathB], files);

      pairs.push({
        id: `pair-${pairId++}`,
        confidence: result.confidence,
        files: [pathA, pathB],
        matchReasons: result.reasons,
        suggestedKeep,
      });
    }
  }

  return pairs.sort((a, b) => b.confidence - a.confidence);
}

function compareFiles(
  a: AudioFileMetadata,
  b: AudioFileMetadata,
  config: Config
): MatchResult {
  const reasons: string[] = [];
  let confidence = 0;

  const artistTitleMatch = checkArtistTitleMatch(a, b);
  const filenameMatch = checkFilenameMatch(a, b);
  const durationMatch = checkDurationMatch(a, b, config.durationToleranceSeconds);

  if (!artistTitleMatch && !filenameMatch) {
    return { isMatch: false, confidence: 0, reasons: [] };
  }

  if (artistTitleMatch) {
    confidence += 50;
    reasons.push('artist+title');
  }

  if (filenameMatch) {
    confidence += 30;
    reasons.push('filename');
  }

  if (durationMatch) {
    confidence += 15;
    reasons.push('duration');
  }

  const albumMatch = checkAlbumMatch(a, b);

  if (albumMatch) {
    confidence += 5;
    reasons.push('album');
  }

  return { isMatch: true, confidence, reasons };
}

function checkDurationMatch(
  a: AudioFileMetadata,
  b: AudioFileMetadata,
  tolerance: number
): boolean {
  if (a.duration === null || b.duration === null) {
    return false;
  }

  return Math.abs(a.duration - b.duration) <= tolerance;
}

function checkArtistTitleMatch(a: AudioFileMetadata, b: AudioFileMetadata): boolean {
  if (!a.artist || !b.artist || !a.title || !b.title) {
    return false;
  }

  const artistA = normalizeString(a.artist);
  const artistB = normalizeString(b.artist);
  const titleA = normalizeString(a.title);
  const titleB = normalizeString(b.title);

  return artistA === artistB && titleA === titleB;
}

function checkFilenameMatch(a: AudioFileMetadata, b: AudioFileMetadata): boolean {
  const parsedA = parseFilenameForComparison(a.filename);
  const parsedB = parseFilenameForComparison(b.filename);

  if (parsedA.artist && parsedB.artist && parsedA.title && parsedB.title) {
    const artistMatch = normalizeString(parsedA.artist) === normalizeString(parsedB.artist);
    const titleMatch = normalizeString(parsedA.title) === normalizeString(parsedB.title);

    if (artistMatch && titleMatch) {
      return true;
    }
  }

  const normalizedA = normalizeFilename(a.filename);
  const normalizedB = normalizeFilename(b.filename);

  if (normalizedA === normalizedB) {
    return true;
  }

  const maxLen = Math.max(normalizedA.length, normalizedB.length);

  if (maxLen === 0) {
    return false;
  }

  const distance = levenshtein.get(normalizedA, normalizedB);
  const similarity = 1 - distance / maxLen;

  return similarity >= 0.9;
}

function checkAlbumMatch(a: AudioFileMetadata, b: AudioFileMetadata): boolean {
  if (!a.album || !b.album) {
    return false;
  }

  return normalizeString(a.album) === normalizeString(b.album);
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFilename(filename: string): string {
  let normalized = filename;

  normalized = normalized.replace(/\.[^.]+$/, '');
  normalized = normalized.replace(/^(\d{1,3}[\.\-\s_])+/, '');
  normalized = normalized.replace(/\(\d+\)$/, '');
  normalized = normalized.replace(/\[\d+\]$/, '');
  normalized = normalized.replace(/\b\d{3,4}k(bps)?\b/gi, '');
  normalized = normalized.replace(/\b(128|192|256|320)\b/g, '');
  normalized = normalized.replace(/\[.*?\]/g, '');
  normalized = normalized.replace(/\(.*?\)/g, '');

  return normalizeString(normalized);
}

interface ParsedFilename {
  artist: string | null;
  title: string | null;
}

function parseFilenameForComparison(filename: string): ParsedFilename {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  const separators = [' - ', ' – ', ' — ', '_-_', ' _ '];

  for (const sep of separators) {
    const index = withoutExt.indexOf(sep);

    if (index === -1) {
      continue;
    }

    return {
      artist: withoutExt.slice(0, index).trim(),
      title: withoutExt.slice(index + sep.length).trim(),
    };
  }

  return { artist: null, title: null };
}

function selectBestFile(
  groupFiles: string[],
  files: Map<string, AudioFileMetadata>
): string | null {
  let bestFile: string | null = null;
  let bestScore = -1;

  for (const path of groupFiles) {
    const metadata = files.get(path);

    if (!metadata) {
      continue;
    }

    const tagCount = countFilledTags(metadata);
    const qualityScore = getQualityScore(metadata);
    const combinedScore = tagCount * 1000 + qualityScore;

    if (combinedScore <= bestScore) {
      continue;
    }

    bestScore = combinedScore;
    bestFile = path;
  }

  return bestFile;
}
