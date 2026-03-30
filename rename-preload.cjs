const fs = require('fs');
const path = require('path');

const dir  = path.join('dist-electron', 'electron');
const src  = path.join(dir, 'preload.js');
const dst  = path.join(dir, 'preload.cjs');

console.log('dist-electron/electron contents:', fs.readdirSync(dir).join(', '));

if (fs.existsSync(dst)) {
  console.log('preload.cjs already exists — done');
  process.exit(0);
}

if (!fs.existsSync(src)) {
  console.error('ERROR: preload.js not found. Contents of dir:', fs.readdirSync(dir).join(', '));
  process.exit(1);
}

fs.renameSync(src, dst);
console.log('Renamed preload.js -> preload.cjs');
