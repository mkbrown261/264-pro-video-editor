import { readFileSync, writeFileSync } from 'fs';

let c = readFileSync('electron/main.ts', 'utf8');

const marker = '// \u2500\u2500 Kill active FFmpeg processes on quit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\napp.on("will-quit", () => {';

const voiceIsolate = `// \u2500\u2500 AI: Voice Isolation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ipcMain.handle('ai:voice-isolate', async (_ev, args: { inputPath: string; outputPath: string }) => {
  try {
    const { inputPath, outputPath } = args || {} as { inputPath: string; outputPath: string };
    if (!inputPath || !outputPath) return { success: false, error: 'Missing paths' };
    if (!inputPath.startsWith('/') && !(/^[A-Za-z]:[/\\\\]/).test(inputPath)) {
      return { success: false, error: 'Invalid input path' };
    }
    const { spawn } = await import('child_process');
    const ffmpeg = getEnvironmentStatus().ffmpegPath;
    if (!ffmpeg) return { success: false, error: 'FFmpeg not available' };
    return await new Promise((resolve) => {
      // anlmdn = FFmpeg built-in Non-Local Means Denoising, no external model needed
      const proc = spawn(ffmpeg, [
        '-i', inputPath,
        '-af', 'anlmdn=s=7:p=0.002:r=0.002:m=15',
        '-y', outputPath,
      ]);
      proc.on('close', (code) => resolve({ success: code === 0, outputPath }));
      proc.on('error', (e: Error) => resolve({ success: false, error: e.message }));
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

`;

if (c.includes(marker)) {
  c = c.replace(marker, voiceIsolate + marker);
  writeFileSync('electron/main.ts', c);
  console.log('Voice isolation handler injected');
} else {
  console.log('Marker not found — searching for actual text');
  const idx = c.indexOf('Kill active FFmpeg');
  console.log('Found at index:', idx, repr(c.slice(Math.max(0,idx-5), idx+60)));
}
