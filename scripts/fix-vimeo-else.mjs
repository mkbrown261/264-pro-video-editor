import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/renderer/components/ClawFlowPublishPanel.tsx', 'utf8');
// Remove the orphan "} else {" that precedes vimeo block
c = c.replace('else {\n        } else if (platform === \'vimeo\')', 'else if (platform === \'vimeo\')');
writeFileSync('src/renderer/components/ClawFlowPublishPanel.tsx', c);
console.log('Fixed');
