const fs = require('fs');

// Fix package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '1.0.8';
if (!pkg.build) pkg.build = {};
pkg.build.directories = { output: 'release', buildResources: 'build-assets' };
pkg.build.files = ['dist/**/*', 'dist-electron/**/*', 'package.json'];
if (!pkg.build.mac) pkg.build.mac = {};
pkg.build.mac.hardenedRuntime = false;
delete pkg.build.mac.entitlements;
delete pkg.build.mac.entitlementsInherit;
delete pkg.build.dmg;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('package.json done, version:', pkg.version);
