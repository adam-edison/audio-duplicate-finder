import type {
  DuplicateGroup,
  DuplicateRules,
  AudioFileMetadata,
  ExtendedDecision,
  RuleName,
  RuleApplied,
  MetadataComparison,
  MetadataFieldName,
} from './types.js';

export interface AutoDecisionResult {
  autoDecisions: ExtendedDecision[];
  manualGroups: DuplicateGroup[];
  metadataReviewDecisions: ExtendedDecision[];
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

function normalizeValue(value: string | number | null): string | number | null {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }

  return value;
}

export function compareMetadataFields(
  fileA: AudioFileMetadata,
  fileB: AudioFileMetadata
): MetadataComparison {
  const fieldsToCompare: MetadataFieldName[] = ['title', 'artist', 'album', 'genre', 'year'];
  const differences: MetadataComparison['differences'] = [];

  for (const field of fieldsToCompare) {
    const valueA = fileA[field];
    const valueB = fileB[field];

    const normalizedA = normalizeValue(valueA);
    const normalizedB = normalizeValue(valueB);

    if (normalizedA === normalizedB) {
      continue;
    }

    if (normalizedA === null && normalizedB === null) {
      continue;
    }

    differences.push({
      field,
      fileA: valueA,
      fileB: valueB,
    });
  }

  return {
    identical: differences.length === 0,
    differences,
  };
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

  const loser = files.find((f) => f.path !== keepPath);
  const metadataComparison = loser ? compareMetadataFields(winner, loser) : { identical: true, differences: [] };

  const isTie = ruleApplied === 'tie';
  const needsMetadataReview = isTie && !metadataComparison.identical;
  const metadataSource = metadataComparison.identical ? keepPath : undefined;

  return {
    decision: {
      groupId: group.id,
      keep: [keepPath],
      delete: deletePaths,
      notDuplicates: false,
      decisionType: 'auto',
      ruleApplied,
      copyToDestination: needsCopy,
      metadataSource,
      needsMetadataReview,
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
  const metadataReviewDecisions: ExtendedDecision[] = [];

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

      for (const decision of metadataReviewDecisions) {
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

    if (!result.decision) {
      continue;
    }

    if (result.decision.needsMetadataReview) {
      metadataReviewDecisions.push(result.decision);
      continue;
    }

    autoDecisions.push(result.decision);
  }

  return { autoDecisions, manualGroups, metadataReviewDecisions };
}

export function summarizeAutoDecisions(result: AutoDecisionResult): void {
  const needsCopy = result.autoDecisions.filter((d) => d.copyToDestination).length;
  const alreadyInPlace = result.autoDecisions.length - needsCopy;

  console.log(`\nAuto-decided: ${result.autoDecisions.length} pairs`);
  console.log(`  - ${alreadyInPlace} already in destination`);
  console.log(`  - ${needsCopy} will be copied to destination`);
  console.log(`Need metadata review: ${result.metadataReviewDecisions.length} pairs`);
  console.log(`Need manual review: ${result.manualGroups.length} pairs`);
}
