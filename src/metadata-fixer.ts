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
import { inferMetadataBatch, type BatchFileInfo } from './inference.js';
import { promptForMetadata } from './prompts.js';
import { writeMetadata } from './writer.js';
import { loadCache, saveCache, setCacheEntry } from './cache.js';

export interface FixResult {
  state: MetadataFixState;
  updatedFiles: Map<string, AudioFileMetadata>;
}

const BATCH_SIZE = 20;

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

  const filesToProcess = filesWithMissing.slice(startIndex);

  console.log(chalk.cyan(`\nBatch analyzing ${filesToProcess.length} files with AI...`));

  const batchFiles: BatchFileInfo[] = filesToProcess.map((file, idx) => ({
    index: startIndex + idx,
    filename: file.filename,
    parsed: parseFilename(file.path),
    existingArtist: file.artist,
    existingTitle: file.title,
    existingGenre: file.genre,
    existingAlbum: file.album,
  }));

  const batches: BatchFileInfo[][] = [];

  for (let i = 0; i < batchFiles.length; i += BATCH_SIZE) {
    batches.push(batchFiles.slice(i, i + BATCH_SIZE));
  }

  console.log(chalk.gray(`Split into ${batches.length} batches of up to ${BATCH_SIZE} files each`));

  const inferredResults = new Map<number, InferredMetadata>();
  const batchPromises: Promise<void>[] = [];
  let completedBatches = 0;

  const processBatch = async (batchIdx: number): Promise<void> => {
    const batch = batches[batchIdx];
    const batchResults = await inferMetadataBatch(batch);

    for (const [idx, result] of batchResults) {
      inferredResults.set(idx, result);
    }

    completedBatches++;
  };

  const firstBatchSpinner = ora(`Batch 1/${batches.length}: Analyzing ${batches[0].length} files...`).start();
  await processBatch(0);
  firstBatchSpinner.succeed(`Batch 1/${batches.length}: Done (${batches[0].length} files)`);

  for (let batchIdx = 1; batchIdx < batches.length; batchIdx++) {
    batchPromises.push(processBatch(batchIdx));
  }

  if (batches.length > 1) {
    console.log(chalk.gray(`Remaining ${batches.length - 1} batches processing in background...`));
  }

  console.log(chalk.gray('Press Ctrl+C to quit and save progress\n'));

  for (let i = startIndex; i < filesWithMissing.length; i++) {
    const file = filesWithMissing[i];
    const missingFields = getMissingFields(file);

    console.log(
      chalk.yellow(`\nFile ${i + 1} of ${filesWithMissing.length}`)
    );

    if (completedBatches < batches.length) {
      console.log(chalk.gray(`AI batches: ${completedBatches}/${batches.length} complete`));
    }

    console.log(chalk.gray(`Missing: ${missingFields.join(', ')}`));

    let inferred = inferredResults.get(i);

    if (!inferred) {
      const spinner = ora('Waiting for AI batch to complete...').start();

      while (!inferredResults.has(i)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      spinner.stop();
      inferred = inferredResults.get(i);
    }

    inferred = inferred ?? {
      artist: null,
      title: null,
      genre: null,
      album: null,
      confidence: 'low' as const,
      source: 'No inference available',
    };

    const existingMetadata: Partial<MusicMetadata> = {
      artist: file.artist ?? undefined,
      title: file.title ?? undefined,
      genre: file.genre ?? undefined,
      album: file.album ?? undefined,
    };

    const result = await promptForMetadata(
      file.filename,
      inferred,
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

  await Promise.all(batchPromises);
  await saveCache(cache);

  console.log(chalk.cyan('\n' + '─'.repeat(60)));
  console.log(chalk.green(`Fixed: ${state.fixedCount} files`));
  console.log(chalk.yellow(`Skipped: ${state.skippedCount} files`));
  console.log(
    chalk.gray(`Remaining: ${filesWithMissing.length - state.lastProcessedIndex} files`)
  );

  return { state, updatedFiles };
}
