import chalk from 'chalk';
import ora from 'ora';
import type {
  AudioFileMetadata,
  MetadataFixState,
  MusicMetadata,
  Cache,
  InferredMetadata,
} from './types.js';
import { parseFilename } from './parser.js';
import { inferMetadata } from './inference.js';
import { promptForMetadata } from './prompts.js';
import { writeMetadata } from './writer.js';
import { loadCache, saveCache, setCacheEntry } from './cache.js';

export interface FixResult {
  state: MetadataFixState;
  updatedFiles: Map<string, AudioFileMetadata>;
}

interface FetchedResult {
  inferred: InferredMetadata;
  missingFields: Array<'artist' | 'genre' | 'title' | 'album'>;
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

async function fetchFile(
  file: AudioFileMetadata
): Promise<FetchedResult> {
  const missingFields = getMissingFields(file);
  const parsed = parseFilename(file.path);
  const inferred = await inferMetadata(parsed, [], missingFields);

  return { inferred, missingFields };
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

  console.log(chalk.gray('Press Ctrl+C to quit and save progress\n'));

  const fetchedResults: Map<number, FetchedResult> = new Map();
  let nextFetchPromise: Promise<void> | null = null;
  let nextFetchIndex = startIndex;

  const startNextFetch = (): void => {
    if (nextFetchIndex >= filesWithMissing.length) {
      return;
    }

    if (fetchedResults.has(nextFetchIndex)) {
      nextFetchIndex++;
      startNextFetch();
      return;
    }

    const idx = nextFetchIndex;
    nextFetchIndex++;

    nextFetchPromise = fetchFile(filesWithMissing[idx]).then((result) => {
      fetchedResults.set(idx, result);
      nextFetchPromise = null;
      startNextFetch();
    });
  };

  startNextFetch();

  for (let i = startIndex; i < filesWithMissing.length; i++) {
    const file = filesWithMissing[i];

    console.log(chalk.yellow(`\nFile ${i + 1} of ${filesWithMissing.length}`));

    let fetched = fetchedResults.get(i);

    if (!fetched) {
      const spinner = ora('Analyzing with AI...').start();

      while (!fetchedResults.has(i)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      spinner.stop();
      fetched = fetchedResults.get(i)!;
    }

    console.log(chalk.gray(`Missing: ${fetched.missingFields.join(', ')}`));

    const existingMetadata: Partial<MusicMetadata> = {
      artist: file.artist ?? undefined,
      title: file.title ?? undefined,
      genre: file.genre ?? undefined,
      album: file.album ?? undefined,
    };

    const result = await promptForMetadata(
      file.filename,
      fetched.inferred,
      fetched.missingFields,
      existingMetadata,
      cache
    );

    fetchedResults.delete(i);

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
