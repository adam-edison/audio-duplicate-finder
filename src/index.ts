import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';
import { scanWithRipgrep } from './scanner.js';
import { extractMetadata } from './metadata.js';
import { findDuplicates } from './duplicates.js';
import { reviewDuplicates, summarizeDecisions } from './reviewer.js';
import { executeDecisions } from './deleter.js';
import type {
  Config,
  ScanState,
  AudioFileMetadata,
  DuplicatesFile,
  DecisionsFile,
  DeletionLog,
  MetadataFixState,
  Decision,
} from './types.js';
import {
  findFilesWithMissingMetadata,
  fixMetadataInteractive,
} from './metadata-fixer.js';
import {
  loadRules,
  saveRules,
  promptForRules,
  promptRulesAction,
  extractUniqueDirectories,
} from './rules.js';
import {
  applyRulesToGroups,
  summarizeAutoDecisions,
} from './auto-decider.js';
import {
  calculateDeletionSummary,
  displayPreDeletionSummary,
  promptViewFullList,
  promptDoubleConfirmation,
} from './review-summary.js';

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_FILE = join(process.cwd(), 'config.json');
const SCAN_RESULTS_FILE = join(DATA_DIR, 'scan-results.ndjson');
const SCAN_STATE_FILE = join(DATA_DIR, '.scan-state.json');
const DUPLICATES_FILE = join(DATA_DIR, 'duplicates.json');
const DECISIONS_FILE = join(DATA_DIR, 'decisions.json');
const DELETION_LOG_FILE = join(DATA_DIR, 'deletion-log.json');
const FIX_STATE_FILE = join(DATA_DIR, '.fix-state.json');

const DEFAULT_CONFIG: Config = {
  scanPaths: [homedir(), '/Volumes'],
  excludePatterns: [
    'node_modules',
    '.git',
    'Library/Caches',
    '__pycache__',
    '.Trash',
    '*.app/Contents',
  ],
  durationToleranceSeconds: 5,
  duplicateScoreThreshold: 40,
  supportedExtensions: [
    'mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a',
    'aiff', 'aif', 'alac', 'wma', 'opus', 'ape', 'wv',
  ],
};

function expandPath(path: string): string {
  if (path === '~' || path.startsWith('~/')) {
    return path.replace('~', homedir());
  }

  return path;
}

async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    const config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };

    if (config.scanPaths) {
      config.scanPaths = config.scanPaths.map(expandPath);
    }

    return config;
  } catch {
    console.error(chalk.red(`Config file not found: ${CONFIG_FILE}`));
    console.error(chalk.gray('Please ensure config.json exists in the project root.'));
    process.exit(1);
  }
}

async function loadScanState(): Promise<ScanState | null> {
  try {
    const data = await readFile(SCAN_STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveScanState(state: ScanState): Promise<void> {
  await writeFile(SCAN_STATE_FILE, JSON.stringify(state, null, 2));
}

async function loadScannedFiles(): Promise<Map<string, AudioFileMetadata>> {
  const files = new Map<string, AudioFileMetadata>();

  if (!existsSync(SCAN_RESULTS_FILE)) {
    return files;
  }

  try {
    const data = await readFile(SCAN_RESULTS_FILE, 'utf-8');
    const lines = data.split('\n').filter(Boolean);

    for (const line of lines) {
      const metadata = JSON.parse(line) as AudioFileMetadata;
      files.set(metadata.path, metadata);
    }
  } catch {
    // Start fresh if file is corrupted
  }

  return files;
}

async function runScan(): Promise<void> {
  console.log(chalk.cyan('\n🔍 Audio File Scanner\n'));

  await mkdir(DATA_DIR, { recursive: true });
  const config = await loadConfig();

  const existingState = await loadScanState();
  const existingFiles = await loadScannedFiles();
  let shouldResume = false;

  if (existingState && existingFiles.size > 0) {
    console.log(chalk.yellow(`Found existing scan with ${existingFiles.size} files`));

    shouldResume = await confirm({
      message: 'Resume previous scan?',
      default: true,
    });

    if (!shouldResume) {
      await writeFile(SCAN_RESULTS_FILE, '');
      existingFiles.clear();
    }
  }

  const state: ScanState = shouldResume && existingState
    ? { ...existingState, resumedAt: new Date().toISOString() }
    : { lastProcessedFile: null, processedCount: 0, startedAt: new Date().toISOString() };

  console.log(chalk.gray(`\nScan paths: ${config.scanPaths.join(', ')}`));
  console.log(chalk.gray(`Extensions: ${config.supportedExtensions.join(', ')}\n`));

  const spinner = ora('Discovering audio files...').start();
  const discoveredFiles: string[] = [];

  try {
    await scanWithRipgrep(
      config.scanPaths,
      config.supportedExtensions,
      config.excludePatterns,
      (path) => {
        discoveredFiles.push(path);
        spinner.text = `Discovering audio files... (${discoveredFiles.length} found)`;
      }
    );
  } catch (error) {
    spinner.fail('Failed to scan');
    console.error(error);
    return;
  }

  spinner.succeed(`Found ${discoveredFiles.length} audio files`);

  const filesToProcess = discoveredFiles.filter((path) => !existingFiles.has(path));

  console.log(chalk.gray(`\nNew files to process: ${filesToProcess.length}`));
  console.log(chalk.gray(`Already scanned: ${existingFiles.size}\n`));

  if (filesToProcess.length === 0) {
    console.log(chalk.green('No new files to scan!'));
    return;
  }

  const progressBar = new cliProgress.SingleBar({
    format: 'Extracting metadata |{bar}| {percentage}% | {value}/{total} files | {eta}s remaining',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  });

  progressBar.start(filesToProcess.length, 0);

  let processed = 0;
  let errors = 0;

  for (const filePath of filesToProcess) {
    const metadata = await extractMetadata(filePath);

    if (metadata) {
      await appendFile(SCAN_RESULTS_FILE, JSON.stringify(metadata) + '\n');
      existingFiles.set(filePath, metadata);
    } else {
      errors++;
    }

    processed++;
    state.processedCount = existingFiles.size;
    state.lastProcessedFile = filePath;

    if (processed % 100 === 0) {
      await saveScanState(state);
    }

    progressBar.update(processed);
  }

  progressBar.stop();
  await saveScanState(state);

  console.log(chalk.green(`\n✓ Scan complete!`));
  console.log(chalk.gray(`  Total files: ${existingFiles.size}`));
  console.log(chalk.gray(`  Errors: ${errors}`));
  console.log(chalk.gray(`  Results saved to: ${SCAN_RESULTS_FILE}`));
}

async function runFindDupes(): Promise<void> {
  console.log(chalk.cyan('\n🔎 Duplicate Finder\n'));

  const config = await loadConfig();
  const files = await loadScannedFiles();

  if (files.size === 0) {
    console.log(chalk.yellow('No scan results found. Run "npm run scan" first.'));
    return;
  }

  console.log(chalk.gray(`Analyzing ${files.size} files...\n`));

  const spinner = ora('Finding duplicates...').start();

  const groups = findDuplicates(files, config);

  spinner.succeed(`Found ${groups.length} duplicate groups`);

  const duplicatesFile: DuplicatesFile = {
    generatedAt: new Date().toISOString(),
    totalGroups: groups.length,
    groups,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DUPLICATES_FILE, JSON.stringify(duplicatesFile, null, 2));

  console.log(chalk.gray(`\nResults saved to: ${DUPLICATES_FILE}`));

  if (groups.length > 0) {
    console.log(chalk.yellow(`\nFound ${groups.length} duplicate pairs to review`));
    console.log(chalk.gray('Run "npm run review" to review and decide on duplicates'));
  }
}

async function runReview(): Promise<void> {
  console.log(chalk.cyan('\n📋 Duplicate Review\n'));

  const duplicatesData = await readFile(DUPLICATES_FILE, 'utf-8').catch(() => null);

  if (!duplicatesData) {
    console.log(chalk.yellow('No duplicates found. Run "npm run find-dupes" first.'));
    return;
  }

  const duplicates: DuplicatesFile = JSON.parse(duplicatesData);
  const files = await loadScannedFiles();

  let existingDecisions: DecisionsFile = { reviewedAt: '', decisions: [] };

  try {
    const data = await readFile(DECISIONS_FILE, 'utf-8');
    existingDecisions = JSON.parse(data);
  } catch {
    // No existing decisions
  }

  const existingDecisionIds = new Set(existingDecisions.decisions.map((d) => d.groupId));

  let rules = await loadRules();

  if (rules) {
    const action = await promptRulesAction(rules);

    if (action === 'reconfigure') {
      const directories = extractUniqueDirectories(files);
      rules = await promptForRules(directories);
      await saveRules(rules);
    }
  } else {
    console.log(chalk.yellow('No duplicate resolution rules configured yet.\n'));

    const directories = extractUniqueDirectories(files);
    rules = await promptForRules(directories);
    await saveRules(rules);
  }

  const sortedGroups = [...duplicates.groups].sort(
    (a, b) => b.confidence - a.confidence
  );

  console.log(chalk.cyan('\nApplying rules to duplicate groups...'));

  const autoResult = applyRulesToGroups(sortedGroups, rules, files, existingDecisionIds);
  summarizeAutoDecisions(autoResult);

  const allDecisions: Decision[] = [
    ...existingDecisions.decisions,
    ...autoResult.autoDecisions,
  ];

  if (autoResult.manualGroups.length > 0) {
    console.log(chalk.yellow(`\n${autoResult.manualGroups.length} pairs need manual review\n`));

    const result = await reviewDuplicates(
      autoResult.manualGroups,
      files,
      allDecisions,
      { label: 'Manual Review' }
    );

    allDecisions.push(
      ...result.decisions.filter(
        (d) => !allDecisions.some((existing) => existing.groupId === d.groupId)
      )
    );
  } else {
    console.log(chalk.green('\nAll pairs were auto-decided!'));
  }

  const decisionsFile: DecisionsFile = {
    reviewedAt: new Date().toISOString(),
    decisions: allDecisions,
  };

  await writeFile(DECISIONS_FILE, JSON.stringify(decisionsFile, null, 2));
  summarizeDecisions(allDecisions);

  console.log(chalk.gray(`\nDecisions saved to: ${DECISIONS_FILE}`));
  console.log(chalk.gray('Run "npm run execute" to execute deletions'));
}

async function runExecute(): Promise<void> {
  console.log(chalk.cyan('\n🗑️  Execute Deletions\n'));

  const decisionsData = await readFile(DECISIONS_FILE, 'utf-8').catch(() => null);

  if (!decisionsData) {
    console.log(chalk.yellow('No decisions found. Run "npm run review" first.'));
    return;
  }

  const decisions: DecisionsFile = JSON.parse(decisionsData);
  const files = await loadScannedFiles();

  const summary = calculateDeletionSummary(decisions.decisions, files);

  if (summary.totalFiles === 0) {
    console.log(chalk.yellow('No files marked for deletion.'));
    return;
  }

  displayPreDeletionSummary(summary, files);

  await promptViewFullList(summary.filesToDelete);

  const confirmed = await promptDoubleConfirmation(summary.totalFiles);

  if (!confirmed) {
    console.log(chalk.yellow('\nDeletion cancelled.'));
    return;
  }

  const log = await executeDecisions(decisions.decisions);

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DELETION_LOG_FILE, JSON.stringify(log, null, 2));

  console.log(chalk.gray(`\nLog saved to: ${DELETION_LOG_FILE}`));
}

async function loadFixState(): Promise<MetadataFixState | null> {
  try {
    const data = await readFile(FIX_STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveFixState(state: MetadataFixState): Promise<void> {
  await writeFile(FIX_STATE_FILE, JSON.stringify(state, null, 2));
}

async function runFixMetadata(): Promise<void> {
  console.log(chalk.cyan('\n🔧 Fix Missing Metadata\n'));

  const files = await loadScannedFiles();

  if (files.size === 0) {
    console.log(chalk.yellow('No scan results found. Run "npm run scan" first.'));
    return;
  }

  const filesWithMissing = findFilesWithMissingMetadata(files);

  if (filesWithMissing.length === 0) {
    console.log(chalk.green('All files have artist and title metadata!'));
    return;
  }

  const existingState = await loadFixState();
  let shouldResume = false;

  if (existingState && existingState.lastProcessedIndex > 0) {
    const remaining = filesWithMissing.length - existingState.lastProcessedIndex;

    console.log(
      chalk.yellow(
        `Found existing progress: ${existingState.fixedCount} fixed, ${remaining} remaining`
      )
    );

    shouldResume = await confirm({
      message: 'Resume from where you left off?',
      default: true,
    });

    if (!shouldResume) {
      await writeFile(FIX_STATE_FILE, '{}');
    }
  }

  const result = await fixMetadataInteractive(
    filesWithMissing,
    files,
    shouldResume ? existingState : null
  );

  await saveFixState(result.state);

  if (result.updatedFiles.size > 0) {
    console.log(chalk.gray('\nUpdating scan results...'));

    const allData = await readFile(SCAN_RESULTS_FILE, 'utf-8');
    const lines = allData.split('\n').filter(Boolean);
    const updatedLines: string[] = [];

    for (const line of lines) {
      const metadata = JSON.parse(line) as AudioFileMetadata;
      const updated = result.updatedFiles.get(metadata.path);

      if (updated) {
        updatedLines.push(JSON.stringify(updated));
      } else {
        updatedLines.push(line);
      }
    }

    await writeFile(SCAN_RESULTS_FILE, updatedLines.join('\n') + '\n');
    console.log(chalk.green(`Updated ${result.updatedFiles.size} entries in scan results`));
  }
}

async function runAll(): Promise<void> {
  console.log(chalk.cyan('\n🎵 Audio Duplicate Manager\n'));
  console.log(chalk.gray('Complete workflow:'));
  console.log(chalk.gray('  1. Scan - Discover files and extract metadata'));
  console.log(chalk.gray('  2. Fix Metadata - Fill in missing artist/title/genre/album'));
  console.log(chalk.gray('  3. Find Duplicates - Detect duplicate files'));
  console.log(chalk.gray('  4. Review - Rules-based auto-decisions + manual review'));
  console.log(chalk.gray('  5. Execute - Delete duplicates with double confirmation\n'));

  const proceed = await confirm({
    message: 'Start with scanning?',
    default: true,
  });

  if (!proceed) {
    return;
  }

  await runScan();

  const fixMeta = await confirm({
    message: '\nFix missing metadata before finding duplicates?',
    default: true,
  });

  if (fixMeta) {
    await runFixMetadata();
  }

  const findDupes = await confirm({
    message: '\nContinue to find duplicates?',
    default: true,
  });

  if (!findDupes) {
    return;
  }

  await runFindDupes();

  const review = await confirm({
    message: '\nContinue to review duplicates?',
    default: true,
  });

  if (!review) {
    return;
  }

  await runReview();

  const execute = await confirm({
    message: '\nContinue to execute deletions?',
    default: false,
  });

  if (execute) {
    await runExecute();
  }

  console.log(chalk.green('\n✓ Done!'));
}

const command = process.argv[2];

switch (command) {
  case 'scan':
    runScan().catch(console.error);
    break;

  case 'find-dupes':
    runFindDupes().catch(console.error);
    break;

  case 'review':
    runReview().catch(console.error);
    break;

  case 'execute':
    runExecute().catch(console.error);
    break;

  case 'fix-metadata':
    runFixMetadata().catch(console.error);
    break;

  default:
    runAll().catch(console.error);
}
