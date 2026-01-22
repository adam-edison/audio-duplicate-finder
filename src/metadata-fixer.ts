import chalk from 'chalk';
import ora from 'ora';
import type {
  AudioFileMetadata,
  MetadataFixState,
  MusicMetadata,
  Cache,
  InferredMetadata,
} from './types.js';
import { parseFilename, type ParsedFilename } from './parser.js';
import { inferMetadata } from './inference.js';
import { promptForMetadata } from './prompts.js';
import { writeMetadata } from './writer.js';
import { loadCache, saveCache, setCacheEntry } from './cache.js';

export interface FixResult {
  state: MetadataFixState;
  updatedFiles: Map<string, AudioFileMetadata>;
}

interface PrefetchedData {
  file: AudioFileMetadata;
  missingFields: Array<'artist' | 'genre' | 'title' | 'album'>;
  parsed: ParsedFilename;
  inferred: InferredMetadata;
}

const PREFETCH_COUNT = 3;

async function fetchMetadataForFile(
  file: AudioFileMetadata,
  missingFields: Array<'artist' | 'genre' | 'title' | 'album'>
): Promise<PrefetchedData> {
  const parsed = parseFilename(file.path);
  const inferred = await inferMetadata(parsed, [], missingFields);

  return { file, missingFields, parsed, inferred };
}

export function findFilesWithMissingMetadata(
  files: Map<string, AudioFileMetadata>
): AudioFileMetadata[] {
  const missing: AudioFileMetadata[] = [];

  for (const file of files.values()) {
    const hasArtist = file.artist && file.artist.trim() !== '';
    const hasTitle = file.title && file.title.trim() !== '';

    if (!hasArtist || !hasTitle) {
      missing.push(file);
    }
  }

  return missing;
}

function getMissingFields(
  file: AudioFileMetadata
): Array<'artist' | 'genre' | 'title' | 'album'> {
  const missing: Array<'artist' | 'genre' | 'title' | 'album'> = [];

  if (!file.artist || file.artist.trim() === '') {
    missing.push('artist');
  }

  if (!file.title || file.title.trim() === '') {
    missing.push('title');
  }

  if (!file.genre || file.genre.trim() === '') {
    missing.push('genre');
  }

  if (!file.album || file.album.trim() === '') {
    missing.push('album');
  }

  return missing;
}

export async function fixMetadataInteractive(
  filesWithMissing: AudioFileMetadata[],
  allFiles: Map<string, AudioFileMetadata>,
  existingState: MetadataFixState | null
): Promise<FixResult> {
  const cache = await loadCache();

  const startIndex = existingState?.lastProcessedIndex ?? 0;

  const state: MetadataFixState = existingState
    ? { ...existingState, resumedAt: new Date().toISOString() }
    : {
        lastProcessedIndex: 0,
        fixedCount: 0,
        skippedCount: 0,
        startedAt: new Date().toISOString(),
      };

  const updatedFiles = new Map<string, AudioFileMetadata>();

  console.log(chalk.cyan(`\nFound ${filesWithMissing.length} files with missing metadata`));

  if (startIndex > 0) {
    console.log(chalk.yellow(`Resuming from file ${startIndex + 1}`));
  }

  console.log(chalk.gray('Press Ctrl+C to quit and save progress'));
  console.log(chalk.gray(`Prefetching ${PREFETCH_COUNT} files ahead\n`));

  const prefetchCache = new Map<number, Promise<PrefetchedData>>();

  const startPrefetch = (index: number): void => {
    if (index >= filesWithMissing.length) {
      return;
    }

    if (prefetchCache.has(index)) {
      return;
    }

    const file = filesWithMissing[index];
    const missingFields = getMissingFields(file);
    prefetchCache.set(index, fetchMetadataForFile(file, missingFields));
  };

  for (let i = startIndex; i < Math.min(startIndex + PREFETCH_COUNT, filesWithMissing.length); i++) {
    startPrefetch(i);
  }

  for (let i = startIndex; i < filesWithMissing.length; i++) {
    const file = filesWithMissing[i];
    const missingFields = getMissingFields(file);

    console.log(
      chalk.yellow(`\nFile ${i + 1} of ${filesWithMissing.length}`)
    );
    console.log(chalk.gray(`Missing: ${missingFields.join(', ')}`));

    let prefetched: PrefetchedData;
    const prefetchPromise = prefetchCache.get(i);

    if (prefetchPromise) {
      const spinner = ora('Loading...').start();
      prefetched = await prefetchPromise;
      spinner.stop();
      prefetchCache.delete(i);
    } else {
      const spinner = ora('Analyzing with AI...').start();
      prefetched = await fetchMetadataForFile(file, missingFields);
      spinner.stop();
    }

    for (let j = i + 1; j <= i + PREFETCH_COUNT; j++) {
      startPrefetch(j);
    }

    const existingMetadata: Partial<MusicMetadata> = {
      artist: file.artist ?? undefined,
      title: file.title ?? undefined,
      genre: file.genre ?? undefined,
      album: file.album ?? undefined,
    };

    const result = await promptForMetadata(
      file.filename,
      prefetched.inferred,
      missingFields,
      existingMetadata,
      cache
    );

    if (result.action === 'quit') {
      state.lastProcessedIndex = i;
      await saveCache(cache);
      console.log(chalk.yellow('\nProgress saved. Run again to resume.'));
      break;
    }

    if (result.action === 'skip') {
      state.skippedCount++;
      state.lastProcessedIndex = i + 1;
      continue;
    }

    const spinner2 = ora('Writing metadata to file...').start();

    try {
      await writeMetadata(file.path, result.metadata);

      const updatedFile: AudioFileMetadata = {
        ...file,
        artist: result.metadata.artist || file.artist,
        title: result.metadata.title || file.title,
        genre: result.metadata.genre || file.genre,
        album: result.metadata.album || file.album,
      };

      updatedFiles.set(file.path, updatedFile);

      setCacheEntry(cache, file.filename, {
        artist: result.metadata.artist,
        title: result.metadata.title,
        genre: result.metadata.genre,
        album: result.metadata.album,
      });

      state.fixedCount++;
      spinner2.succeed('Metadata written successfully');
    } catch (error) {
      spinner2.fail(`Failed to write metadata: ${error}`);
    }

    state.lastProcessedIndex = i + 1;

    if ((i + 1) % 5 === 0) {
      await saveCache(cache);
    }
  }

  await saveCache(cache);

  console.log(chalk.cyan('\n' + '─'.repeat(60)));
  console.log(chalk.green(`Fixed: ${state.fixedCount} files`));
  console.log(chalk.yellow(`Skipped: ${state.skippedCount} files`));
  console.log(
    chalk.gray(`Remaining: ${filesWithMissing.length - state.lastProcessedIndex} files`)
  );

  return { state, updatedFiles };
}
