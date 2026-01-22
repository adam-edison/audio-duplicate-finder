import { parseFilename } from './src/parser.js';
import { inferMetadata } from './src/inference.js';

const testFiles = [
  'AGES - slacker improv.mp3',
  'Radiohead - Creep.mp3',
  'Unknown Artist - Mystery Song.mp3',
];

console.log('Testing parser...');
for (const f of testFiles) {
  const parsed = parseFilename('/test/' + f);
  console.log(`  ${f} => artist: "${parsed.possibleArtist}", title: "${parsed.possibleTitle}"`);
}

console.log('\nTesting inference...');
for (const f of testFiles) {
  const parsed = parseFilename('/test/' + f);
  const result = inferMetadata(parsed, [], ['genre']);
  console.log(`  ${f}: genre=${result.genre}`);
}
