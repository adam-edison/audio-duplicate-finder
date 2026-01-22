import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Decision, AudioFileMetadata, ExtendedDecision } from './types.js';
import { formatFileSize } from './metadata.js';

export interface DeletionEntry {
  deletePath: string;
  keepPath: string | null;
  ruleApplied: string | null;
}

export interface DeletionSummary {
  totalFiles: number;
  totalSize: number;
  autoDecidedCount: number;
  manualDecidedCount: number;
  filesToDelete: string[];
  deletionEntries: DeletionEntry[];
}

export function calculateDeletionSummary(
  decisions: Decision[],
  files: Map<string, AudioFileMetadata>
): DeletionSummary {
  const filesToDelete: string[] = [];
  const deletionEntries: DeletionEntry[] = [];
  let totalSize = 0;
  let autoDecidedCount = 0;
  let manualDecidedCount = 0;

  for (const decision of decisions) {
    const extDecision = decision as ExtendedDecision;
    const keepPath = decision.keep.length > 0 ? decision.keep[0] : null;

    for (const path of decision.delete) {
      filesToDelete.push(path);

      deletionEntries.push({
        deletePath: path,
        keepPath,
        ruleApplied: extDecision.ruleApplied ?? null,
      });

      const metadata = files.get(path);

      if (metadata) {
        totalSize += metadata.size;
      }

      if (extDecision.decisionType === 'auto') {
        autoDecidedCount++;
      } else {
        manualDecidedCount++;
      }
    }
  }

  return {
    totalFiles: filesToDelete.length,
    totalSize,
    autoDecidedCount,
    manualDecidedCount,
    filesToDelete,
    deletionEntries,
  };
}

export function displayPreDeletionSummary(
  summary: DeletionSummary,
  files: Map<string, AudioFileMetadata>
): void {
  console.log(chalk.cyan('\n' + '═'.repeat(60)));
  console.log(chalk.cyan('  PRE-DELETION SUMMARY'));
  console.log(chalk.cyan('═'.repeat(60)));

  console.log(`\n  Files to delete: ${chalk.yellow(summary.totalFiles.toString())}`);
  console.log(`  Space to free: ${chalk.green(formatFileSize(summary.totalSize))}`);

  if (summary.autoDecidedCount > 0 || summary.manualDecidedCount > 0) {
    console.log('\n  Decision breakdown:');

    if (summary.autoDecidedCount > 0) {
      console.log(`    - Auto-decided: ${summary.autoDecidedCount}`);
    }

    if (summary.manualDecidedCount > 0) {
      console.log(`    - Manually decided: ${summary.manualDecidedCount}`);
    }
  }

  console.log(chalk.cyan('\n' + '─'.repeat(60)));
}

export async function promptViewFullList(
  deletionEntries: DeletionEntry[]
): Promise<void> {
  const view = await confirm({
    message: `View all ${deletionEntries.length} files marked for deletion?`,
    default: false,
  });

  if (!view) {
    return;
  }

  const byReason = new Map<string, DeletionEntry[]>();

  for (const entry of deletionEntries) {
    const reason = entry.ruleApplied ?? 'unknown';
    const existing = byReason.get(reason) || [];
    existing.push(entry);
    byReason.set(reason, existing);
  }

  const sortedReasons = Array.from(byReason.keys()).sort();

  for (const reason of sortedReasons) {
    const entries = byReason.get(reason)!;
    console.log(chalk.cyan(`\n${'═'.repeat(60)}`));
    console.log(chalk.cyan(`  ${reason.toUpperCase()} (${entries.length} files)`));
    console.log(chalk.cyan('═'.repeat(60)));

    await displayEntriesPaged(entries);
  }
}

async function displayEntriesPaged(entries: DeletionEntry[]): Promise<void> {
  const pageSize = 50;
  let offset = 0;

  while (offset < entries.length) {
    const page = entries.slice(offset, offset + pageSize);

    console.log('');

    for (let i = 0; i < page.length; i++) {
      const entry = page[i];
      const num = offset + i + 1;
      console.log(chalk.red(`  ${num}. DELETE: ${entry.deletePath}`));

      if (entry.keepPath) {
        console.log(chalk.green(`     KEEP:   ${entry.keepPath}`));
      }
    }

    offset += pageSize;

    if (offset < entries.length) {
      const remaining = entries.length - offset;
      const continueViewing = await confirm({
        message: `Show next ${Math.min(pageSize, remaining)} of ${remaining} remaining?`,
        default: true,
      });

      if (!continueViewing) {
        break;
      }
    }
  }
}

export async function promptDoubleConfirmation(
  fileCount: number
): Promise<boolean> {
  console.log(chalk.red('\n⚠️  WARNING: This action cannot be undone!'));
  console.log(chalk.gray('(Files will be moved to trash if possible)\n'));

  const firstConfirm = await confirm({
    message: `Are you sure you want to delete ${fileCount} files?`,
    default: false,
  });

  if (!firstConfirm) {
    return false;
  }

  const secondConfirm = await confirm({
    message: chalk.red('FINAL CONFIRMATION: Proceed with deletion?'),
    default: false,
  });

  return secondConfirm;
}

export async function promptPostReviewAction(): Promise<'execute' | 'save' | 'cancel'> {
  const answer = await select({
    message: 'What would you like to do next?',
    choices: [
      {
        name: 'Execute deletions now',
        value: 'execute',
      },
      {
        name: 'Save decisions and exit (run "npm run execute" later)',
        value: 'save',
      },
      {
        name: 'Cancel (discard all decisions)',
        value: 'cancel',
      },
    ],
  });

  return answer as 'execute' | 'save' | 'cancel';
}
