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
- Search query: "${parsed.searchQuery}"
- Possible artist from filename: ${parsed.possibleArtist ?? 'unknown'}
- Possible title from filename: ${parsed.possibleTitle ?? 'unknown'}

${searchContext}

Missing fields that need values: ${missingFields.join(', ')}

Based on the filename and search results, provide your best inference for the missing metadata.
For genre, use standard genres like: Rock, Pop, Hip-Hop, R&B, Electronic, Jazz, Classical, Country, Metal, Indie, Folk, Blues, Soul, Funk, Reggae, Latin, World, Soundtrack, Ambient, etc.

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
