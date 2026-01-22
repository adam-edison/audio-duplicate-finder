import type { InferredMetadata } from './types.js';
import type { SearchResult } from './search.js';
import type { ParsedFilename } from './parser.js';

export interface BatchFileInfo {
  index: number;
  filename: string;
  parsed: ParsedFilename;
  existingArtist: string | null;
  existingTitle: string | null;
  existingGenre: string | null;
  existingAlbum: string | null;
}

export function inferMetadataBatch(
  files: BatchFileInfo[]
): Map<number, InferredMetadata> {
  const results = new Map<number, InferredMetadata>();

  for (const file of files) {
    results.set(file.index, {
      artist: file.parsed.possibleArtist,
      title: file.parsed.possibleTitle,
      genre: null,
      album: null,
      confidence: file.parsed.possibleArtist && file.parsed.possibleTitle ? 'medium' : 'low',
      source: 'Parsed from filename',
    });
  }

  return results;
}

export function inferMetadata(
  parsed: ParsedFilename,
  _searchResults: SearchResult[],
  _missingFields: string[]
): InferredMetadata {
  return {
    artist: parsed.possibleArtist,
    title: parsed.possibleTitle,
    genre: null,
    album: null,
    confidence: parsed.possibleArtist && parsed.possibleTitle ? 'medium' : 'low',
    source: 'Parsed from filename',
  };
}
