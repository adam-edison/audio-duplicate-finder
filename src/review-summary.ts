import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Decision, AudioFileMetadata, ExtendedDecision } from './types.js';
import { formatFileSize } from './metadata.js';

export interface DeletionSummary {
  totalFiles: number;
  totalSize: number;
  autoDecidedCount: number;
  manualDecidedCount: number;
  filesToDelete: string[];
}

export function calculateDeletionSummary(
  decisions: Decision[],
  files: Map<string, AudioFileMetadata>
): DeletionSummary {
  const filesToDelete: string[] = [];
  let totalSize = 0;
  let autoDecidedCount = 0;
  let manualDecidedCount = 0;

  for (const decision of decisions) {
    for (const path of decision.delete) {
      filesToDelete.push(path);

      const metadata = files.get(path);

      if (metadata) {
        totalSize += metadata.size;
      }

      const extDecision = decision as ExtendedDecision;

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
  filesToDelete: string[]
): Promise<void> {
  const view = await confirm({
    message: `View all ${filesToDelete.length} files marked for deletion?`,
    default: false,
  });

  if (!view) {
    return;
  }

  console.log(chalk.yellow('\nFiles to be deleted:\n'));

  for (let i = 0; i < filesToDelete.length; i++) {
    console.log(chalk.gray(`  ${i + 1}. ${filesToDelete[i]}`));
  }

  console.log('');
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
