import { unlink, copyFile, mkdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { default as trash } from 'trash';
import chalk from 'chalk';
import type {
  ExtendedDecision,
  ExecutionLog,
  CopyLogEntry,
  DeletionLogEntry,
  AudioFileMetadata,
  MetadataSelection,
  MusicMetadata,
} from './types.js';
import { writeMetadata } from './writer.js';

interface MetadataWriteLogEntry {
  path: string;
  writtenAt: string;
  success: boolean;
  error?: string;
  source: 'single-file' | 'merged';
}

function buildMergedMetadata(
  keepFile: AudioFileMetadata,
  deleteFile: AudioFileMetadata,
  selection: MetadataSelection
): MusicMetadata {
  const result: MusicMetadata = {
    artist: keepFile.artist ?? '',
    title: keepFile.title ?? '',
    genre: keepFile.genre ?? '',
    album: keepFile.album ?? '',
  };

  const deletePath = deleteFile.path;

  if (selection.artist === deletePath) {
    result.artist = deleteFile.artist ?? '';
  }

  if (selection.title === deletePath) {
    result.title = deleteFile.title ?? '';
  }

  if (selection.genre === deletePath) {
    result.genre = deleteFile.genre ?? '';
  }

  if (selection.album === deletePath) {
    result.album = deleteFile.album ?? '';
  }

  return result;
}

async function applyMetadataFromSource(
  decision: ExtendedDecision,
  files: Map<string, AudioFileMetadata>
): Promise<MetadataWriteLogEntry | null> {
  const keepPath = decision.keep[0];
  const deletePath = decision.delete[0];
  const metadataSource = decision.metadataSource;

  if (!metadataSource) {
    return null;
  }

  if (!deletePath) {
    return null;
  }

  const keepFile = files.get(keepPath);
  const deleteFile = files.get(deletePath);

  if (!keepFile || !deleteFile) {
    return null;
  }

  if (typeof metadataSource === 'string') {
    if (metadataSource === keepPath) {
      return null;
    }

    const metadata: MusicMetadata = {
      artist: deleteFile.artist ?? '',
      title: deleteFile.title ?? '',
      genre: deleteFile.genre ?? '',
      album: deleteFile.album ?? '',
    };

    try {
      await writeMetadata(keepPath, metadata);

      return {
        path: keepPath,
        writtenAt: new Date().toISOString(),
        success: true,
        source: 'single-file',
      };
    } catch (error) {
      return {
        path: keepPath,
        writtenAt: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
        source: 'single-file',
      };
    }
  }

  const hasSelectionsFromDeleteFile = Object.values(metadataSource).some(
    (source) => source === deletePath
  );

  if (!hasSelectionsFromDeleteFile) {
    return null;
  }

  const mergedMetadata = buildMergedMetadata(keepFile, deleteFile, metadataSource);

  try {
    await writeMetadata(keepPath, mergedMetadata);

    return {
      path: keepPath,
      writtenAt: new Date().toISOString(),
      success: true,
      source: 'merged',
    };
  } catch (error) {
    return {
      path: keepPath,
      writtenAt: new Date().toISOString(),
      success: false,
      error: error instanceof Error ? error.message : String(error),
      source: 'merged',
    };
  }
}

export async function executeDecisions(
  decisions: ExtendedDecision[],
  destinationDir: string,
  files?: Map<string, AudioFileMetadata>
): Promise<ExecutionLog> {
  const copies: CopyLogEntry[] = [];
  const deletions: DeletionLogEntry[] = [];
  const metadataWrites: MetadataWriteLogEntry[] = [];

  if (files) {
    const decisionsNeedingMetadata = decisions.filter(
      (d) => d.metadataSource && d.keep.length > 0 && d.delete.length > 0
    );

    if (decisionsNeedingMetadata.length > 0) {
      console.log(chalk.cyan(`\nApplying metadata to ${decisionsNeedingMetadata.length} files\n`));

      for (let i = 0; i < decisionsNeedingMetadata.length; i++) {
        const decision = decisionsNeedingMetadata[i];
        const keepPath = decision.keep[0];
        const progress = `[${i + 1}/${decisionsNeedingMetadata.length}]`;

        console.log(chalk.gray(`${progress} ${keepPath.split('/').pop()}`));

        const result = await applyMetadataFromSource(decision, files);

        if (!result) {
          console.log(chalk.gray(`  ○ No metadata changes needed`));
          continue;
        }

        metadataWrites.push(result);

        if (result.success) {
          console.log(chalk.green(`  ✓ Metadata written (${result.source})`));
        } else {
          console.log(chalk.red(`  ✗ ${result.error}`));
        }
      }
    }
  }

  const needsCopy = decisions.filter((d) => d.copyToDestination && d.keep.length > 0);
  const allDeletes = decisions.flatMap((d) => d.delete);

  if (needsCopy.length > 0) {
    console.log(chalk.cyan(`\nCopying ${needsCopy.length} files to ${destinationDir}\n`));

    for (let i = 0; i < needsCopy.length; i++) {
      const decision = needsCopy[i];
      const sourcePath = decision.keep[0];
      const progress = `[${i + 1}/${needsCopy.length}]`;

      console.log(chalk.gray(`${progress} ${sourcePath}`));

      const entry = await copyFileToDestination(sourcePath, destinationDir);
      copies.push(entry);

      if (entry.success) {
        console.log(chalk.green(`  ✓ Copied to ${entry.destination}`));
      } else {
        console.log(chalk.red(`  ✗ ${entry.error}`));
      }
    }
  }

  const failedCopies = copies.filter((c) => !c.success);

  if (failedCopies.length > 0) {
    console.log(chalk.red(`\n⚠️  ${failedCopies.length} copies failed. Skipping deletion of those source files.`));
  }

  const successfulCopySources = new Set(copies.filter((c) => c.success).map((c) => c.source));
  const filesToDelete = allDeletes.filter((path) => {
    const isSourceOfFailedCopy = needsCopy.some(
      (d) => d.keep[0] === path && !successfulCopySources.has(path)
    );
    return !isSourceOfFailedCopy;
  });

  const sourceFilesToDelete = needsCopy
    .filter((d) => successfulCopySources.has(d.keep[0]))
    .map((d) => d.keep[0]);

  const allFilesToDelete = [...filesToDelete, ...sourceFilesToDelete];

  if (allFilesToDelete.length > 0) {
    console.log(chalk.cyan(`\nDeleting ${allFilesToDelete.length} files\n`));

    for (let i = 0; i < allFilesToDelete.length; i++) {
      const path = allFilesToDelete[i];
      const progress = `[${i + 1}/${allFilesToDelete.length}]`;

      console.log(chalk.gray(`${progress} ${path}`));

      const entry = await deleteFile(path);
      deletions.push(entry);

      if (entry.success) {
        console.log(chalk.green(`  ✓ Moved to trash`));
      } else {
        console.log(chalk.red(`  ✗ ${entry.error}`));
      }
    }
  }

  const log: ExecutionLog = {
    executedAt: new Date().toISOString(),
    copies,
    deletions,
  };

  summarizeExecution(log);

  return log;
}

async function copyFileToDestination(
  sourcePath: string,
  destinationDir: string
): Promise<CopyLogEntry> {
  const filename = basename(sourcePath);
  const destPath = join(destinationDir, filename);

  try {
    await mkdir(destinationDir, { recursive: true });
    await copyFile(sourcePath, destPath);

    return {
      source: sourcePath,
      destination: destPath,
      copiedAt: new Date().toISOString(),
      success: true,
    };
  } catch (error) {
    return {
      source: sourcePath,
      destination: destPath,
      copiedAt: new Date().toISOString(),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deleteFile(path: string): Promise<DeletionLogEntry> {
  try {
    await trash(path);

    return {
      path,
      deletedAt: new Date().toISOString(),
      method: 'trash',
      success: true,
    };
  } catch {
    console.log(chalk.yellow(`  Warning: Could not move to trash, attempting permanent delete`));

    try {
      await unlink(path);

      return {
        path,
        deletedAt: new Date().toISOString(),
        method: 'permanent',
        success: true,
      };
    } catch (unlinkError) {
      return {
        path,
        deletedAt: new Date().toISOString(),
        method: 'permanent',
        success: false,
        error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError),
      };
    }
  }
}

function summarizeExecution(log: ExecutionLog): void {
  console.log(chalk.cyan('\nExecution Summary'));
  console.log(chalk.gray('─'.repeat(40)));

  if (log.copies.length > 0) {
    const successfulCopies = log.copies.filter((c) => c.success).length;
    const failedCopies = log.copies.filter((c) => !c.success).length;

    console.log(`Copies: ${successfulCopies} successful, ${failedCopies} failed`);
  }

  const successfulDeletions = log.deletions.filter((e) => e.success);
  const failedDeletions = log.deletions.filter((e) => !e.success);
  const trashed = successfulDeletions.filter((e) => e.method === 'trash');
  const permanent = successfulDeletions.filter((e) => e.method === 'permanent');

  console.log(`Deletions: ${successfulDeletions.length} successful`);

  if (trashed.length > 0) {
    console.log(chalk.green(`  Moved to trash: ${trashed.length}`));
  }

  if (permanent.length > 0) {
    console.log(chalk.yellow(`  Permanently deleted: ${permanent.length}`));
  }

  if (failedDeletions.length > 0) {
    console.log(chalk.red(`  Failed: ${failedDeletions.length}`));

    for (const entry of failedDeletions) {
      console.log(chalk.red(`    - ${entry.path}: ${entry.error}`));
    }
  }
}
