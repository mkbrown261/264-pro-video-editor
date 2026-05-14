with open('src/renderer/components/InspectorPanel.tsx', 'r') as f:
    content = f.read()

old_state = "  const [youtubeNormalize, setYoutubeNormalize] = useState(true); // default on — -14 LUFS"
new_state = "  const [youtubeNormalize, setYoutubeNormalize] = useState(true); // default on — -14 LUFS\n  const [burnInTimecode, setBurnInTimecode]     = useState(false);\n  const [watermarkText, setWatermarkText]       = useState(\"\");"

if old_state in content:
    content = content.replace(old_state, new_state, 1)
    print("State vars added")
else:
    print("State var not found")

old_btn = "              + Add to Queue\n            </button>\n          </>"
new_btn = """              + Add to Queue
            </button>
          </>"""

# Find the Add to Queue button block and replace with expanded version
import re

# Add burn-in UI between the LUFS label and the Add to Queue button
marker = '              />\n              \U0001f3a7 YouTube Normalize (-14 LUFS)\n            </label>\n            <button'
replacement = '''              />
              \U0001f3a7 YouTube Normalize (-14 LUFS)
            </label>
            <label
              style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontSize: 11, color: "var(--text-s)", cursor: "pointer", userSelect: "none" }}
              title="Burn timecode into the exported video."
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
            <button'''

if marker in content:
    content = content.replace(marker, replacement, 1)
    print("Burn-in UI inserted")
else:
    print("Marker not found")

# Now update the onAddToQueue call to include burnIn
old_call = """                  loudnormTarget: youtubeNormalize ? -14 : undefined,
                });
              }}
              type="button"
              title="Add this render configuration to the render queue"
            >
              + Add to Queue"""
new_call = """                  loudnormTarget: youtubeNormalize ? -14 : undefined,
                  burnIn: (burnInTimecode || !!watermarkText.trim()) ? { timecode: burnInTimecode, watermarkText: watermarkText.trim() || undefined } : undefined,
                });
              }}
              type="button"
              title="Add this render configuration to the render queue"
            >
              + Add to Queue"""

if old_call in content:
    content = content.replace(old_call, new_call, 1)
    print("onAddToQueue call updated with burnIn")
else:
    print("onAddToQueue call not found")

with open('src/renderer/components/InspectorPanel.tsx', 'w') as f:
    f.write(content)
print("Done")
