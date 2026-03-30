const fs = require('fs');
const path = require('path');

function findFile(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return null;
}

console.log('dist-electron contents:');
function logDir(dir, indent) {
  if (!fs.existsSync(dir)) { console.log(indent + '(empty)'); return; }
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    console.log(indent + f.name);
    if (f.isDirectory()) logDir(path.join(dir, f.name), indent + '  ');
  }
}
logDir('dist-electron', '  ');

const src = findFile('dist-electron', 'preload.js');
if (!src) {
  console.error('ERROR: preload.js not found anywhere in dist-electron');
  process.exit(1);
}
const dst = src.replace('preload.js', 'preload.cjs');
fs.renameSync(src, dst);
console.log('Renamed', src, '→', dst);
