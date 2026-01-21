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
  recentValues: string[],
  commonValues: string[] = []
): Promise<string> {
  const choices: Array<{ name: string; value: string }> = [];

  if (suggestedValue) {
    choices.push({
      name: `✨ AI suggestion: ${suggestedValue}`,
      value: suggestedValue,
    });
  }

  const seen = new Set<string>(suggestedValue ? [suggestedValue.toLowerCase()] : []);

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
      default: suggestedValue ?? undefined,
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

  const aiPreview: string[] = [];

  if (missingFields.includes('artist') && inferred.artist) {
    aiPreview.push(`   Artist: ${inferred.artist}`);
  }

  if (missingFields.includes('title') && inferred.title) {
    aiPreview.push(`   Title:  ${inferred.title}`);
  }

  if (missingFields.includes('genre') && inferred.genre) {
    aiPreview.push(`   Genre:  ${inferred.genre}`);
  }

  if (missingFields.includes('album') && inferred.album) {
    aiPreview.push(`   Album:  ${inferred.album}`);
  }

  const hasAiSuggestions = aiPreview.length > 0;

  if (hasAiSuggestions) {
    console.log('✨ AI suggestions:');
    console.log(aiPreview.join('\n'));
    console.log('');
  }

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
      artist: missingFields.includes('artist') ? (inferred.artist ?? existingMetadata.artist ?? '') : (existingMetadata.artist ?? ''),
      title: missingFields.includes('title') ? (inferred.title ?? existingMetadata.title ?? '') : (existingMetadata.title ?? ''),
      genre: missingFields.includes('genre') ? (inferred.genre ?? existingMetadata.genre ?? '') : (existingMetadata.genre ?? ''),
      album: missingFields.includes('album') ? (inferred.album ?? existingMetadata.album ?? '') : (existingMetadata.album ?? ''),
    };

    return { metadata, action: 'save' };
  }

  const metadata: MusicMetadata = {
    artist: existingMetadata.artist ?? '',
    title: existingMetadata.title ?? '',
    genre: existingMetadata.genre ?? '',
    album: existingMetadata.album ?? '',
  };

  if (missingFields.includes('artist')) {
    metadata.artist = await promptForField(
      'artist',
      inferred.artist,
      getRecentArtists(cache)
    );
  }

  if (missingFields.includes('title')) {
    metadata.title = await promptForField(
      'title',
      inferred.title,
      []
    );
  }

  if (missingFields.includes('genre')) {
    metadata.genre = await promptForField(
      'genre',
      inferred.genre,
      getRecentGenres(cache),
      COMMON_GENRES
    );
  }

  if (missingFields.includes('album')) {
    metadata.album = await promptForField(
      'album',
      inferred.album,
      []
    );
  }

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
