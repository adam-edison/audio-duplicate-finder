import type {
  DuplicateGroup,
  DuplicateRules,
  AudioFileMetadata,
  ExtendedDecision,
  RuleName,
  RuleApplied,
} from './types.js';

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

function compareLossless(a: AudioFileMetadata, b: AudioFileMetadata): number {
  if (a.lossless && !b.lossless) {
    return -1;
  }

  if (!a.lossless && b.lossless) {
    return 1;
  }

  return 0;
}

function compareBitrate(a: AudioFileMetadata, b: AudioFileMetadata): number {
  const aBitrate = a.bitrate ?? 0;
  const bBitrate = b.bitrate ?? 0;

  if (aBitrate > bBitrate) {
    return -1;
  }

  if (aBitrate < bBitrate) {
    return 1;
  }

  return 0;
}

function getMetadataCount(file: AudioFileMetadata): number {
  const fields = [file.title, file.artist, file.album, file.genre, file.year];
  return fields.filter((f) => f !== null && f !== '').length;
}

function compareMetadata(a: AudioFileMetadata, b: AudioFileMetadata): number {
  const aCount = getMetadataCount(a);
  const bCount = getMetadataCount(b);

  if (aCount > bCount) {
    return -1;
  }

  if (aCount < bCount) {
    return 1;
  }

  return 0;
}

function applyRule(
  rule: RuleName,
  files: AudioFileMetadata[]
): { winner: AudioFileMetadata | null; applied: boolean } {
  const sorted = [...files];

  let compareFn: (a: AudioFileMetadata, b: AudioFileMetadata) => number;

  if (rule === 'lossless') {
    compareFn = compareLossless;
  } else if (rule === 'bitrate') {
    compareFn = compareBitrate;
  } else {
    compareFn = compareMetadata;
  }

  sorted.sort(compareFn);

  const best = sorted[0];
  const second = sorted[1];

  if (compareFn(best, second) < 0) {
    return { winner: best, applied: true };
  }

  return { winner: null, applied: false };
}

function isInDestination(path: string, destinationDir: string): boolean {
  return path.startsWith(destinationDir + '/') || path.startsWith(destinationDir);
}

function findBestFile(
  files: AudioFileMetadata[],
  ruleOrder: RuleName[],
  destinationDir: string
): { winner: AudioFileMetadata; ruleApplied: RuleApplied } {
  for (const rule of ruleOrder) {
    const result = applyRule(rule, files);

    if (result.applied && result.winner) {
      return { winner: result.winner, ruleApplied: rule };
    }
  }

  const inDest = files.find((f) => isInDestination(f.path, destinationDir));

  if (inDest) {
    return { winner: inDest, ruleApplied: 'tie' };
  }

  return { winner: files[0], ruleApplied: 'tie' };
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

  const { winner, ruleApplied } = findBestFile(files, rules.ruleOrder, rules.destinationDir);
  const keepPath = winner.path;
  const deletePaths = group.files.filter((p) => p !== keepPath);
  const needsCopy = !isInDestination(keepPath, rules.destinationDir);

  return {
    decision: {
      groupId: group.id,
      keep: [keepPath],
      delete: deletePaths,
      notDuplicates: false,
      decisionType: 'auto',
      ruleApplied,
      copyToDestination: needsCopy,
    },
    needsManualReview: false,
    reason: `Keeping best file (rule: ${ruleApplied})`,
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
  const needsCopy = result.autoDecisions.filter((d) => d.copyToDestination).length;
  const alreadyInPlace = result.autoDecisions.length - needsCopy;

  console.log(`\nAuto-decided: ${result.autoDecisions.length} pairs`);
  console.log(`  - ${alreadyInPlace} already in destination`);
  console.log(`  - ${needsCopy} will be copied to destination`);
  console.log(`Need manual review: ${result.manualGroups.length} pairs`);
}
