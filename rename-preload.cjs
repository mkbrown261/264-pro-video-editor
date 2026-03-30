const fs = require('fs');
const src = 'dist-electron/electron/preload.js';
const dst = 'dist-electron/electron/preload.cjs';
if (fs.existsSync(src)) {
  fs.renameSync(src, dst);
  console.log('Renamed preload.js → preload.cjs');
} else {
  console.error('ERROR: preload.js not found at', src);
  process.exit(1);
}
