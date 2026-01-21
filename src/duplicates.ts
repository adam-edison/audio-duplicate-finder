import { dirname } from 'node:path';
import levenshtein from 'fast-levenshtein';
import type { AudioFileMetadata, DuplicateGroup, Config } from './types.js';
import { countFilledTags, getQualityScore } from './metadata.js';

interface MatchResult {
  score: number;
  reasons: string[];
}

export function findDuplicates(
  files: Map<string, AudioFileMetadata>,
  config: Config
): DuplicateGroup[] {
  const fileList = Array.from(files.values());
  const matches = new Map<string, Set<string>>();

  for (let i = 0; i < fileList.length; i++) {
    for (let j = i + 1; j < fileList.length; j++) {
      const result = compareFiles(fileList[i], fileList[j], config);

      if (result.score < config.duplicateScoreThreshold) {
        continue;
      }

      const pathA = fileList[i].path;
      const pathB = fileList[j].path;

      if (!matches.has(pathA)) {
        matches.set(pathA, new Set());
      }
      if (!matches.has(pathB)) {
        matches.set(pathB, new Set());
      }

      matches.get(pathA)!.add(pathB);
      matches.get(pathB)!.add(pathA);
    }
  }

  const groups = buildTransitiveClusters(matches);
  const duplicateGroups: DuplicateGroup[] = [];
  let groupId = 1;

  for (const group of groups) {
    const groupFiles = Array.from(group);
    const avgConfidence = calculateGroupConfidence(groupFiles, files, config);
    const matchReasons = collectMatchReasons(groupFiles, files, config);
    const suggestedKeep = selectBestFile(groupFiles, files);

    duplicateGroups.push({
      id: `group-${groupId++}`,
      confidence: avgConfidence,
      files: groupFiles,
      matchReasons,
      suggestedKeep,
    });
  }

  return duplicateGroups.sort((a, b) => b.confidence - a.confidence);
}

function compareFiles(
  a: AudioFileMetadata,
  b: AudioFileMetadata,
  config: Config
): MatchResult {
  let score = 0;
  const reasons: string[] = [];

  const durationMatch = checkDurationMatch(a, b, config.durationToleranceSeconds);
  if (durationMatch) {
    score += 40;
    reasons.push('duration');
  }

  const artistTitleMatch = checkArtistTitleMatch(a, b);
  if (artistTitleMatch) {
    score += 30;
    reasons.push('artist+title');
  }

  const filenameMatch = checkFilenameMatch(a, b);
  if (filenameMatch) {
    score += 20;
    reasons.push('filename');
  }

  const albumMatch = checkAlbumMatch(a, b);
  if (albumMatch) {
    score += 10;
    reasons.push('album');
  }

  const differentLocation = checkDifferentLocation(a, b);
  if (differentLocation) {
    score += 10;
    reasons.push('different-location');
  }

  return { score, reasons };
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

  return similarity >= 0.8;
}

function checkAlbumMatch(a: AudioFileMetadata, b: AudioFileMetadata): boolean {
  if (!a.album || !b.album) {
    return false;
  }

  return normalizeString(a.album) === normalizeString(b.album);
}

function checkDifferentLocation(a: AudioFileMetadata, b: AudioFileMetadata): boolean {
  const rootA = getRootFolder(a.path);
  const rootB = getRootFolder(b.path);

  return rootA !== rootB;
}

function getRootFolder(path: string): string {
  const parts = path.split('/').filter(Boolean);

  if (parts.length < 2) {
    return path;
  }

  if (parts[0] === 'Volumes' && parts.length >= 2) {
    return `/${parts[0]}/${parts[1]}`;
  }

  if (parts[0] === 'Users' && parts.length >= 3) {
    return `/${parts[0]}/${parts[1]}/${parts[2]}`;
  }

  return `/${parts[0]}`;
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

function buildTransitiveClusters(matches: Map<string, Set<string>>): Set<string>[] {
  const visited = new Set<string>();
  const clusters: Set<string>[] = [];

  for (const path of matches.keys()) {
    if (visited.has(path)) {
      continue;
    }

    const cluster = new Set<string>();
    const queue = [path];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);
      cluster.add(current);

      const neighbors = matches.get(current);

      if (!neighbors) {
        continue;
      }

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (cluster.size > 1) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

function calculateGroupConfidence(
  groupFiles: string[],
  files: Map<string, AudioFileMetadata>,
  config: Config
): number {
  let totalScore = 0;
  let comparisons = 0;

  for (let i = 0; i < groupFiles.length; i++) {
    for (let j = i + 1; j < groupFiles.length; j++) {
      const a = files.get(groupFiles[i]);
      const b = files.get(groupFiles[j]);

      if (!a || !b) {
        continue;
      }

      const result = compareFiles(a, b, config);
      totalScore += result.score;
      comparisons++;
    }
  }

  if (comparisons === 0) {
    return 0;
  }

  return Math.round(totalScore / comparisons);
}

function collectMatchReasons(
  groupFiles: string[],
  files: Map<string, AudioFileMetadata>,
  config: Config
): string[] {
  const allReasons = new Set<string>();

  for (let i = 0; i < groupFiles.length; i++) {
    for (let j = i + 1; j < groupFiles.length; j++) {
      const a = files.get(groupFiles[i]);
      const b = files.get(groupFiles[j]);

      if (!a || !b) {
        continue;
      }

      const result = compareFiles(a, b, config);

      for (const reason of result.reasons) {
        allReasons.add(reason);
      }
    }
  }

  return Array.from(allReasons);
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
