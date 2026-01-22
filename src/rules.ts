import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { select, confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import type { DuplicateRules, AudioFileMetadata, ScoringWeights } from './types.js';

const CONFIG_FILE = join(process.cwd(), 'config.json');

const DEFAULT_RULES: DuplicateRules = {
  confidenceThreshold: 70,
  scoreDifferenceThreshold: 10,
  weights: {
    lossless: 40,
    bitrate: 25,
    pathPriority: 20,
    metadataQuality: 15,
  },
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

  const selected: string[] = [];
  const remaining = [...directories];

  while (remaining.length > 0) {
    const choices = [
      { name: chalk.green('✓ Done selecting'), value: '__done__' },
      ...remaining.map((dir) => ({ name: dir, value: dir })),
    ];

    const priority = selected.length + 1;
    const choice = await select({
      message: `Select priority #${priority} directory:`,
      choices,
      pageSize: 15,
    });

    if (choice === '__done__') {
      break;
    }

    selected.push(choice);
    remaining.splice(remaining.indexOf(choice), 1);
  }

  return selected;
}

async function promptForWeights(): Promise<ScoringWeights> {
  console.log(chalk.cyan('\n📊 Configure Scoring Weights'));
  console.log(chalk.gray('Weights must add up to 100%. Higher weight = more important factor.\n'));

  while (true) {
    const losslessInput = await input({
      message: 'Lossless format weight (FLAC/WAV over MP3):',
      default: '40',
      validate: (value) => {
        const num = parseInt(value, 10);

        if (isNaN(num) || num < 0 || num > 100) {
          return 'Please enter a number between 0 and 100';
        }

        return true;
      },
    });

    const bitrateInput = await input({
      message: 'Higher bitrate weight:',
      default: '25',
      validate: (value) => {
        const num = parseInt(value, 10);

        if (isNaN(num) || num < 0 || num > 100) {
          return 'Please enter a number between 0 and 100';
        }

        return true;
      },
    });

    const pathPriorityInput = await input({
      message: 'Path priority weight (preferred directories):',
      default: '20',
      validate: (value) => {
        const num = parseInt(value, 10);

        if (isNaN(num) || num < 0 || num > 100) {
          return 'Please enter a number between 0 and 100';
        }

        return true;
      },
    });

    const metadataQualityInput = await input({
      message: 'Metadata quality weight (complete tags):',
      default: '15',
      validate: (value) => {
        const num = parseInt(value, 10);

        if (isNaN(num) || num < 0 || num > 100) {
          return 'Please enter a number between 0 and 100';
        }

        return true;
      },
    });

    const lossless = parseInt(losslessInput, 10);
    const bitrate = parseInt(bitrateInput, 10);
    const pathPriority = parseInt(pathPriorityInput, 10);
    const metadataQuality = parseInt(metadataQualityInput, 10);

    const total = lossless + bitrate + pathPriority + metadataQuality;

    if (total !== 100) {
      console.log(chalk.red(`\n⚠️  Weights add up to ${total}%, must equal 100%. Please try again.\n`));
      continue;
    }

    return { lossless, bitrate, pathPriority, metadataQuality };
  }
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

  const scoreDiffInput = await input({
    message: 'Minimum score difference for auto-decisions (0-100):',
    default: '10',
    validate: (value) => {
      const num = parseInt(value, 10);

      if (isNaN(num) || num < 0 || num > 100) {
        return 'Please enter a number between 0 and 100';
      }

      return true;
    },
  });

  const scoreDifferenceThreshold = parseInt(scoreDiffInput, 10);

  const weights = await promptForWeights();

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
    scoreDifferenceThreshold,
    weights,
    pathPriority,
  };

  displayRulesSummary(rules);

  return rules;
}

function displayRulesSummary(rules: DuplicateRules): void {
  console.log(chalk.cyan('\n📋 Rules Summary:'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Confidence threshold: ${rules.confidenceThreshold}%`);
  console.log(`  Score difference threshold: ${rules.scoreDifferenceThreshold}%`);
  console.log(chalk.gray('  Scoring weights:'));
  console.log(`    Lossless format: ${rules.weights.lossless}%`);
  console.log(`    Higher bitrate: ${rules.weights.bitrate}%`);
  console.log(`    Path priority: ${rules.weights.pathPriority}%`);
  console.log(`    Metadata quality: ${rules.weights.metadataQuality}%`);
  console.log(`  Path priorities: ${rules.pathPriority.length} directories configured`);
}

export async function promptRulesAction(
  existingRules: DuplicateRules
): Promise<'use' | 'reconfigure'> {
  console.log(chalk.cyan('\n📋 Existing Rules Found:'));
  displayRulesSummary(existingRules);

  const answer = await select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Use existing rules', value: 'use' },
      { name: 'Reconfigure rules', value: 'reconfigure' },
    ],
  });

  return answer as 'use' | 'reconfigure';
}
