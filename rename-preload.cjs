const fs = require('fs');
const path = require('path');

const src = path.join('dist-electron', 'electron', 'preload.js');
const dst = path.join('dist-electron', 'electron', 'preload.cjs');

if (fs.existsSync(dst)) {
  console.log('preload.cjs already exists, skipping rename');
  process.exit(0);
}

if (!fs.existsSync(src)) {
  console.error('ERROR: preload.js not found at', src);
  process.exit(1);
}

fs.renameSync(src, dst);
console.log('Renamed preload.js -> preload.cjs');
