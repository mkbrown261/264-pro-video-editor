import type { ColorGrade, ClipTransitionType } from '../../shared/models';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditStyleProfile {
  version: number;
  projectCount: number;
  lastUpdated: number;

  // Pacing
  avgCutDurationSeconds: number;
  cutDurationSamples: number[];         // last 100 cuts
  preferredBPMRange: [number, number];

  // Color signature
  avgExposure: number;
  avgContrast: number;
  avgSaturation: number;
  avgTemperature: number;
  dominantLook: 'warm' | 'cool' | 'cinematic' | 'natural' | 'desaturated';
  colorSamples: Array<{ exposure: number; contrast: number; saturation: number; temperature: number }>;

  // Transition preferences
  transitionUsage: Record<string, number>;
  avgTransitionDurationFrames: number;

  // Content patterns
  typicalProjectDurationSeconds: number;
  musicUsageRate: number;   // 0-1
  brollUsageRate: number;

  // Title/text
  titleAtSecond: number;
  commonFontStyle: string;

  // Export history
  projectDurations: number[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KEY = '264pro_style_profile';
const MAX_SAMPLES = 100;
const MAX_COLOR_SAMPLES = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function defaultProfile(): EditStyleProfile {
  return {
    version: 2,
    projectCount: 0,
    lastUpdated: Date.now(),
    avgCutDurationSeconds: 0,
    cutDurationSamples: [],
    preferredBPMRange: [100, 140],
    avgExposure: 0,
    avgContrast: 0,
    avgSaturation: 1,
    avgTemperature: 0,
    dominantLook: 'natural',
    colorSamples: [],
    transitionUsage: {},
    avgTransitionDurationFrames: 0,
    typicalProjectDurationSeconds: 0,
    musicUsageRate: 0,
    brollUsageRate: 0,
    titleAtSecond: 3,
    commonFontStyle: 'bold',
    projectDurations: [],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function loadProfile(): EditStyleProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    return { ...defaultProfile(), ...JSON.parse(raw) };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: EditStyleProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, lastUpdated: Date.now() }));
  } catch {
    // Storage full or unavailable — ignore
  }
}

export function resetProfile(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

/**
 * Called after every splitClipAtFrame action.
 * durationSeconds = the duration of the clip that was just cut.
 */
export function updateFromCut(durationSeconds: number): void {
  if (durationSeconds <= 0) return;
  const p = loadProfile();
  p.cutDurationSamples = [...p.cutDurationSamples, durationSeconds].slice(-MAX_SAMPLES);
  p.avgCutDurationSeconds = avg(p.cutDurationSamples);
  saveProfile(p);
}

/**
 * Called after every onUpdateGrade action.
 */
export function updateFromGrade(colorGrade: Partial<ColorGrade>): void {
  const p = loadProfile();
  const sample = {
    exposure: colorGrade.exposure ?? 0,
    contrast: colorGrade.contrast ?? 0,
    saturation: colorGrade.saturation ?? 1,
    temperature: colorGrade.temperature ?? 0,
  };
  p.colorSamples = [...p.colorSamples, sample].slice(-MAX_COLOR_SAMPLES);
  p.avgExposure = avg(p.colorSamples.map((s) => s.exposure));
  p.avgContrast = avg(p.colorSamples.map((s) => s.contrast));
  p.avgSaturation = avg(p.colorSamples.map((s) => s.saturation));
  p.avgTemperature = avg(p.colorSamples.map((s) => s.temperature));
  p.dominantLook = computeDominantLook(p);
  saveProfile(p);
}

/**
 * Called after every addTransition action.
 */
export function updateFromTransition(type: ClipTransitionType | string): void {
  const p = loadProfile();
  p.transitionUsage[type] = (p.transitionUsage[type] ?? 0) + 1;
  saveProfile(p);
}

/**
 * Called when a render job completes.
 */
export function updateFromExport(durationSeconds: number, hasMusicTrack: boolean): void {
  const p = loadProfile();
  p.projectDurations = [...p.projectDurations, durationSeconds].slice(-50);
  p.typicalProjectDurationSeconds = avg(p.projectDurations);
  p.projectCount += 1;
  // Rolling estimate of music usage rate
  const prevTotal = Math.max(1, p.projectCount - 1);
  p.musicUsageRate = (p.musicUsageRate * prevTotal + (hasMusicTrack ? 1 : 0)) / p.projectCount;
  saveProfile(p);
}

// ── Derived values ────────────────────────────────────────────────────────────

function computeDominantLook(
  p: Pick<EditStyleProfile, 'avgTemperature' | 'avgSaturation' | 'avgContrast' | 'avgExposure'>
): EditStyleProfile['dominantLook'] {
  if (p.avgTemperature > 20) return 'warm';
  if (p.avgTemperature < -20) return 'cool';
  if (p.avgContrast > 0.15 && p.avgSaturation > 1.1) return 'cinematic';
  if (p.avgSaturation < 0.8) return 'desaturated';
  return 'natural';
}

export function getDominantLook(): EditStyleProfile['dominantLook'] {
  return computeDominantLook(loadProfile());
}

/**
 * Returns a suggested ColorGrade based on learned averages.
 * Returns null if we have fewer than 5 samples (not enough data).
 */
export function getSuggestedGrade(): Partial<ColorGrade> | null {
  const p = loadProfile();
  if (p.colorSamples.length < 5) return null;
  return {
    exposure: p.avgExposure,
    contrast: p.avgContrast,
    saturation: p.avgSaturation,
    temperature: p.avgTemperature,
  };
}

/**
 * Returns the most-used transition type, or 'cut' if no data.
 */
export function getDominantTransition(): string {
  const p = loadProfile();
  const entries = Object.entries(p.transitionUsage);
  if (entries.length === 0) return 'cut';
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Returns the top N transitions sorted by usage count.
 */
export function getTopTransitions(n = 3): Array<{ type: string; count: number; pct: number }> {
  const p = loadProfile();
  const entries = Object.entries(p.transitionUsage).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0) || 1;
  return entries.slice(0, n).map(([type, count]) => ({
    type,
    count,
    pct: Math.round((count / total) * 100),
  }));
}
