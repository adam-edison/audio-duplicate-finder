import { input, select, confirm } from '@inquirer/prompts';
import type { InferredMetadata, MusicMetadata, Cache } from './types.js';
import { getRecentArtists, getRecentGenres } from './cache.js';

const COMMON_GENRES = [
  'Rock', 'Pop', 'Hip-Hop', 'R&B', 'Electronic', 'Jazz', 'Classical',
  'Country', 'Metal', 'Indie', 'Folk', 'Blues', 'Soul', 'Funk',
  'Reggae', 'Latin', 'Soundtrack', 'Ambient', 'Punk', 'Alternative',
];

export interface PromptResult {
  metadata: MusicMetadata;
  action: 'save' | 'skip' | 'quit';
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.slice(0, maxLen - 3) + '...';
}

async function promptForField(
  field: string,
  suggestedValue: string | null,
  existingValue: string | null,
  recentValues: string[],
  commonValues: string[] = []
): Promise<string> {
  const choices: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();

  if (existingValue) {
    choices.push({
      name: `📎 Keep current: ${existingValue}`,
      value: existingValue,
    });
    seen.add(existingValue.toLowerCase());
  }

  if (suggestedValue && !seen.has(suggestedValue.toLowerCase())) {
    choices.push({
      name: `✨ AI suggestion: ${suggestedValue}`,
      value: suggestedValue,
    });
    seen.add(suggestedValue.toLowerCase());
  }

  for (const recent of recentValues.slice(0, 5)) {
    if (seen.has(recent.toLowerCase())) {
      continue;
    }

    seen.add(recent.toLowerCase());
    choices.push({
      name: `📌 Recent: ${recent}`,
      value: recent,
    });
  }

  for (const common of commonValues) {
    if (seen.has(common.toLowerCase())) {
      continue;
    }

    seen.add(common.toLowerCase());
    choices.push({
      name: common,
      value: common,
    });
  }

  choices.push({
    name: '✏️  Enter custom value...',
    value: '__custom__',
  });

  const selected = await select({
    message: `Select ${field}:`,
    choices,
    pageSize: 15,
  });

  if (selected === '__custom__') {
    return input({
      message: `Enter ${field}:`,
      default: existingValue ?? suggestedValue ?? undefined,
    });
  }

  return selected;
}

export async function promptForMetadata(
  filename: string,
  inferred: InferredMetadata,
  missingFields: Array<'artist' | 'genre' | 'title' | 'album'>,
  existingMetadata: Partial<MusicMetadata>,
  cache: Cache
): Promise<PromptResult> {
  console.log('\n' + '─'.repeat(60));
  console.log(`📁 ${truncate(filename, 58)}`);
  console.log('─'.repeat(60));

  if (inferred.source) {
    console.log(`💡 ${inferred.source} (${inferred.confidence} confidence)`);
  }

  const resolvedArtist = missingFields.includes('artist') ? inferred.artist : existingMetadata.artist;
  const resolvedTitle = missingFields.includes('title') ? inferred.title : existingMetadata.title;
  const resolvedGenre = missingFields.includes('genre') ? inferred.genre : existingMetadata.genre;
  const resolvedAlbum = missingFields.includes('album') ? inferred.album : existingMetadata.album;

  const hasAiSuggestions = missingFields.some((f) => {
    if (f === 'artist') return inferred.artist;
    if (f === 'title') return inferred.title;
    if (f === 'genre') return inferred.genre;
    if (f === 'album') return inferred.album;
    return false;
  });

  console.log('\n📋 Current + AI suggestions:');
  console.log(`   Artist: ${resolvedArtist || '(empty)'}${missingFields.includes('artist') && inferred.artist ? ' ✨' : ''}`);
  console.log(`   Title:  ${resolvedTitle || '(empty)'}${missingFields.includes('title') && inferred.title ? ' ✨' : ''}`);
  console.log(`   Genre:  ${resolvedGenre || '(empty)'}${missingFields.includes('genre') && inferred.genre ? ' ✨' : ''}`);
  console.log(`   Album:  ${resolvedAlbum || '(empty)'}${missingFields.includes('album') && inferred.album ? ' ✨' : ''}`);
  console.log('');

  const choices = [];

  if (hasAiSuggestions) {
    choices.push({ name: '✨ Accept AI suggestions', value: 'accept-ai' });
  }

  choices.push(
    { name: '✏️  Edit and save metadata', value: 'edit' },
    { name: '⏭️  Skip this file', value: 'skip' },
    { name: '🚪 Quit', value: 'quit' }
  );

  const actionChoice = await select({
    message: 'What would you like to do?',
    choices,
  });

  if (actionChoice === 'skip') {
    return { metadata: { artist: '', title: '', genre: '', album: '' }, action: 'skip' };
  }

  if (actionChoice === 'quit') {
    return { metadata: { artist: '', title: '', genre: '', album: '' }, action: 'quit' };
  }

  if (actionChoice === 'accept-ai') {
    const metadata: MusicMetadata = {
      artist: resolvedArtist ?? '',
      title: resolvedTitle ?? '',
      genre: resolvedGenre ?? '',
      album: resolvedAlbum ?? '',
    };

    return { metadata, action: 'save' };
  }

  const metadata: MusicMetadata = {
    artist: '',
    title: '',
    genre: '',
    album: '',
  };

  metadata.artist = await promptForField(
    'artist',
    inferred.artist,
    existingMetadata.artist ?? null,
    getRecentArtists(cache)
  );

  metadata.title = await promptForField(
    'title',
    inferred.title,
    existingMetadata.title ?? null,
    []
  );

  metadata.genre = await promptForField(
    'genre',
    inferred.genre,
    existingMetadata.genre ?? null,
    getRecentGenres(cache),
    COMMON_GENRES
  );

  metadata.album = await promptForField(
    'album',
    inferred.album,
    existingMetadata.album ?? null,
    []
  );

  console.log('\n📋 Summary:');
  console.log(`   Artist: ${metadata.artist || '(empty)'}`);
  console.log(`   Title:  ${metadata.title || '(empty)'}`);
  console.log(`   Genre:  ${metadata.genre || '(empty)'}`);
  console.log(`   Album:  ${metadata.album || '(empty)'}`);

  const confirmed = await confirm({
    message: 'Save this metadata?',
    default: true,
  });

  if (!confirmed) {
    return { metadata, action: 'skip' };
  }

  return { metadata, action: 'save' };
}
