import { spawn } from 'node:child_process';
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

export interface BatchInferredMetadata extends InferredMetadata {
  index: number;
}

function runClaude(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`Exit code ${code}: ${stderr}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function inferMetadataBatch(
  files: BatchFileInfo[]
): Promise<Map<number, InferredMetadata>> {
  const results = new Map<number, InferredMetadata>();

  if (files.length === 0) {
    return results;
  }

  const fileList = files.map((f) => {
    const parts = [];
    parts.push(`[${f.index}] ${f.filename}`);

    if (f.parsed.possibleArtist && f.parsed.possibleTitle) {
      parts.push(`    Pattern: "${f.parsed.possibleArtist}" - "${f.parsed.possibleTitle}"`);
    }

    const existing = [];
    if (f.existingArtist) existing.push(`Artist: ${f.existingArtist}`);
    if (f.existingTitle) existing.push(`Title: ${f.existingTitle}`);
    if (f.existingGenre) existing.push(`Genre: ${f.existingGenre}`);
    if (f.existingAlbum) existing.push(`Album: ${f.existingAlbum}`);

    if (existing.length > 0) {
      parts.push(`    Existing: ${existing.join(', ')}`);
    }

    return parts.join('\n');
  }).join('\n\n');

  const prompt = `Analyze these ${files.length} music files and infer missing metadata for each.

FILES:
${fileList}

INSTRUCTIONS:
1. Look for PATTERNS across files:
   - Same artist prefix (e.g., "AGES - *" = all by artist "AGES")
   - Same directory/album groupings
   - Similar naming conventions
2. TRUST FILENAMES. "X - Y" patterns are artist and title (determine which is which from context).
3. The pattern could be "Artist - Title" OR "Title - Artist" - use context clues.
4. For genre: Infer from artist name, title keywords, or patterns in the collection.
5. Use standard genres: Rock, Pop, Hip-Hop, R&B, Electronic, Jazz, Classical, Country, Metal, Indie, Folk, Blues, Soul, Funk, Reggae, Latin, Soundtrack, Ambient, etc.
6. If existing metadata is provided, use it as context but you can still infer missing fields.

Respond with a JSON array only, no other text:
[
  {
    "index": 0,
    "artist": "artist name or null",
    "title": "song title or null",
    "genre": "genre or null",
    "album": "album name or null",
    "confidence": "high/medium/low",
    "source": "brief explanation"
  },
  ...
]`;

  try {
    const stdout = await runClaude(prompt, 120000);
    const jsonMatch = stdout.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as BatchInferredMetadata[];

    for (const item of parsed) {
      results.set(item.index, {
        artist: item.artist,
        title: item.title,
        genre: item.genre,
        album: item.album,
        confidence: item.confidence,
        source: item.source,
      });
    }
  } catch {
    for (const file of files) {
      results.set(file.index, {
        artist: file.parsed.possibleArtist,
        title: file.parsed.possibleTitle,
        genre: null,
        album: null,
        confidence: 'low',
        source: 'Fallback to filename parsing (batch AI unavailable)',
      });
    }
  }

  return results;
}

export async function inferMetadata(
  parsed: ParsedFilename,
  _searchResults: SearchResult[],
  missingFields: string[]
): Promise<InferredMetadata> {
  const prompt = `Infer missing metadata for: ${parsed.possibleArtist ?? '?'} - ${parsed.possibleTitle ?? '?'}
Missing: ${missingFields.join(', ')}
JSON only: {"artist":"...","title":"...","genre":"...","album":null,"confidence":"high/medium/low","source":"..."}`;

  try {
    const stdout = await runClaude(prompt, 60000);
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    return JSON.parse(jsonMatch[0]) as InferredMetadata;
  } catch {
    return {
      artist: parsed.possibleArtist,
      title: parsed.possibleTitle,
      genre: null,
      album: null,
      confidence: 'low',
      source: 'Fallback to filename parsing (AI unavailable)',
    };
  }
}
