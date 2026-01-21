import type {
  DuplicateGroup,
  DuplicateRules,
  AudioFileMetadata,
  ExtendedDecision,
  RuleApplied,
} from './types.js';
import { dirname } from 'node:path';

export interface AutoDecisionResult {
  autoDecisions: ExtendedDecision[];
  manualGroups: DuplicateGroup[];
}

interface EvaluationResult {
  decision: ExtendedDecision | null;
  needsManualReview: boolean;
  reason: string;
}

function getFileMetadata(
  path: string,
  files: Map<string, AudioFileMetadata>
): AudioFileMetadata | null {
  return files.get(path) ?? null;
}

function getDurationDiff(
  files: AudioFileMetadata[]
): number {
  const durations = files
    .map((f) => f.duration)
    .filter((d): d is number => d !== null);

  if (durations.length < 2) {
    return 0;
  }

  const min = Math.min(...durations);
  const max = Math.max(...durations);

  return max - min;
}

function bothAreLossless(files: AudioFileMetadata[]): boolean {
  return files.every((f) => f.lossless);
}

function bothAreLossy(files: AudioFileMetadata[]): boolean {
  return files.every((f) => !f.lossless);
}

function hasLosslessAndLossy(files: AudioFileMetadata[]): boolean {
  const hasLossless = files.some((f) => f.lossless);
  const hasLossy = files.some((f) => !f.lossless);

  return hasLossless && hasLossy;
}

function findLosslessFile(files: AudioFileMetadata[]): AudioFileMetadata | null {
  return files.find((f) => f.lossless) ?? null;
}

function findHigherBitrateFile(files: AudioFileMetadata[]): AudioFileMetadata | null {
  let best: AudioFileMetadata | null = null;
  let maxBitrate = 0;

  for (const file of files) {
    const bitrate = file.bitrate ?? 0;

    if (bitrate > maxBitrate) {
      maxBitrate = bitrate;
      best = file;
    }
  }

  if (best && files.filter((f) => (f.bitrate ?? 0) === maxBitrate).length > 1) {
    return null;
  }

  return best;
}

function findFileByPathPriority(
  files: AudioFileMetadata[],
  pathPriority: string[]
): AudioFileMetadata | null {
  for (const priorityPath of pathPriority) {
    for (const file of files) {
      const dir = dirname(file.path);

      if (dir === priorityPath || dir.startsWith(priorityPath + '/')) {
        return file;
      }
    }
  }

  return null;
}

function evaluateGroup(
  group: DuplicateGroup,
  rules: DuplicateRules,
  filesMap: Map<string, AudioFileMetadata>
): EvaluationResult {
  const files = group.files
    .map((path) => getFileMetadata(path, filesMap))
    .filter((f): f is AudioFileMetadata => f !== null);

  if (files.length < 2) {
    return {
      decision: null,
      needsManualReview: true,
      reason: 'Could not load metadata for all files',
    };
  }

  if (group.confidence < rules.confidenceThreshold) {
    return {
      decision: null,
      needsManualReview: true,
      reason: `Confidence ${group.confidence}% below threshold ${rules.confidenceThreshold}%`,
    };
  }

  const durationDiff = getDurationDiff(files);

  if (durationDiff > rules.maxDurationDiffSeconds) {
    return {
      decision: null,
      needsManualReview: true,
      reason: `Duration difference ${durationDiff.toFixed(1)}s exceeds ${rules.maxDurationDiffSeconds}s`,
    };
  }

  if (bothAreLossless(files)) {
    return {
      decision: null,
      needsManualReview: true,
      reason: 'Both files are lossless - manual selection needed',
    };
  }

  if (rules.preferLossless && hasLosslessAndLossy(files)) {
    const losslessFile = findLosslessFile(files);

    if (losslessFile) {
      const deletePaths = group.files.filter((p) => p !== losslessFile.path);

      return {
        decision: {
          groupId: group.id,
          keep: [losslessFile.path],
          delete: deletePaths,
          notDuplicates: false,
          decisionType: 'auto',
          ruleApplied: 'lossless-over-lossy',
        },
        needsManualReview: false,
        reason: 'Keeping lossless file over lossy',
      };
    }
  }

  if (rules.preferHigherBitrate && bothAreLossy(files)) {
    const higherBitrateFile = findHigherBitrateFile(files);

    if (higherBitrateFile) {
      const deletePaths = group.files.filter((p) => p !== higherBitrateFile.path);

      return {
        decision: {
          groupId: group.id,
          keep: [higherBitrateFile.path],
          delete: deletePaths,
          notDuplicates: false,
          decisionType: 'auto',
          ruleApplied: 'higher-bitrate',
        },
        needsManualReview: false,
        reason: `Keeping higher bitrate file (${higherBitrateFile.bitrate}kbps)`,
      };
    }
  }

  if (rules.pathPriority.length > 0) {
    const priorityFile = findFileByPathPriority(files, rules.pathPriority);

    if (priorityFile) {
      const deletePaths = group.files.filter((p) => p !== priorityFile.path);

      return {
        decision: {
          groupId: group.id,
          keep: [priorityFile.path],
          delete: deletePaths,
          notDuplicates: false,
          decisionType: 'auto',
          ruleApplied: 'path-priority',
        },
        needsManualReview: false,
        reason: 'Keeping file in higher-priority directory',
      };
    }
  }

  return {
    decision: null,
    needsManualReview: true,
    reason: 'No rule matched - manual review needed',
  };
}

export function applyRulesToGroups(
  groups: DuplicateGroup[],
  rules: DuplicateRules,
  files: Map<string, AudioFileMetadata>,
  existingDecisions: Set<string>
): AutoDecisionResult {
  const autoDecisions: ExtendedDecision[] = [];
  const manualGroups: DuplicateGroup[] = [];

  for (const group of groups) {
    if (existingDecisions.has(group.id)) {
      continue;
    }

    const hasDecidedFile = group.files.some((f) => {
      for (const decision of autoDecisions) {
        if (decision.keep.includes(f) || decision.delete.includes(f)) {
          return true;
        }
      }

      return false;
    });

    if (hasDecidedFile) {
      continue;
    }

    const result = evaluateGroup(group, rules, files);

    if (result.needsManualReview) {
      manualGroups.push(group);
      continue;
    }

    if (result.decision) {
      autoDecisions.push(result.decision);
    }
  }

  return { autoDecisions, manualGroups };
}

export function summarizeAutoDecisions(result: AutoDecisionResult): void {
  const byRule = new Map<RuleApplied, number>();

  for (const decision of result.autoDecisions) {
    const count = byRule.get(decision.ruleApplied) ?? 0;
    byRule.set(decision.ruleApplied, count + 1);
  }

  console.log(`\nAuto-decided: ${result.autoDecisions.length} pairs`);

  for (const [rule, count] of byRule) {
    const ruleLabel = rule ?? 'unknown';
    console.log(`  - ${ruleLabel}: ${count}`);
  }

  console.log(`Need manual review: ${result.manualGroups.length} pairs`);
}
