import { basename, extname } from 'node:path';

export interface ParsedFilename {
  searchQuery: string;
  possibleArtist: string | null;
  possibleTitle: string | null;
}

const NOISE_PATTERNS = [
  /\[.*?\]/g,
  /\(.*?\)/g,
  /\{.*?\}/g,
  /\d{3,4}p/gi,
  /\b(mp3|mp4|m4a|flac|wav|aac|ogg|wma)\b/gi,
  /\b(320|256|192|128)\s*k(bps)?\b/gi,
  /\b(hq|hd|official|audio|video|lyrics?|lyric)\b/gi,
  /\b(www|http|https|com)\b/gi,
  /[_\-]+/g,
];

const TRACK_NUMBER_PATTERN = /^(\d{1,3}[\.\-\s])/;

export function parseFilename(filePath: string): ParsedFilename {
  const filename = basename(filePath, extname(filePath));

  let cleaned = filename.replace(TRACK_NUMBER_PATTERN, '');

  let possibleArtist: string | null = null;
  let possibleTitle: string | null = null;

  const separators = [' - ', ' – ', ' — ', ' _ ', ' by '];

  for (const sep of separators) {
    const sepIndex = cleaned.toLowerCase().indexOf(sep.toLowerCase());

    if (sepIndex === -1) {
      continue;
    }

    possibleArtist = cleaned.slice(0, sepIndex).trim();
    possibleTitle = cleaned.slice(sepIndex + sep.length).trim();
    break;
  }

  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  const searchQuery = cleaned || filename;

  return {
    searchQuery,
    possibleArtist,
    possibleTitle,
  };
}
