import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ExtendedDecision {
  groupId: string;
  keep: string[];
  delete: string[];
  notDuplicates: boolean;
  decisionType: string;
  ruleApplied: string;
  copyToDestination: boolean;
  metadataSource?: string;
  needsMetadataReview?: boolean;
}

interface DecisionsFile {
  reviewedAt: string;
  decisions: ExtendedDecision[];
}

interface Conflict {
  file: string;
  keptInGroups: string[];
  deletedInGroups: string[];
}

const decisionsPath = join(process.cwd(), 'data', 'decisions.json');
const conflictsPath = join(process.cwd(), 'data', 'conflicts.json');

const data: DecisionsFile = JSON.parse(readFileSync(decisionsPath, 'utf-8'));
const conflicts: Conflict[] = JSON.parse(readFileSync(conflictsPath, 'utf-8'));

function extractArtist(filePath: string): string | null {
  // Try to extract artist from path like /Users/.../Music/Artist Name/...
  const musicMatch = filePath.match(/\/Music\/([^/]+)\//);
  if (musicMatch) {
    const folder = musicMatch[1];
    // Skip generic folders
    if (folder === 'Music' || folder === 'Unknown Artist' || folder === 'Media.localized') {
      return null;
    }
    return folder;
  }
  return null;
}

function scoreFile(filePath: string): number {
  let score = 0;

  // Prefer local disk over external drives
  if (filePath.startsWith('/Users/aedison/Music/')) {
    score += 100;
  } else if (filePath.startsWith('/Users/aedison/Downloads/')) {
    score += 50;
  } else if (filePath.startsWith('/Volumes/')) {
    score += 10;
  }

  // Prefer organized folders over Unknown Artist/Unknown Album
  if (filePath.includes('Unknown Artist') || filePath.includes('Unknown Album')) {
    score -= 50;
  }

  // Prefer files with proper album structure (Artist/Album/Track)
  const parts = filePath.split('/');
  const musicIndex = parts.indexOf('Music');
  if (musicIndex >= 0 && parts.length > musicIndex + 3) {
    score += 20;
  }

  // Prefer FLAC over other formats
  if (filePath.endsWith('.flac')) {
    score += 200;
  } else if (filePath.endsWith('.opus')) {
    score += 150;
  } else if (filePath.endsWith('.m4a')) {
    score += 50;
  }

  // Prefer files NOT in mega-unique (those are backups)
  if (filePath.includes('mega-unique')) {
    score -= 30;
  }

  // Prefer files NOT in Media.localized (often duplicates)
  if (filePath.includes('Media.localized')) {
    score -= 20;
  }

  // Prefer shorter paths (usually better organized)
  score -= Math.floor(filePath.length / 20);

  return score;
}

// Build a map of all files involved in decisions
const fileToDecisions = new Map<string, { kept: string[], deleted: string[] }>();

for (const decision of data.decisions) {
  for (const file of decision.keep) {
    const entry = fileToDecisions.get(file) || { kept: [], deleted: [] };
    entry.kept.push(decision.groupId);
    fileToDecisions.set(file, entry);
  }

  for (const file of decision.delete) {
    const entry = fileToDecisions.get(file) || { kept: [], deleted: [] };
    entry.deleted.push(decision.groupId);
    fileToDecisions.set(file, entry);
  }
}

// Find all connected groups (files that are duplicates of each other)
function findConnectedFiles(startFile: string, decisions: ExtendedDecision[]): Set<string> {
  const connected = new Set<string>();
  const toProcess = [startFile];

  while (toProcess.length > 0) {
    const file = toProcess.pop()!;
    if (connected.has(file)) continue;
    connected.add(file);

    for (const decision of decisions) {
      if (decision.keep.includes(file) || decision.delete.includes(file)) {
        for (const f of [...decision.keep, ...decision.delete]) {
          if (!connected.has(f)) {
            toProcess.push(f);
          }
        }
      }
    }
  }

  return connected;
}

// Group conflicts by connected files
const processedFiles = new Set<string>();
const connectedGroups: Set<string>[] = [];

for (const conflict of conflicts) {
  if (processedFiles.has(conflict.file)) continue;

  const connected = findConnectedFiles(conflict.file, data.decisions);
  connectedGroups.push(connected);

  for (const f of connected) {
    processedFiles.add(f);
  }
}

console.log(`\n=== CONFLICT RESOLUTION ===\n`);
console.log(`Found ${connectedGroups.length} groups of connected duplicate files\n`);

interface Resolution {
  keep: string[];
  delete: string[];
  reason: string;
  involvedGroups: string[];
  notDuplicates: boolean;
}

const resolutions: Resolution[] = [];

for (const group of connectedGroups) {
  const files = Array.from(group);

  // Check if files have different artists
  const artists = new Set<string>();
  for (const file of files) {
    const artist = extractArtist(file);
    if (artist) {
      artists.add(artist);
    }
  }

  // Find all involved decision groups
  const involvedGroups = new Set<string>();
  for (const f of files) {
    const entry = fileToDecisions.get(f);
    if (entry) {
      entry.kept.forEach(g => involvedGroups.add(g));
      entry.deleted.forEach(g => involvedGroups.add(g));
    }
  }

  // If multiple different artists, these might not be true duplicates
  if (artists.size > 1) {
    // Group files by artist and pick best from each artist
    const byArtist = new Map<string, string[]>();
    const noArtist: string[] = [];

    for (const file of files) {
      const artist = extractArtist(file);
      if (artist) {
        const existing = byArtist.get(artist) || [];
        existing.push(file);
        byArtist.set(artist, existing);
      } else {
        noArtist.push(file);
      }
    }

    // For each artist, pick the best file
    const keepers: string[] = [];
    const deleters: string[] = [];

    for (const [artist, artistFiles] of byArtist.entries()) {
      const scored = artistFiles.map(f => ({ file: f, score: scoreFile(f) }));
      scored.sort((a, b) => b.score - a.score);
      keepers.push(scored[0].file);
      deleters.push(...scored.slice(1).map(s => s.file));
    }

    // Files without artist go to delete
    deleters.push(...noArtist);

    resolutions.push({
      keep: keepers,
      delete: deleters,
      reason: `Different artists detected: ${Array.from(artists).join(', ')}. Keeping best from each.`,
      involvedGroups: Array.from(involvedGroups),
      notDuplicates: keepers.length > 1, // Mark as not duplicates if keeping multiple
    });

    console.log(`GROUP (${files.length} files) - DIFFERENT ARTISTS:`);
    console.log(`  Artists: ${Array.from(artists).join(', ')}`);
    for (const keeper of keepers) {
      console.log(`  KEEP: ${keeper}`);
    }
    for (const deleter of deleters) {
      console.log(`  DELETE: ${deleter}`);
    }
    console.log(`  Affects decisions: ${Array.from(involvedGroups).join(', ')}`);
    console.log('');
    continue;
  }

  // Single artist - pick the best file
  const scored = files.map(f => ({ file: f, score: scoreFile(f) }));
  scored.sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const losers = scored.slice(1).map(s => s.file);

  resolutions.push({
    keep: [winner.file],
    delete: losers,
    reason: `Score: ${winner.score} (${scored.map(s => `${s.score}`).join(' > ')})`,
    involvedGroups: Array.from(involvedGroups),
    notDuplicates: false,
  });

  console.log(`GROUP (${files.length} files):`);
  console.log(`  KEEP: ${winner.file} (score: ${winner.score})`);
  for (const loser of scored.slice(1)) {
    console.log(`  DELETE: ${loser.file} (score: ${loser.score})`);
  }
  console.log(`  Affects decisions: ${Array.from(involvedGroups).join(', ')}`);
  console.log('');
}

// Now update the decisions
const conflictedGroupIds = new Set<string>();
for (const resolution of resolutions) {
  for (const groupId of resolution.involvedGroups) {
    conflictedGroupIds.add(groupId);
  }
}

const cleanedDecisions = data.decisions.filter(d => !conflictedGroupIds.has(d.groupId));

// Add new consolidated decisions
for (let i = 0; i < resolutions.length; i++) {
  const resolution = resolutions[i];

  if (resolution.notDuplicates) {
    // Create separate keep decisions for each file we're keeping
    for (let j = 0; j < resolution.keep.length; j++) {
      const newDecision: ExtendedDecision = {
        groupId: `resolved-${i + 1}-keep-${j + 1}`,
        keep: [resolution.keep[j]],
        delete: [],
        notDuplicates: true,
        decisionType: 'auto',
        ruleApplied: 'different-artists',
        copyToDestination: false,
      };
      cleanedDecisions.push(newDecision);
    }

    // Create delete decisions for files to remove
    if (resolution.delete.length > 0) {
      const newDecision: ExtendedDecision = {
        groupId: `resolved-${i + 1}-delete`,
        keep: [],
        delete: resolution.delete,
        notDuplicates: false,
        decisionType: 'auto',
        ruleApplied: 'lower-quality-duplicate',
        copyToDestination: false,
      };
      cleanedDecisions.push(newDecision);
    }
  } else {
    const newDecision: ExtendedDecision = {
      groupId: `resolved-${i + 1}`,
      keep: resolution.keep,
      delete: resolution.delete,
      notDuplicates: false,
      decisionType: 'auto',
      ruleApplied: 'conflict-resolution',
      copyToDestination: false,
    };
    cleanedDecisions.push(newDecision);
  }
}

const newData: DecisionsFile = {
  reviewedAt: new Date().toISOString(),
  decisions: cleanedDecisions,
};

console.log(`\n=== SUMMARY ===\n`);
console.log(`Original decisions: ${data.decisions.length}`);
console.log(`Decisions removed (conflicted): ${conflictedGroupIds.size}`);
console.log(`New consolidated decisions added: ${resolutions.length}`);
console.log(`Final decision count: ${cleanedDecisions.length}`);

const differentArtistGroups = resolutions.filter(r => r.notDuplicates);
console.log(`\nGroups with different artists (keeping multiple): ${differentArtistGroups.length}`);

const outputPath = join(process.cwd(), 'data', 'decisions-resolved.json');
writeFileSync(outputPath, JSON.stringify(newData, null, 2));
console.log(`\nResolved decisions written to: ${outputPath}`);

const resolutionsPath = join(process.cwd(), 'data', 'resolutions.json');
writeFileSync(resolutionsPath, JSON.stringify(resolutions, null, 2));
console.log(`Resolution details written to: ${resolutionsPath}`);
