/**
 * 264 Pro × FlowState — Intent Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * All communication with FlowState is declared here before any action executes.
 * The renderer declares intent. The Electron main process executes.
 * The FlowState API receives intent. Nothing is hardcoded in action handlers.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEV_BYPASS_KEY  = 'DEV-FS264-MKBROWN-2026-BYPASS';
export const FS_BASE_URL     = 'https://flowstate-67g.pages.dev';
export const FS_API          = FS_BASE_URL;
export const DEEP_LINK_SCHEME = '264pro';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FSPremiumTier = 'free' | 'personal_pro' | 'team_starter' | 'team_growth' | 'enterprise';

export interface FSUser {
  userId:  string;
  email:   string;
  name:    string;
  picture: string;
  tier:    FSPremiumTier;
}

export interface FSLinkState {
  linked:    boolean;
  user?:     FSUser;
  token?:    string;
  expiresAt?: number;
}

export interface VideoEditorTierAccess {
  canDownload:            boolean;
  canUseAIPanel:          boolean;
  canSyncNotion:          boolean;
  canUseAllEffects:       boolean;
  canExportProRes:        boolean;
  canUseTeamAssetLibrary: boolean;
  maxExportResolution:    '1080p' | '4K';
  watermarkOnExport:      boolean;
  upgradeUrl:             string;
}

export interface ProjectContextPayload {
  projectName:        string;
  activeTrackCount:   number;
  totalClips:         number;
  assetNames:         string[];
  sequenceDuration:   number;
  fps:                number;
  resolution:         string;
  activeEffects:      string[];
  colorGradeActive:   boolean;
  linkedNotionCardId?: string;
}

export type VideoActivityEventType =
  | 'project_opened'
  | 'export_completed'
  | 'session_started'
  | 'session_ended'
  | 'notion_card_completed';

export interface VideoActivityEvent {
  type:             VideoActivityEventType;
  projectName?:     string;
  clipCount?:       number;
  format?:          string;
  duration?:        number;
  durationMinutes?: number;
  cardId?:          string;
  cardName?:        string;
  timestamp:        number;
}

export interface FSProject {
  id:           string;
  name:         string;
  status:       'draft' | 'in_progress' | 'exported';
  clipCount:    number;
  lastOpened:   number;
  notionCardId?: string;
}

export interface AuthFlowIntent {
  state:       string;
  authUrl:     string;
  scheme:      string;
  expiresAt:   number;
}

export interface ChatIntent {
  message:       string;
  projectContext: ProjectContextPayload;
  linkedDocIds:  string[];
  authHeader:    string;
}

// ── Intent Declarations ───────────────────────────────────────────────────────

/**
 * Declare an auth flow intent — generates state nonce, builds auth URL.
 */
export function declareAuthFlowIntent(state: string): AuthFlowIntent {
  const authUrl = `${FS_API}/api/264pro/auth?state=${encodeURIComponent(state)}&redirect=${DEEP_LINK_SCHEME}://auth`;
  return {
    state,
    authUrl,
    scheme:    DEEP_LINK_SCHEME,
    expiresAt: Date.now() + 600_000, // 10 min
  };
}

/**
 * Declare a dev bypass intent — validates the key locally.
 */
export function declareDevBypassIntent(key: string): { valid: boolean; user?: FSUser } {
  if (key !== DEV_BYPASS_KEY) return { valid: false };
  return {
    valid: true,
    user: {
      userId:  'dev_user_local',
      email:   'dev@flowstate.local',
      name:    'Dev User (Bypass)',
      picture: '',
      tier:    'personal_pro',
    },
  };
}

/**
 * Declare tier access for a given tier.
 */
export function declareFeatureAccessIntent(tier: FSPremiumTier): VideoEditorTierAccess {
  const isPaid       = tier !== 'free';
  const isGrowthPlus = tier === 'team_growth' || tier === 'enterprise';
  const isTeam       = ['team_starter', 'team_growth', 'enterprise'].includes(tier);
  return {
    canDownload:            isPaid,
    canUseAIPanel:          isPaid,
    canSyncNotion:          isPaid,
    canUseAllEffects:       isPaid,
    canExportProRes:        isGrowthPlus,
    canUseTeamAssetLibrary: isTeam,
    maxExportResolution:    isPaid ? '4K' : '1080p',
    watermarkOnExport:      !isPaid,
    upgradeUrl:             `${FS_BASE_URL}/pricing?ref=264pro`,
  };
}

/**
 * Declare project context payload — snapshot of current project state.
 */
export function declareProjectContextIntent(project: {
  name: string;
  sequence: {
    tracks: Array<{ clips: Array<{ effects?: Array<{ type: string }>; colorGrade?: any }> }>;
    settings: { durationFrames: number; fps: number; width: number; height: number };
  };
  assets: Array<{ name: string }>;
  linkedNotionCardId?: string;
}): ProjectContextPayload {
  const allClips = project.sequence.tracks.flatMap(t => t.clips);
  return {
    projectName:        project.name,
    activeTrackCount:   project.sequence.tracks.length,
    totalClips:         allClips.length,
    assetNames:         project.assets.map(a => a.name),
    sequenceDuration:   project.sequence.settings.durationFrames / project.sequence.settings.fps,
    fps:                project.sequence.settings.fps,
    resolution:         `${project.sequence.settings.width}x${project.sequence.settings.height}`,
    activeEffects:      allClips.flatMap(c => (c.effects ?? []).map(e => e.type)),
    colorGradeActive:   allClips.some(c => c.colorGrade !== null && c.colorGrade !== undefined),
    linkedNotionCardId: project.linkedNotionCardId,
  };
}

/**
 * Declare an activity event to send to FlowState.
 */
export function declareActivityEvent(
  event: Omit<VideoActivityEvent, 'timestamp'>,
): VideoActivityEvent {
  return { ...event, timestamp: Date.now() };
}

/**
 * Declare a project sync payload.
 */
export function declareProjectSyncIntent(
  projects: FSProject[],
): { endpoint: string; body: { projects: FSProject[] } } {
  return {
    endpoint: `${FS_API}/api/264pro/sync-projects`,
    body:     { projects },
  };
}

/**
 * Declare a chat intent — builds the request to the FlowState AI endpoint.
 */
export function declareChatIntent(
  message:       string,
  ctx:           ProjectContextPayload,
  token:         string,
  linkedDocIds:  string[] = [],
): ChatIntent {
  return {
    message,
    projectContext: ctx,
    linkedDocIds,
    authHeader: `Bearer ${token}`,
  };
}

// ── API Helpers ────────────────────────────────────────────────────────────────

/**
 * POST to FlowState API with Bearer token.
 */
export async function fsPost<T>(
  endpoint: string,
  body:     object,
  token:    string,
): Promise<T> {
  const res = await fetch(`${FS_API}${endpoint}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FlowState API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * GET from FlowState API with Bearer token.
 */
export async function fsGet<T>(endpoint: string, token: string): Promise<T> {
  const res = await fetch(`${FS_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`FlowState API ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Verify a link token against FlowState — called on every app launch.
 */
export async function verifyLinkToken(token: string): Promise<{
  valid: boolean;
  user?: { name: string; email: string; picture: string };
  tier?: FSPremiumTier;
}> {
  try {
    const res = await fetch(`${FS_API}/api/264pro/verify-token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
    return res.json();
  } catch {
    return { valid: false };
  }
}

/**
 * Send context snapshot to FlowState KV.
 */
export async function syncContext(ctx: ProjectContextPayload, token: string): Promise<void> {
  try {
    await fsPost('/api/264pro/context-sync', ctx, token);
  } catch { /* non-fatal */ }
}

/**
 * Send activity event to FlowState.
 */
export async function sendActivity(event: VideoActivityEvent, token: string): Promise<void> {
  try {
    await fsPost('/api/264pro/activity', event, token);
  } catch { /* non-fatal */ }
}

/**
 * Sync recent projects to FlowState KV.
 */
export async function syncProjects(projects: FSProject[], token: string): Promise<void> {
  try {
    await fsPost('/api/264pro/sync-projects', { projects }, token);
  } catch { /* non-fatal */ }
}

/**
 * Send a chat message to FlowState AI with project context.
 */
export async function sendChatMessage(
  message:  string,
  ctx:      ProjectContextPayload,
  token:    string,
  docIds:   string[] = [],
): Promise<{ reply: string; model: string }> {
  return fsPost('/api/264pro/ai-chat', { message, projectContext: ctx, linkedDocIds: docIds }, token);
}
