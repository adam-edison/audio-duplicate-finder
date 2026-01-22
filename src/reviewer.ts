import { select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import type {
  AudioFileMetadata,
  DuplicateGroup,
  Decision,
  DecisionsFile,
  ExtendedDecision,
} from './types.js';
import { formatFileSize, formatDuration } from './metadata.js';

export interface ReviewOptions {
  label?: string;
}

export async function reviewDuplicates(
  groups: DuplicateGroup[],
  files: Map<string, AudioFileMetadata>,
  existingDecisions: Decision[],
  options: ReviewOptions = {}
): Promise<DecisionsFile> {
  const decisions: Decision[] = [...existingDecisions];
  const label = options.label ?? 'Pair';

  const decidedFiles = new Set<string>();

  for (const d of existingDecisions) {
    for (const f of d.keep) {
      decidedFiles.add(f);
    }

    for (const f of d.delete) {
      decidedFiles.add(f);
    }
  }

  const getPendingPairs = () =>
    groups.filter((g) => !g.files.some((f) => decidedFiles.has(f)));

  let pendingPairs = getPendingPairs();
  const totalPending = pendingPairs.length;

  console.log(chalk.cyan(`\nReviewing ${totalPending} duplicate pairs`));
  console.log(chalk.gray(`(${existingDecisions.length} already reviewed)\n`));

  let reviewed = 0;

  while (pendingPairs.length > 0) {
    const pair = pendingPairs[0];
    reviewed++;

    console.log(chalk.yellow(`\n${'─'.repeat(60)}`));
    console.log(
      chalk.yellow(`${label} ${reviewed} of ${totalPending} (${pendingPairs.length} remaining)`)
    );
    console.log(chalk.gray(`Confidence: ${pair.confidence}%`));
    console.log(chalk.gray(`Match reasons: ${pair.matchReasons.join(', ')}`));
    console.log();

    displayGroupFiles(pair, files);

    const decision = await promptForDecision(pair, files);

    if (decision === null) {
      console.log(chalk.yellow('\nSaving progress and exiting...'));
      break;
    }

    decisions.push(decision);

    for (const f of decision.keep) {
      decidedFiles.add(f);
    }

    for (const f of decision.delete) {
      decidedFiles.add(f);
    }

    console.log(chalk.green(`Decision recorded for ${pair.id}`));

    pendingPairs = getPendingPairs();
  }

  return {
    reviewedAt: new Date().toISOString(),
    decisions,
  };
}

function displayGroupFiles(group: DuplicateGroup, files: Map<string, AudioFileMetadata>): void {
  for (let i = 0; i < group.files.length; i++) {
    const path = group.files[i];
    const metadata = files.get(path);
    const isSuggested = path === group.suggestedKeep;
    const prefix = isSuggested ? chalk.green('★') : ' ';
    const number = chalk.cyan(`[${i + 1}]`);

    console.log(`${prefix} ${number} ${chalk.white(path)}`);

    if (!metadata) {
      console.log(chalk.gray('     (metadata not available)'));
      continue;
    }

    const details: string[] = [];

    if (metadata.duration !== null) {
      details.push(formatDuration(metadata.duration));
    }

    if (metadata.bitrate) {
      details.push(`${metadata.bitrate}kbps`);
    }

    if (metadata.lossless) {
      details.push(chalk.green('lossless'));
    }

    details.push(formatFileSize(metadata.size));

    console.log(chalk.gray(`     ${details.join(' | ')}`));

    const tags: string[] = [];

    if (metadata.artist) {
      tags.push(`Artist: ${metadata.artist}`);
    }

    if (metadata.title) {
      tags.push(`Title: ${metadata.title}`);
    }

    if (metadata.album) {
      tags.push(`Album: ${metadata.album}`);
    }

    if (tags.length > 0) {
      console.log(chalk.gray(`     ${tags.join(' | ')}`));
    }

    console.log();
  }
}

async function promptForDecision(
  group: DuplicateGroup,
  files: Map<string, AudioFileMetadata>
): Promise<ExtendedDecision | null> {
  const choices: Array<{ name: string; value: string }> = [];

  for (let i = 0; i < group.files.length; i++) {
    const path = group.files[i];
    const metadata = files.get(path);
    const isSuggested = path === group.suggestedKeep;
    const label = isSuggested ? `Keep [${i + 1}] (recommended)` : `Keep [${i + 1}]`;
    let description = path.split('/').slice(-2).join('/');

    if (metadata?.bitrate) {
      description += ` (${metadata.bitrate}kbps)`;
    }

    if (metadata?.lossless) {
      description += ' [lossless]';
    }

    choices.push({
      name: `${label} - ${description}`,
      value: `keep-${i}`,
    });
  }

  choices.push({
    name: chalk.yellow('Not duplicates - keep all'),
    value: 'not-duplicates',
  });

  choices.push({
    name: chalk.gray('Skip for now'),
    value: 'skip',
  });

  choices.push({
    name: chalk.red('Quit and save progress'),
    value: 'quit',
  });

  const answer = await select({
    message: 'What would you like to do?',
    choices,
  });

  if (answer === 'quit') {
    return null;
  }

  if (answer === 'skip') {
    return {
      groupId: group.id,
      keep: [],
      delete: [],
      notDuplicates: false,
      decisionType: 'manual',
      ruleApplied: 'manual',
    copyToDestination: false,
    };
  }

  if (answer === 'not-duplicates') {
    return {
      groupId: group.id,
      keep: group.files,
      delete: [],
      notDuplicates: true,
      decisionType: 'manual',
      ruleApplied: 'manual',
    copyToDestination: false,
    };
  }

  const keepIndex = parseInt(answer.replace('keep-', ''), 10);
  const keepPath = group.files[keepIndex];
  const deletePaths = group.files.filter((_, i) => i !== keepIndex);

  const confirmed = await confirm({
    message: `Delete ${deletePaths.length} file(s) and keep "${keepPath.split('/').pop()}"?`,
    default: true,
  });

  if (!confirmed) {
    return {
      groupId: group.id,
      keep: [],
      delete: [],
      notDuplicates: false,
      decisionType: 'manual',
      ruleApplied: 'manual',
    copyToDestination: false,
    };
  }

  return {
    groupId: group.id,
    keep: [keepPath],
    delete: deletePaths,
    notDuplicates: false,
    decisionType: 'manual',
    ruleApplied: 'manual',
    copyToDestination: false,
  };
}

export function summarizeDecisions(decisions: Decision[]): void {
  const toDelete = decisions.flatMap((d) => d.delete);
  const notDuplicates = decisions.filter((d) => d.notDuplicates).length;
  const skipped = decisions.filter((d) => d.keep.length === 0 && !d.notDuplicates).length;
  const decided = decisions.length - notDuplicates - skipped;

  console.log(chalk.cyan('\nDecision Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Groups reviewed: ${decisions.length}`);
  console.log(`Marked for deletion: ${toDelete.length} files`);
  console.log(`Marked as not duplicates: ${notDuplicates}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Decided: ${decided}`);
}
