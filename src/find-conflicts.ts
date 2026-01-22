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

const decisionsPath = join(process.cwd(), 'data', 'decisions.json');
const data: DecisionsFile = JSON.parse(readFileSync(decisionsPath, 'utf-8'));

const keepFiles = new Map<string, string[]>();
const deleteFiles = new Map<string, string[]>();

for (const decision of data.decisions) {
  for (const file of decision.keep) {
    const existing = keepFiles.get(file) || [];
    existing.push(decision.groupId);
    keepFiles.set(file, existing);
  }

  for (const file of decision.delete) {
    const existing = deleteFiles.get(file) || [];
    existing.push(decision.groupId);
    deleteFiles.set(file, existing);
  }
}

interface Conflict {
  file: string;
  keptInGroups: string[];
  deletedInGroups: string[];
}

const conflicts: Conflict[] = [];

for (const [file, keptInGroups] of keepFiles.entries()) {
  const deletedInGroups = deleteFiles.get(file);

  if (deletedInGroups) {
    conflicts.push({
      file,
      keptInGroups,
      deletedInGroups,
    });
  }
}

console.log(`\n=== CONFLICT ANALYSIS ===\n`);
console.log(`Total decisions: ${data.decisions.length}`);
console.log(`Unique files in 'keep': ${keepFiles.size}`);
console.log(`Unique files in 'delete': ${deleteFiles.size}`);
console.log(`\nCONFLICTS FOUND: ${conflicts.length}\n`);

if (conflicts.length > 0) {
  console.log('Files that appear in BOTH keep and delete:\n');

  for (const conflict of conflicts) {
    console.log(`FILE: ${conflict.file}`);
    console.log(`  Kept in: ${conflict.keptInGroups.join(', ')}`);
    console.log(`  Deleted in: ${conflict.deletedInGroups.join(', ')}`);

    for (const groupId of [...conflict.keptInGroups, ...conflict.deletedInGroups]) {
      const decision = data.decisions.find(d => d.groupId === groupId);
      if (decision) {
        console.log(`\n  ${groupId} (${decision.decisionType}, rule: ${decision.ruleApplied}):`);
        console.log(`    keep: ${decision.keep.join(', ')}`);
        console.log(`    delete: ${decision.delete.join(', ')}`);
      }
    }
    console.log('\n---\n');
  }

  const outputPath = join(process.cwd(), 'data', 'conflicts.json');
  writeFileSync(outputPath, JSON.stringify(conflicts, null, 2));
  console.log(`\nConflicts written to: ${outputPath}`);
}

const multipleDeletes = new Map<string, string[]>();
for (const [file, groups] of deleteFiles.entries()) {
  if (groups.length > 1) {
    multipleDeletes.set(file, groups);
  }
}

if (multipleDeletes.size > 0) {
  console.log(`\n=== FILES MARKED FOR DELETE IN MULTIPLE GROUPS ===\n`);
  console.log(`Count: ${multipleDeletes.size}\n`);

  for (const [file, groups] of multipleDeletes.entries()) {
    console.log(`${file}`);
    console.log(`  Groups: ${groups.join(', ')}\n`);
  }
}
