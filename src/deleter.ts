import { unlink } from 'node:fs/promises';
import { default as trash } from 'trash';
import chalk from 'chalk';
import type { Decision, DeletionLog, DeletionLogEntry } from './types.js';

export async function executeDecisions(decisions: Decision[]): Promise<DeletionLog> {
  const filesToDelete = decisions.flatMap((d) => d.delete);
  const entries: DeletionLogEntry[] = [];

  console.log(chalk.cyan(`\nExecuting deletion of ${filesToDelete.length} files\n`));

  for (let i = 0; i < filesToDelete.length; i++) {
    const path = filesToDelete[i];
    const progress = `[${i + 1}/${filesToDelete.length}]`;

    console.log(chalk.gray(`${progress} ${path}`));

    const entry = await deleteFile(path);
    entries.push(entry);

    if (entry.success) {
      console.log(chalk.green(`  ✓ Moved to trash`));
    } else {
      console.log(chalk.red(`  ✗ ${entry.error}`));
    }
  }

  const log: DeletionLog = {
    executedAt: new Date().toISOString(),
    entries,
  };

  summarizeDeletions(log);

  return log;
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
  } catch (trashError) {
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

function summarizeDeletions(log: DeletionLog): void {
  const successful = log.entries.filter((e) => e.success);
  const failed = log.entries.filter((e) => !e.success);
  const trashed = successful.filter((e) => e.method === 'trash');
  const permanent = successful.filter((e) => e.method === 'permanent');

  console.log(chalk.cyan('\nDeletion Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Total processed: ${log.entries.length}`);
  console.log(chalk.green(`Moved to trash: ${trashed.length}`));

  if (permanent.length > 0) {
    console.log(chalk.yellow(`Permanently deleted: ${permanent.length}`));
  }

  if (failed.length > 0) {
    console.log(chalk.red(`Failed: ${failed.length}`));

    for (const entry of failed) {
      console.log(chalk.red(`  - ${entry.path}: ${entry.error}`));
    }
  }
}
