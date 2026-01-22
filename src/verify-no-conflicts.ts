import { readFileSync } from 'fs';
import { join } from 'path';

interface ExtendedDecision {
  groupId: string;
  keep: string[];
  delete: string[];
  notDuplicates: boolean;
}

interface DecisionsFile {
  reviewedAt: string;
  decisions: ExtendedDecision[];
}

const decisionsPath = join(process.cwd(), 'data', 'decisions-resolved.json');
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

let conflictCount = 0;

for (const [file, keptInGroups] of keepFiles.entries()) {
  const deletedInGroups = deleteFiles.get(file);

  if (deletedInGroups) {
    conflictCount++;
    console.log(`CONFLICT: ${file}`);
    console.log(`  Kept in: ${keptInGroups.join(', ')}`);
    console.log(`  Deleted in: ${deletedInGroups.join(', ')}`);
  }
}

console.log(`\n=== VERIFICATION RESULTS ===`);
console.log(`Total decisions: ${data.decisions.length}`);
console.log(`Unique files to keep: ${keepFiles.size}`);
console.log(`Unique files to delete: ${deleteFiles.size}`);
console.log(`Conflicts found: ${conflictCount}`);

if (conflictCount === 0) {
  console.log(`\n✓ No conflicts! Safe to apply.`);
} else {
  console.log(`\n✗ Conflicts found! Do not apply until resolved.`);
}
