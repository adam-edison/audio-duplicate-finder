import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync('data/decisions.json', 'utf-8'));

interface Suspicious {
  groupId: string;
  reason: string;
  keep: string;
  delete: string;
  keepFull: string;
  deleteFull: string;
}

const suspicious: Suspicious[] = [];

for (const d of data.decisions) {
  if (d.delete.length === 0) continue;

  for (const delPath of d.delete) {
    const keepPath = d.keep[0];
    if (!keepPath) continue;

    const delFile = delPath.split('/').pop() || '';
    const keepFile = keepPath.split('/').pop() || '';

    // Check for Take/Alternate patterns
    if (/take\s*[ivx\d]+|alternate|alt\./i.test(delFile) || /take\s*[ivx\d]+|alternate|alt\./i.test(keepFile)) {
      suspicious.push({
        groupId: d.groupId,
        reason: 'alternate take',
        keep: keepFile,
        delete: delFile,
        keepFull: keepPath,
        deleteFull: delPath,
      });
      continue;
    }

    // Check if files differ only by track number at start
    const delNoNum = delFile.replace(/^\d+[-.\s]+/, '').replace(/\s*\(\d+\)\./, '.').toLowerCase();
    const keepNoNum = keepFile.replace(/^\d+[-.\s]+/, '').replace(/\s*\(\d+\)\./, '.').toLowerCase();

    if (delNoNum === keepNoNum && delFile !== keepFile) {
      const delNum = delFile.match(/^(\d+)/)?.[1];
      const keepNum = keepFile.match(/^(\d+)/)?.[1];

      if (delNum && keepNum && delNum !== keepNum) {
        suspicious.push({
          groupId: d.groupId,
          reason: 'different track numbers',
          keep: keepFile,
          delete: delFile,
          keepFull: keepPath,
          deleteFull: delPath,
        });
        continue;
      }
    }
  }
}

console.log('Suspicious decisions found:', suspicious.length);
console.log('');

for (const s of suspicious) {
  console.log(`${s.groupId} (${s.reason}):`);
  console.log(`  KEEP:   ${s.keep}`);
  console.log(`  DELETE: ${s.delete}`);
  console.log('');
}
