import { execSync } from 'node:child_process';
import type { InferredMetadata } from './types.js';
import type { SearchResult } from './search.js';
import type { ParsedFilename } from './parser.js';

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
