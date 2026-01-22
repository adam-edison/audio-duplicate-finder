import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import type { DuplicateRules, RuleName } from './types.js';

const CONFIG_FILE = join(process.cwd(), 'config.json');

const ALL_RULES: { name: RuleName; label: string; description: string }[] = [
  { name: 'lossless', label: 'Lossless format', description: 'Keep FLAC/WAV over MP3/AAC' },
  { name: 'bitrate', label: 'Higher bitrate', description: 'Keep higher quality encoding' },
  { name: 'metadata', label: 'Better metadata', description: 'Keep file with more complete tags' },
];

const DEFAULT_RULES: DuplicateRules = {
  confidenceThreshold: 70,
  ruleOrder: ['lossless', 'bitrate', 'metadata'],
  destinationDir: '',
};

export async function loadRules(): Promise<DuplicateRules | null> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    const rules = config.duplicateRules;

    if (!rules) {
      return null;
    }

    if (!rules.ruleOrder) {
      return {
        confidenceThreshold: rules.confidenceThreshold ?? DEFAULT_RULES.confidenceThreshold,
        ruleOrder: DEFAULT_RULES.ruleOrder,
        destinationDir: rules.destinationDir ?? '',
      };
    }

    return rules;
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

async function promptRuleOrder(): Promise<RuleName[]> {
  console.log(chalk.cyan('\n📋 Configure Rule Priority'));
  console.log(chalk.gray('Select rules in order of importance. First rule that can decide wins.\n'));

  const selected: RuleName[] = [];
  const remaining = [...ALL_RULES];

  while (remaining.length > 0) {
    const choices = [
      { name: chalk.green('✓ Done selecting'), value: '__done__' },
      ...remaining.map((r) => ({
        name: `${r.label} - ${chalk.gray(r.description)}`,
        value: r.name,
      })),
    ];

    const priority = selected.length + 1;
    const choice = await select({
      message: `Select rule #${priority}:`,
      choices,
    });

    if (choice === '__done__') {
      break;
    }

    selected.push(choice as RuleName);
    const idx = remaining.findIndex((r) => r.name === choice);
    remaining.splice(idx, 1);
  }

  if (selected.length === 0) {
    return DEFAULT_RULES.ruleOrder;
  }

  return selected;
}

export async function promptForRules(): Promise<DuplicateRules> {
  console.log(chalk.cyan('\n📋 Configure Duplicate Resolution Rules\n'));
  console.log(chalk.gray('Rules are applied in order. First rule that can pick a winner decides.\n'));

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

  const destinationDir = await input({
    message: 'Destination directory for consolidation:',
    default: '/Users/aedison/Music',
    validate: (value) => {
      if (!value.startsWith('/')) {
        return 'Please enter an absolute path';
      }

      return true;
    },
  });

  const ruleOrder = await promptRuleOrder();

  const rules: DuplicateRules = {
    confidenceThreshold,
    ruleOrder,
    destinationDir,
  };

  displayRulesSummary(rules);

  return rules;
}

function displayRulesSummary(rules: DuplicateRules): void {
  console.log(chalk.cyan('\n📋 Rules Summary:'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Confidence threshold: ${rules.confidenceThreshold}%`);
  console.log(`  Destination: ${rules.destinationDir}`);
  console.log(chalk.gray('  Rule priority:'));

  for (let i = 0; i < rules.ruleOrder.length; i++) {
    const rule = ALL_RULES.find((r) => r.name === rules.ruleOrder[i]);
    console.log(`    ${i + 1}. ${rule?.label ?? rules.ruleOrder[i]}`);
  }
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
