export interface MusicMetadata {
  artist: string;
  title: string;
  genre: string;
  album: string;
}

export interface FileWithMissingTags {
  path: string;
  filename: string;
  missingTags: Array<'artist' | 'genre' | 'title' | 'album'>;
  existingMetadata: Partial<MusicMetadata>;
}

export interface CacheEntry {
  artist?: string;
  title?: string;
  genre?: string;
  album?: string;
  usedAt: number;
}

export interface Cache {
  entries: Record<string, CacheEntry>;
  recentGenres: string[];
  recentArtists: string[];
  recentDirectories: string[];
}

export interface InferredMetadata {
  artist: string | null;
  title: string | null;
  genre: string | null;
  album: string | null;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

export interface Config {
  scanPaths: string[];
  excludePatterns: string[];
  durationToleranceSeconds: number;
  duplicateScoreThreshold: number;
  supportedExtensions: string[];
}

export interface ScanState {
  lastProcessedFile: string | null;
  processedCount: number;
  startedAt: string;
  resumedAt?: string;
}

export interface AudioFileMetadata {
  path: string;
  filename: string;
  size: number;
  duration: number | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  trackNumber: number | null;
  genre: string | null;
  format: string;
  lossless: boolean;
  scannedAt: string;
}

export interface DuplicateGroup {
  id: string;
  confidence: number;
  files: string[];
  matchReasons: string[];
  suggestedKeep: string | null;
}

export interface DuplicatesFile {
  generatedAt: string;
  totalGroups: number;
  groups: DuplicateGroup[];
}

export interface Decision {
  groupId: string;
  keep: string[];
  delete: string[];
  notDuplicates: boolean;
}

export interface DecisionsFile {
  reviewedAt: string;
  decisions: Decision[];
}

export interface DeletionLogEntry {
  path: string;
  deletedAt: string;
  method: 'trash' | 'permanent';
  success: boolean;
  error?: string;
}

export interface DeletionLog {
  executedAt: string;
  entries: DeletionLogEntry[];
}
