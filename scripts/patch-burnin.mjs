import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/renderer/components/InspectorPanel.tsx', 'utf8');

// 1. Add state vars
const oldState = "  const [youtubeNormalize, setYoutubeNormalize] = useState(true); // default on \u2014 -14 LUFS";
const newState = "  const [youtubeNormalize, setYoutubeNormalize] = useState(true); // default on \u2014 -14 LUFS\n  const [burnInTimecode, setBurnInTimecode]     = useState(false);\n  const [watermarkText, setWatermarkText]       = useState('');";
if (content.includes(oldState)) { content = content.replace(oldState, newState); console.log('State vars added'); } else console.log('State var NOT FOUND');

// 2. Add burn-in UI after the LUFS label/input
const marker = "              />\n              \U0001f3a7 YouTube Normalize (-14 LUFS)\n            </label>\n            <button";
const replacement = `              />
              \U0001f3a7 YouTube Normalize (-14 LUFS)
            </label>
            <label
              style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontSize: 11, color: "var(--text-s)", cursor: "pointer", userSelect: "none" }}
              title="Burn timecode (HH:MM:SS) into the exported video top-left corner."
            >
              <input
                type="checkbox"
                checked={burnInTimecode}
                onChange={e => setBurnInTimecode(e.target.checked)}
                style={{ accentColor: "#f7c948", width: 13, height: 13, cursor: "pointer" }}
              />
              \u23f1 Burn Timecode
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-s)", whiteSpace: "nowrap" }}>Watermark:</span>
              <input
                type="text"
                placeholder="e.g. @YourChannel"
                value={watermarkText}
                onChange={e => setWatermarkText(e.target.value)}
                style={{ flex: 1, fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "2px 6px", color: "var(--text-p)" }}
              />
            </div>
            <button`;
if (content.includes(marker)) { content = content.replace(marker, replacement); console.log('Burn-in UI inserted'); } else console.log('Marker NOT FOUND');

// 3. Update onAddToQueue call to include burnIn
const oldCall = "                  loudnormTarget: youtubeNormalize ? -14 : undefined,\n                });\n              }}\n              type=\"button\"\n              title=\"Add this render configuration to the render queue\"\n            >\n              + Add to Queue";
const newCall = "                  loudnormTarget: youtubeNormalize ? -14 : undefined,\n                  burnIn: (burnInTimecode || !!watermarkText.trim()) ? { timecode: burnInTimecode, watermarkText: watermarkText.trim() || undefined } : undefined,\n                });\n              }}\n              type=\"button\"\n              title=\"Add this render configuration to the render queue\"\n            >\n              + Add to Queue";
if (content.includes(oldCall)) { content = content.replace(oldCall, newCall); console.log('onAddToQueue call updated'); } else console.log('onAddToQueue call NOT FOUND');

writeFileSync('src/renderer/components/InspectorPanel.tsx', content);
console.log('Done');
