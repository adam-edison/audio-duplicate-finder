import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { select, checkbox, confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import type { DuplicateRules, AudioFileMetadata } from './types.js';

const CONFIG_FILE = join(process.cwd(), 'config.json');

const DEFAULT_RULES: DuplicateRules = {
  confidenceThreshold: 70,
  maxDurationDiffSeconds: 5,
  preferLossless: true,
  preferHigherBitrate: true,
  pathPriority: [],
};

export async function loadRules(): Promise<DuplicateRules | null> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    return config.duplicateRules ?? null;
  } catch {
    return null;
  }
}

export async function saveRules(rules: DuplicateRules): Promise<void> {
  let config: Record<string, unknown> = {};

  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    config = JSON.parse(data);
  } catch {
    // Start with empty config
  }

  config.duplicateRules = rules;
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function extractUniqueDirectories(
  files: Map<string, AudioFileMetadata>
): string[] {
  const dirs = new Set<string>();

  for (const file of files.values()) {
    const dir = dirname(file.path);
    dirs.add(dir);
  }

  const sortedDirs = Array.from(dirs).sort();
  const uniqueParents = new Map<string, string>();

  for (const dir of sortedDirs) {
    const parts = dir.split('/');

    for (let i = 1; i <= parts.length; i++) {
      const partial = parts.slice(0, i).join('/');

      if (!uniqueParents.has(partial)) {
        uniqueParents.set(partial, dir);
      }
    }
  }

  const topLevel: string[] = [];
  const seenPrefixes = new Set<string>();

  for (const dir of sortedDirs) {
    let isChild = false;

    for (const prefix of seenPrefixes) {
      if (dir.startsWith(prefix + '/')) {
        isChild = true;
        break;
      }
    }

    if (!isChild) {
      topLevel.push(dir);
      seenPrefixes.add(dir);
    }
  }

  return topLevel.slice(0, 20);
}

export async function promptPathPriority(
  directories: string[]
): Promise<string[]> {
  if (directories.length === 0) {
    return [];
  }

  console.log(chalk.cyan('\nPath Priority Configuration'));
  console.log(
    chalk.gray(
      'Select directories in order of preference. Files in higher-priority directories will be kept.'
    )
  );
  console.log(chalk.gray('First selected = highest priority\n'));

  const choices = directories.map((dir) => ({
    name: dir,
    value: dir,
  }));

  const selected = await checkbox({
    message: 'Select directories to prioritize (in order):',
    choices,
    pageSize: 15,
  });

  return selected;
}

export async function promptForRules(
  directories: string[]
): Promise<DuplicateRules> {
  console.log(chalk.cyan('\n📋 Configure Duplicate Resolution Rules\n'));
  console.log(
    chalk.gray('These rules will automatically decide which file to keep for clear-cut cases.\n')
  );

  const confidenceInput = await input({
    message: 'Minimum confidence threshold for auto-decisions (0-100):',
    default: '70',
    validate: (value) => {
      const num = parseInt(value, 10);

      if (isNaN(num) || num < 0 || num > 100) {
        return 'Please enter a number between 0 and 100';
      }

      return true;
    },
  });

  const confidenceThreshold = parseInt(confidenceInput, 10);

  const durationInput = await input({
    message: 'Maximum duration difference (seconds) for auto-decisions:',
    default: '5',
    validate: (value) => {
      const num = parseInt(value, 10);

      if (isNaN(num) || num < 0) {
        return 'Please enter a positive number';
      }

      return true;
    },
  });

  const maxDurationDiffSeconds = parseInt(durationInput, 10);

  const preferLossless = await confirm({
    message: 'Prefer lossless formats (FLAC, WAV, etc.) over lossy (MP3, AAC)?',
    default: true,
  });

  const preferHigherBitrate = await confirm({
    message: 'Prefer higher bitrate when both files are lossy?',
    default: true,
  });

  let pathPriority: string[] = [];

  if (directories.length > 0) {
    const configurePathPriority = await confirm({
      message: 'Configure directory priority for file selection?',
      default: false,
    });

    if (configurePathPriority) {
      pathPriority = await promptPathPriority(directories);
    }
  }

  const rules: DuplicateRules = {
    confidenceThreshold,
    maxDurationDiffSeconds,
    preferLossless,
    preferHigherBitrate,
    pathPriority,
  };

  console.log(chalk.cyan('\n📋 Rules Summary:'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Confidence threshold: ${rules.confidenceThreshold}%`);
  console.log(`  Max duration difference: ${rules.maxDurationDiffSeconds}s`);
  console.log(`  Prefer lossless: ${rules.preferLossless ? 'Yes' : 'No'}`);
  console.log(`  Prefer higher bitrate: ${rules.preferHigherBitrate ? 'Yes' : 'No'}`);
  console.log(`  Path priorities: ${rules.pathPriority.length} directories configured`);

  return rules;
}

export async function promptRulesAction(
  existingRules: DuplicateRules
): Promise<'use' | 'reconfigure'> {
  console.log(chalk.cyan('\n📋 Existing Rules Found:'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Confidence threshold: ${existingRules.confidenceThreshold}%`);
  console.log(`  Max duration difference: ${existingRules.maxDurationDiffSeconds}s`);
  console.log(`  Prefer lossless: ${existingRules.preferLossless ? 'Yes' : 'No'}`);
  console.log(`  Prefer higher bitrate: ${existingRules.preferHigherBitrate ? 'Yes' : 'No'}`);
  console.log(
    `  Path priorities: ${existingRules.pathPriority.length} directories configured`
  );

  const answer = await select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Use existing rules', value: 'use' },
      { name: 'Reconfigure rules', value: 'reconfigure' },
    ],
  });

  return answer as 'use' | 'reconfigure';
}
