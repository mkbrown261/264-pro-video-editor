import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('src/renderer/store/editorStore.ts', 'utf8');

const marker = '// \u2500\u2500 Background Removal \u2500\u2500\n  setBackgroundRemoval: (clipId:';
const idx = c.indexOf(marker);
if (idx === -1) { console.log('Marker not found'); process.exit(1); }

const injection = `// \u2500\u2500 Grade Versioning (A/B/C slots) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  switchGradeSlot: (clipId, slot) => {
    set((state) => updateClipInState(state, clipId, (c) => {
      const currentSlot = c.activeGradeSlot ?? 'A';
      const versions = { ...(c.gradeVersions ?? {}) };
      if (c.colorGrade) versions[currentSlot] = { ...c.colorGrade };
      const targetGrade = versions[slot] ?? createDefaultColorGrade();
      return { ...c, gradeVersions: versions, activeGradeSlot: slot, colorGrade: targetGrade };
    }));
  },

  copyGradeToSlot: (clipId, fromSlot, toSlot) => {
    set((state) => updateClipInState(state, clipId, (c) => {
      const versions = { ...(c.gradeVersions ?? {}) };
      const currentSlot = c.activeGradeSlot ?? 'A';
      const src = fromSlot === currentSlot ? (c.colorGrade ?? createDefaultColorGrade()) : (versions[fromSlot] ?? createDefaultColorGrade());
      versions[toSlot] = { ...src };
      return { ...c, gradeVersions: versions };
    }));
  },

`;

c = c.slice(0, idx) + injection + c.slice(idx);
writeFileSync('src/renderer/store/editorStore.ts', c);
console.log('Grade versioning injected at index', idx);
