import type {
  DuplicateGroup,
  DuplicateRules,
  AudioFileMetadata,
  ExtendedDecision,
  ScoringWeights,
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

interface FileScore {
  file: AudioFileMetadata;
  score: number;
  breakdown: {
    lossless: number;
    bitrate: number;
    pathPriority: number;
    metadataQuality: number;
  };
}

function getFileMetadata(
  path: string,
  files: Map<string, AudioFileMetadata>
): AudioFileMetadata | null {
  return files.get(path) ?? null;
}

function calculateLosslessScore(file: AudioFileMetadata, weight: number): number {
  return file.lossless ? weight : 0;
}

function calculateBitrateScore(
  file: AudioFileMetadata,
  allFiles: AudioFileMetadata[],
  weight: number
): number {
  const bitrates = allFiles
    .map((f) => f.bitrate ?? 0)
    .filter((b) => b > 0);

  if (bitrates.length === 0) {
    return 0;
  }

  const maxBitrate = Math.max(...bitrates);
  const minBitrate = Math.min(...bitrates);
  const fileBitrate = file.bitrate ?? 0;

  if (maxBitrate === minBitrate) {
    return weight;
  }

  const normalized = (fileBitrate - minBitrate) / (maxBitrate - minBitrate);

  return normalized * weight;
}

function calculatePathPriorityScore(
  file: AudioFileMetadata,
  pathPriority: string[],
  weight: number
): number {
  if (pathPriority.length === 0) {
    return 0;
  }

  const fileDir = dirname(file.path);

  for (let i = 0; i < pathPriority.length; i++) {
    const priorityPath = pathPriority[i];

    if (fileDir === priorityPath || fileDir.startsWith(priorityPath + '/')) {
      const position = pathPriority.length - i;
      return (position / pathPriority.length) * weight;
    }
  }

  return 0;
}

function calculateMetadataQualityScore(file: AudioFileMetadata, weight: number): number {
  const fields = [file.title, file.artist, file.album, file.genre, file.year];
  const filledCount = fields.filter((f) => f !== null && f !== '').length;

  return (filledCount / fields.length) * weight;
}

function calculateFileScore(
  file: AudioFileMetadata,
  allFiles: AudioFileMetadata[],
  weights: ScoringWeights,
  pathPriority: string[]
): FileScore {
  const lossless = calculateLosslessScore(file, weights.lossless);
  const bitrate = calculateBitrateScore(file, allFiles, weights.bitrate);
  const pathPriorityScore = calculatePathPriorityScore(file, pathPriority, weights.pathPriority);
  const metadataQuality = calculateMetadataQualityScore(file, weights.metadataQuality);

  return {
    file,
    score: lossless + bitrate + pathPriorityScore + metadataQuality,
    breakdown: {
      lossless,
      bitrate,
      pathPriority: pathPriorityScore,
      metadataQuality,
    },
  };
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

  const scores = files.map((file) =>
    calculateFileScore(file, files, rules.weights, rules.pathPriority)
  );

  scores.sort((a, b) => b.score - a.score);

  const bestScore = scores[0];
  const secondBestScore = scores[1];
  const scoreDifference = bestScore.score - secondBestScore.score;

  if (scoreDifference < rules.scoreDifferenceThreshold) {
    return {
      decision: null,
      needsManualReview: true,
      reason: `Score difference ${scoreDifference.toFixed(1)}% below threshold ${rules.scoreDifferenceThreshold}%`,
    };
  }

  const keepPath = bestScore.file.path;
  const deletePaths = group.files.filter((p) => p !== keepPath);

  return {
    decision: {
      groupId: group.id,
      keep: [keepPath],
      delete: deletePaths,
      notDuplicates: false,
      decisionType: 'auto',
      ruleApplied: 'weighted-score',
    },
    needsManualReview: false,
    reason: `Keeping file with highest score (${bestScore.score.toFixed(1)}%)`,
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
  console.log(`\nAuto-decided: ${result.autoDecisions.length} pairs (weighted scoring)`);
  console.log(`Need manual review: ${result.manualGroups.length} pairs`);
}
