import { execSync } from 'node:child_process';
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
    const output = execSync(`claude -p ${JSON.stringify(prompt)}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });

    const jsonMatch = output.match(/\[[\s\S]*\]/);

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
  } catch (error) {
    console.error('Batch AI inference failed, falling back to filename parsing:', error);

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
  searchResults: SearchResult[],
  missingFields: string[]
): Promise<InferredMetadata> {
  const searchContext = searchResults.length > 0
    ? `YouTube search results for "${parsed.searchQuery}":\n${searchResults.map((r, i) => `${i + 1}. ${r.title}`).join('\n')}`
    : 'No search results available.';

  const prompt = `Analyze this music file and infer the missing metadata.

Filename analysis:
- Part before separator: ${parsed.possibleArtist ?? 'unknown'}
- Part after separator: ${parsed.possibleTitle ?? 'unknown'}

${searchContext}

Missing fields that need values: ${missingFields.join(', ')}

IMPORTANT RULES:
1. TRUST THE FILENAME. If the filename shows "X - Y" pattern, those ARE the artist and title. Do not second-guess.
2. The pattern could be "Artist - Title" OR "Title - Artist". Use context clues to determine which:
   - If one part looks like a name/band name, that's likely the artist
   - If one part looks like a song phrase, that's likely the title
   - YouTube results can help confirm which is which
3. For genre: Use YouTube results, artist style, or title keywords to infer. Use standard genres: Rock, Pop, Hip-Hop, R&B, Electronic, Jazz, Classical, Country, Metal, Indie, Folk, Blues, Soul, Funk, Reggae, Latin, Soundtrack, Ambient, etc.
4. If artist/title are clearly in the filename, confidence should be "high" even if YouTube results are unrelated.
5. YouTube results showing tutorials or unrelated content does NOT invalidate a clear filename pattern.

Respond in this exact JSON format only, no other text:
{
  "artist": "artist name or null if cannot determine",
  "title": "song title or null if cannot determine",
  "genre": "genre or null if cannot determine",
  "album": "album name or null if cannot determine",
  "confidence": "high/medium/low",
  "source": "brief explanation of how you determined this"
}`;

  try {
    const output = execSync(`claude -p ${JSON.stringify(prompt)}`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    const jsonMatch = output.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    return JSON.parse(jsonMatch[0]) as InferredMetadata;
  } catch (error) {
    console.error('AI inference failed:', error);

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
