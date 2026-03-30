import { create } from "zustand";
import {
  type ClipTransitionType,
  createEmptyProject,
  createId,
  type EditorTool,
  type EnvironmentStatus,
  type MediaAsset,
  type TimelineClip,
  type TimelineTrackKind
} from "../../shared/models";
import {
  buildTimelineSegments,
  clampTrimEnd,
  clampTrimStart,
  findPlayableSegmentAtFrame,
  findSegmentAtFrame,
  getClipDurationFrames,
  getClipTransitionDurationFrames,
  getTotalDurationFrames,
  getTrackEndFrame,
  normalizeTimelineFps
} from "../../shared/timeline";

type EditorProjectState = ReturnType<typeof createEmptyProject>;

interface EditorStore {
  project: EditorProjectState;
  selectedAssetId: string | null;
  selectedClipId: string | null;
  toolMode: EditorTool;
  environment: EnvironmentStatus | null;
  playback: {
    isPlaying: boolean;
    playheadFrame: number;
  };
  importAssets: (assets: MediaAsset[]) => void;
  appendAssetToTimeline: (assetId: string) => void;
  selectAsset: (assetId: string | null) => void;
  selectClip: (clipId: string | null) => void;
  moveClip: (clipId: string, direction: -1 | 1) => void;
  moveClipTo: (clipId: string, trackId: string, startFrame: number) => void;
  trimClipStart: (clipId: string, nextTrimStartFrames: number) => void;
  trimClipEnd: (clipId: string, nextTrimEndFrames: number) => void;
  splitSelectedClipAtPlayhead: () => void;
  splitClipAtFrame: (clipId: string, frame: number) => void;
  removeSelectedClip: () => void;
  toggleClipEnabled: (clipId: string) => void;
  detachLinkedClips: (clipId: string) => void;
  applyTransitionToSelectedClip: (
    edge: "in" | "out",
    type?: ClipTransitionType
  ) => string | null;
  setSelectedClipTransitionType: (
    edge: "in" | "out",
    type: ClipTransitionType
  ) => string | null;
  setSelectedClipTransitionDuration: (
    edge: "in" | "out",
    durationFrames: number
  ) => string | null;
  extractAudioFromSelectedClip: () => string | null;
  setPlayheadFrame: (playheadFrame: number) => void;
  nudgePlayhead: (deltaFrames: number) => void;
  setPlaybackPlaying: (isPlaying: boolean) => void;
  stopPlayback: () => void;
  setToolMode: (toolMode: EditorTool) => void;
  toggleBladeTool: () => void;
  setEnvironment: (environment: EnvironmentStatus) => void;
}

function createClip(
  assetId: string,
  trackId: string,
  startFrame: number,
  options: {
    linkedGroupId?: string | null;
    isEnabled?: boolean;
  } = {}
): TimelineClip {
  return {
    id: createId(),
    assetId,
    trackId,
    startFrame,
    trimStartFrames: 0,
    trimEndFrames: 0,
    linkedGroupId: options.linkedGroupId ?? null,
    isEnabled: options.isEnabled ?? true,
    transitionIn: null,
    transitionOut: null
  };
}

function withAssetSequenceDefaults(
  project: EditorProjectState,
  asset: MediaAsset
): EditorProjectState {
  if (project.sequence.clips.length > 0) {
    return project;
  }

  return {
    ...project,
    sequence: {
      ...project.sequence,
      settings: {
        ...project.sequence.settings,
        width: asset.width || project.sequence.settings.width,
        height: asset.height || project.sequence.settings.height,
        fps: normalizeTimelineFps(asset.nativeFps || project.sequence.settings.fps)
      }
    }
  };
}

function getPrimaryTrackId(
  project: EditorProjectState,
  kind: TimelineTrackKind
): string | null {
  return project.sequence.tracks.find((track) => track.kind === kind)?.id ?? null;
}

function clampPlayhead(project: EditorProjectState, frame: number): number {
  const totalFrames = getTotalDurationFrames(
    buildTimelineSegments(project.sequence, project.assets)
  );

  if (totalFrames <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(Math.round(frame), totalFrames - 1));
}

function resolveTrackLayout(
  project: EditorProjectState,
  trackId: string
): EditorProjectState {
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const sequenceFps = project.sequence.settings.fps;
  const orderedTrackClips = project.sequence.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((left, right) => {
      if (left.startFrame !== right.startFrame) {
        return left.startFrame - right.startFrame;
      }

      return project.sequence.clips.findIndex((clip) => clip.id === left.id) -
        project.sequence.clips.findIndex((clip) => clip.id === right.id);
    });

  let cursorFrame = 0;
  const resolvedClips = new Map<string, TimelineClip>();

  for (const clip of orderedTrackClips) {
    const asset = assetsById.get(clip.assetId);

    if (!asset) {
      resolvedClips.set(clip.id, clip);
      continue;
    }

    const durationFrames = getClipDurationFrames(clip, asset, sequenceFps);
    const startFrame = Math.max(cursorFrame, Math.max(0, clip.startFrame));

    resolvedClips.set(clip.id, {
      ...clip,
      startFrame
    });
    cursorFrame = startFrame + durationFrames;
  }

  return {
    ...project,
    sequence: {
      ...project.sequence,
      clips: project.sequence.clips.map((clip) => resolvedClips.get(clip.id) ?? clip)
    }
  };
}

function resolveTracks(
  project: EditorProjectState,
  trackIds: string[]
): EditorProjectState {
  const uniqueTrackIds = Array.from(new Set(trackIds));

  return uniqueTrackIds.reduce(
    (currentProject, trackId) => resolveTrackLayout(currentProject, trackId),
    project
  );
}

function getLinkedClips(
  project: EditorProjectState,
  clipId: string
): TimelineClip[] {
  const clip = project.sequence.clips.find((candidate) => candidate.id === clipId);

  if (!clip) {
    return [];
  }

  if (!clip.linkedGroupId) {
    return [clip];
  }

  return project.sequence.clips.filter(
    (candidate) => candidate.linkedGroupId === clip.linkedGroupId
  );
}

function getTransitionTargetClip(
  project: EditorProjectState,
  clipId: string
): TimelineClip | null {
  const clip = project.sequence.clips.find((candidate) => candidate.id === clipId);

  if (!clip) {
    return null;
  }

  const track = project.sequence.tracks.find(
    (candidate) => candidate.id === clip.trackId
  );

  if (track?.kind === "video") {
    return clip;
  }

  return getLinkedClips(project, clipId).find((candidate) => {
    const linkedTrack = project.sequence.tracks.find(
      (trackCandidate) => trackCandidate.id === candidate.trackId
    );

    return linkedTrack?.kind === "video";
  }) ?? null;
}

function findIndependentAudioCompanion(
  project: EditorProjectState,
  clip: TimelineClip
): TimelineClip | null {
  return (
    project.sequence.clips.find((candidate) => {
      if (candidate.id === clip.id || candidate.assetId !== clip.assetId) {
        return false;
      }

      const track = project.sequence.tracks.find(
        (trackCandidate) => trackCandidate.id === candidate.trackId
      );

      return (
        track?.kind === "audio" &&
        candidate.linkedGroupId === null &&
        candidate.startFrame === clip.startFrame &&
        candidate.trimStartFrames === clip.trimStartFrames &&
        candidate.trimEndFrames === clip.trimEndFrames
      );
    }) ?? null
  );
}

function createTimelineClipsForAsset(
  project: EditorProjectState,
  asset: MediaAsset,
  startFrame: number
): {
  clips: TimelineClip[];
  selectedClipId: string;
} {
  const videoTrackId = getPrimaryTrackId(project, "video");

  if (!videoTrackId) {
    throw new Error("No video track is available.");
  }

  const audioTrackId = asset.hasAudio
    ? getPrimaryTrackId(project, "audio")
    : null;
  const linkedGroupId = audioTrackId ? createId() : null;
  const videoClip = createClip(asset.id, videoTrackId, startFrame, {
    linkedGroupId
  });
  const clips = [videoClip];

  if (audioTrackId) {
    clips.push(
      createClip(asset.id, audioTrackId, startFrame, {
        linkedGroupId
      })
    );
  }

  return {
    clips,
    selectedClipId: videoClip.id
  };
}

function applyClipMutation(
  state: EditorStore,
  clipId: string,
  mutate: (
    clip: TimelineClip,
    asset: MediaAsset
  ) => TimelineClip
): Partial<EditorStore> | EditorStore {
  const linkedClips = getLinkedClips(state.project, clipId);

  if (!linkedClips.length) {
    return state;
  }

  const assetsById = new Map(
    state.project.assets.map((asset) => [asset.id, asset])
  );
  const linkedClipIds = new Set(linkedClips.map((clip) => clip.id));
  const affectedTrackIds = linkedClips.map((clip) => clip.trackId);
  const nextProject = resolveTracks(
    {
      ...state.project,
      sequence: {
        ...state.project.sequence,
        clips: state.project.sequence.clips.map((candidate) => {
          if (!linkedClipIds.has(candidate.id)) {
            return candidate;
          }

          const asset = assetsById.get(candidate.assetId);

          return asset ? mutate(candidate, asset) : candidate;
        })
      }
    },
    affectedTrackIds
  );

  return {
    project: nextProject,
    playback: {
      ...state.playback,
      playheadFrame: clampPlayhead(nextProject, state.playback.playheadFrame)
    }
  };
}

function splitStateAtFrame(
  state: EditorStore,
  clipId: string,
  frame: number
): Partial<EditorStore> | EditorStore {
  const linkedClips = getLinkedClips(state.project, clipId);

  if (!linkedClips.length) {
    return state;
  }

  const linkedClipIds = new Set(linkedClips.map((clip) => clip.id));
  const segmentsById = new Map(
    buildTimelineSegments(state.project.sequence, state.project.assets).map((segment) => [
      segment.clip.id,
      segment
    ])
  );
  const shouldRelinkSplitGroup =
    Boolean(linkedClips[0]?.linkedGroupId) && linkedClips.length > 1;
  const leftGroupId = shouldRelinkSplitGroup ? createId() : linkedClips[0]?.linkedGroupId ?? null;
  const rightGroupId = shouldRelinkSplitGroup ? createId() : linkedClips[0]?.linkedGroupId ?? null;
  let splitOccurred = false;

  const nextSequence = {
    ...state.project.sequence,
    clips: state.project.sequence.clips.flatMap((clip) => {
      if (!linkedClipIds.has(clip.id)) {
        return [clip];
      }

      const segment = segmentsById.get(clip.id);

      if (!segment || frame <= segment.startFrame || frame >= segment.endFrame) {
        return [clip];
      }

      const splitOffsetFrames = frame - segment.startFrame;
      const leftDurationFrames = splitOffsetFrames;
      const rightDurationFrames = segment.durationFrames - splitOffsetFrames;

      if (leftDurationFrames <= 0 || rightDurationFrames <= 0) {
        return [clip];
      }

      splitOccurred = true;

      const leftClip: TimelineClip = {
        ...clip,
        trimEndFrames: clip.trimEndFrames + rightDurationFrames,
        linkedGroupId: leftGroupId,
        transitionOut: null
      };
      const rightClip: TimelineClip = {
        ...clip,
        id: createId(),
        startFrame: frame,
        trimStartFrames: clip.trimStartFrames + leftDurationFrames,
        linkedGroupId: rightGroupId,
        transitionIn: null
      };

      return [leftClip, rightClip];
    })
  };

  if (!splitOccurred) {
    return state;
  }

  const nextProject = {
    ...state.project,
    sequence: nextSequence
  };
  const nextSegments = buildTimelineSegments(nextSequence, state.project.assets);
  const activeSegment =
    findPlayableSegmentAtFrame(nextSegments, frame, "video") ??
    findSegmentAtFrame(nextSegments, frame);

  return {
    project: nextProject,
    selectedClipId: activeSegment?.clip.id ?? state.selectedClipId,
    selectedAssetId: activeSegment?.asset.id ?? state.selectedAssetId,
    playback: {
      ...state.playback,
      playheadFrame: clampPlayhead(nextProject, frame)
    }
  };
}

export const useEditorStore = create<EditorStore>((set) => ({
  project: createEmptyProject(),
  selectedAssetId: null,
  selectedClipId: null,
  toolMode: "select",
  environment: null,
  playback: {
    isPlaying: false,
    playheadFrame: 0
  },
  importAssets: (assets) => {
    if (!assets.length) {
      return;
    }

    set((state) => {
      const existingAssetsByPath = new Map(
        state.project.assets.map((asset) => [asset.sourcePath, asset])
      );
      const importedAssets = assets.map((asset) => {
        const existingAsset = existingAssetsByPath.get(asset.sourcePath);

        if (!existingAsset) {
          return asset;
        }

        return {
          ...asset,
          id: existingAsset.id
        };
      });
      const importedAssetsByPath = new Map(
        importedAssets.map((asset) => [asset.sourcePath, asset])
      );
      const mergedAssets = [
        ...state.project.assets.map(
          (asset) => importedAssetsByPath.get(asset.sourcePath) ?? asset
        ),
        ...importedAssets.filter(
          (asset) => !existingAssetsByPath.has(asset.sourcePath)
        )
      ];

      if (!mergedAssets.length) {
        return state;
      }

      let nextProject: EditorProjectState = {
        ...state.project,
        assets: mergedAssets
      };
      let selectedAssetId = state.selectedAssetId ?? importedAssets[0]?.id ?? null;
      let selectedClipId = state.selectedClipId;

      if (!nextProject.sequence.clips.length) {
        const firstAsset = importedAssets[0];
        nextProject = withAssetSequenceDefaults(nextProject, firstAsset);
        const { clips, selectedClipId: nextSelectedClipId } =
          createTimelineClipsForAsset(nextProject, firstAsset, 0);
        nextProject = {
          ...nextProject,
          sequence: {
            ...nextProject.sequence,
            clips
          }
        };
        selectedAssetId = firstAsset.id;
        selectedClipId = nextSelectedClipId;
      } else if (!selectedAssetId && importedAssets[0]) {
        selectedAssetId = importedAssets[0].id;
      }

      return {
        project: nextProject,
        selectedAssetId,
        selectedClipId
      };
    });
  },
  appendAssetToTimeline: (assetId) => {
    set((state) => {
      const asset = state.project.assets.find((candidate) => candidate.id === assetId);

      if (!asset) {
        return state;
      }

      let nextProject = withAssetSequenceDefaults(state.project, asset);
      const primaryTrackId = getPrimaryTrackId(nextProject, "video");

      if (!primaryTrackId) {
        return state;
      }

      const currentSegments = buildTimelineSegments(
        nextProject.sequence,
        nextProject.assets
      );
      const { clips, selectedClipId } = createTimelineClipsForAsset(
        nextProject,
        asset,
        getTrackEndFrame(primaryTrackId, currentSegments)
      );
      nextProject = {
        ...nextProject,
        sequence: {
          ...nextProject.sequence,
          clips: [...nextProject.sequence.clips, ...clips]
        }
      };

      return {
        project: nextProject,
        selectedAssetId: assetId,
        selectedClipId,
        playback: {
          isPlaying: false,
          playheadFrame: clampPlayhead(nextProject, clips[0].startFrame)
        }
      };
    });
  },
  selectAsset: (assetId) => {
    set({
      selectedAssetId: assetId
    });
  },
  selectClip: (clipId) => {
    set((state) => {
      if (!clipId) {
        return {
          selectedClipId: null
        };
      }

      const clip = state.project.sequence.clips.find(
        (candidate) => candidate.id === clipId
      );

      if (!clip) {
        return state;
      }

      return {
        selectedClipId: clipId,
        selectedAssetId: clip.assetId
      };
    });
  },
  moveClip: (clipId, direction) => {
    set((state) => {
      const linkedClips = getLinkedClips(state.project, clipId);

      if (!linkedClips.length) {
        return state;
      }

      const deltaFrames = state.project.sequence.settings.fps * direction;

      return applyClipMutation(state, clipId, (clip) => ({
        ...clip,
        startFrame: Math.max(0, clip.startFrame + deltaFrames)
      }));
    });
  },
  moveClipTo: (clipId, trackId, startFrame) => {
    set((state) => {
      const clip = state.project.sequence.clips.find(
        (candidate) => candidate.id === clipId
      );

      if (!clip) {
        return state;
      }

      const linkedClips = getLinkedClips(state.project, clipId);
      const deltaFrames = Math.max(0, startFrame) - clip.startFrame;
      const linkedClipIds = new Set(linkedClips.map((candidate) => candidate.id));
      const affectedTrackIds = [
        ...linkedClips.map((candidate) => candidate.trackId),
        trackId
      ];
      const nextProject = resolveTracks(
        {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips.map((candidate) => {
              if (!linkedClipIds.has(candidate.id)) {
                return candidate;
              }

              if (candidate.id === clipId) {
                return {
                  ...candidate,
                  trackId,
                  startFrame: Math.max(0, startFrame)
                };
              }

              return {
                ...candidate,
                startFrame: Math.max(0, candidate.startFrame + deltaFrames)
              };
            })
          }
        },
        affectedTrackIds
      );

      return {
        project: nextProject,
        selectedClipId: clipId,
        selectedAssetId: clip.assetId,
        playback: {
          ...state.playback,
          playheadFrame: clampPlayhead(nextProject, state.playback.playheadFrame)
        }
      };
    });
  },
  trimClipStart: (clipId, nextTrimStartFrames) => {
    set((state) => {
      const selectedClip = state.project.sequence.clips.find(
        (candidate) => candidate.id === clipId
      );

      if (!selectedClip) {
        return state;
      }

      const selectedAsset = state.project.assets.find(
        (candidate) => candidate.id === selectedClip.assetId
      );

      if (!selectedAsset) {
        return state;
      }

      const nextSelectedTrimStartFrames = clampTrimStart(
        selectedClip,
        selectedAsset,
        state.project.sequence.settings.fps,
        nextTrimStartFrames
      );
      const trimDeltaFrames =
        nextSelectedTrimStartFrames - selectedClip.trimStartFrames;

      return applyClipMutation(state, clipId, (clip, asset) => {
        const nextClipTrimStartFrames = clampTrimStart(
          clip,
          asset,
          state.project.sequence.settings.fps,
          clip.trimStartFrames + trimDeltaFrames
        );
        const nextTrimDeltaFrames =
          nextClipTrimStartFrames - clip.trimStartFrames;

        return {
          ...clip,
          startFrame: Math.max(0, clip.startFrame + nextTrimDeltaFrames),
          trimStartFrames: nextClipTrimStartFrames
        };
      });
    });
  },
  trimClipEnd: (clipId, nextTrimEndFrames) => {
    set((state) => {
      const selectedClip = state.project.sequence.clips.find(
        (candidate) => candidate.id === clipId
      );

      if (!selectedClip) {
        return state;
      }

      const selectedAsset = state.project.assets.find(
        (candidate) => candidate.id === selectedClip.assetId
      );

      if (!selectedAsset) {
        return state;
      }

      const nextSelectedTrimEndFrames = clampTrimEnd(
        selectedClip,
        selectedAsset,
        state.project.sequence.settings.fps,
        nextTrimEndFrames
      );
      const trimDeltaFrames =
        nextSelectedTrimEndFrames - selectedClip.trimEndFrames;

      return applyClipMutation(state, clipId, (clip, asset) => ({
        ...clip,
        trimEndFrames: clampTrimEnd(
          clip,
          asset,
          state.project.sequence.settings.fps,
          clip.trimEndFrames + trimDeltaFrames
        )
      }));
    });
  },
  splitSelectedClipAtPlayhead: () => {
    set((state) => {
      if (!state.selectedClipId) {
        return state;
      }

      return splitStateAtFrame(
        state,
        state.selectedClipId,
        state.playback.playheadFrame
      );
    });
  },
  splitClipAtFrame: (clipId, frame) => {
    set((state) => splitStateAtFrame(state, clipId, frame));
  },
  removeSelectedClip: () => {
    set((state) => {
      if (!state.selectedClipId) {
        return state;
      }

      const linkedClips = getLinkedClips(state.project, state.selectedClipId);

      if (!linkedClips.length) {
        return state;
      }

      const currentSegments = buildTimelineSegments(
        state.project.sequence,
        state.project.assets
      );
      const segmentsById = new Map(
        currentSegments.map((segment) => [segment.clip.id, segment])
      );
      const linkedClipIds = new Set(linkedClips.map((clip) => clip.id));
      const affectedTrackIds = linkedClips.map((clip) => clip.trackId);
      const removedSegmentsByTrack = new Map<
        string,
        Array<{ durationFrames: number; startFrame: number }>
      >();

      for (const clip of linkedClips) {
        const segment = segmentsById.get(clip.id);

        if (!segment) {
          continue;
        }

        const removedSegments = removedSegmentsByTrack.get(clip.trackId) ?? [];

        removedSegments.push({
          durationFrames: segment.durationFrames,
          startFrame: segment.startFrame
        });
        removedSegmentsByTrack.set(clip.trackId, removedSegments);
      }

      const nextProject = resolveTracks(
        {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips
              .filter((candidate) => !linkedClipIds.has(candidate.id))
              .map((candidate) => {
                const removedSegments = removedSegmentsByTrack.get(candidate.trackId);

                if (!removedSegments?.length) {
                  return candidate;
                }

                const rippleFrames = removedSegments.reduce((totalFrames, removedSegment) => {
                  return removedSegment.startFrame < candidate.startFrame
                    ? totalFrames + removedSegment.durationFrames
                    : totalFrames;
                }, 0);

                if (rippleFrames <= 0) {
                  return candidate;
                }

                return {
                  ...candidate,
                  startFrame: Math.max(0, candidate.startFrame - rippleFrames)
                };
              })
          }
        },
        affectedTrackIds
      );
      const nextSegments = buildTimelineSegments(
        nextProject.sequence,
        nextProject.assets
      );
      const fallbackSegment =
        findPlayableSegmentAtFrame(
          nextSegments,
          state.playback.playheadFrame,
          "video"
        ) ??
        nextSegments[0] ??
        null;

      return {
        project: nextProject,
        selectedClipId: fallbackSegment?.clip.id ?? null,
        selectedAssetId: fallbackSegment?.asset.id ?? state.selectedAssetId,
        playback: {
          isPlaying: nextSegments.length ? state.playback.isPlaying : false,
          playheadFrame: clampPlayhead(nextProject, state.playback.playheadFrame)
        }
      };
    });
  },
  toggleClipEnabled: (clipId) => {
    set((state) => {
      const clip = state.project.sequence.clips.find(
        (candidate) => candidate.id === clipId
      );

      if (!clip) {
        return state;
      }

      const nextIsEnabled = !clip.isEnabled;

      return applyClipMutation(state, clipId, (candidate) => ({
        ...candidate,
        isEnabled: nextIsEnabled
      }));
    });
  },
  detachLinkedClips: (clipId) => {
    set((state) => {
      const clip = state.project.sequence.clips.find(
        (candidate) => candidate.id === clipId
      );

      if (!clip?.linkedGroupId) {
        return state;
      }

      return {
        project: {
          ...state.project,
          sequence: {
            ...state.project.sequence,
            clips: state.project.sequence.clips.map((candidate) =>
              candidate.linkedGroupId === clip.linkedGroupId
                ? {
                    ...candidate,
                    linkedGroupId: null
                  }
                : candidate
            )
          }
        }
      };
    });
  },
  setSelectedClipTransitionType: (edge, type) => {
    const state = useEditorStore.getState();

    if (!state.selectedClipId) {
      return "Select a timeline clip before choosing a transition.";
    }

    const targetClip = getTransitionTargetClip(state.project, state.selectedClipId);

    if (!targetClip) {
      return "Transitions currently apply to video timeline clips.";
    }

    const asset = state.project.assets.find(
      (candidate) => candidate.id === targetClip.assetId
    );

    if (!asset) {
      return "The selected clip is missing its source media.";
    }

    const clipDurationFrames = getClipDurationFrames(
      targetClip,
      asset,
      state.project.sequence.settings.fps
    );
    const currentTransition =
      edge === "in" ? targetClip.transitionIn : targetClip.transitionOut;
    const nextDurationFrames = getClipTransitionDurationFrames(
      {
        type,
        durationFrames:
          currentTransition?.durationFrames ??
          Math.max(6, Math.round(state.project.sequence.settings.fps * 0.5))
      },
      clipDurationFrames
    );

    if (nextDurationFrames < 1) {
      return "The selected clip is too short for that transition.";
    }

    set((currentState) => {
      const selectedId = currentState.selectedClipId;

      if (!selectedId) {
        return currentState;
      }

      const currentTargetClip = getTransitionTargetClip(
        currentState.project,
        selectedId
      );

      if (!currentTargetClip) {
        return currentState;
      }

      return {
        project: {
          ...currentState.project,
          sequence: {
            ...currentState.project.sequence,
            clips: currentState.project.sequence.clips.map((candidate) => {
              if (candidate.id !== currentTargetClip.id) {
                return candidate;
              }

              return edge === "in"
                ? {
                    ...candidate,
                    transitionIn: {
                      type,
                      durationFrames: nextDurationFrames
                    }
                  }
                : {
                    ...candidate,
                    transitionOut: {
                      type,
                      durationFrames: nextDurationFrames
                    }
                  };
            })
          }
        },
        selectedClipId: currentTargetClip.id,
        selectedAssetId: currentTargetClip.assetId
      };
    });

    return `${type} ${edge === "in" ? "intro" : "outro"} transition updated.`;
  },
  setSelectedClipTransitionDuration: (edge, durationFrames) => {
    const state = useEditorStore.getState();

    if (!state.selectedClipId) {
      return "Select a timeline clip before editing fades.";
    }

    const targetClip = getTransitionTargetClip(state.project, state.selectedClipId);

    if (!targetClip) {
      return "Fade controls currently apply to video timeline clips.";
    }

    const asset = state.project.assets.find(
      (candidate) => candidate.id === targetClip.assetId
    );

    if (!asset) {
      return "The selected clip is missing its source media.";
    }

    const clipDurationFrames = getClipDurationFrames(
      targetClip,
      asset,
      state.project.sequence.settings.fps
    );
    const nextDurationFrames = getClipTransitionDurationFrames(
      durationFrames > 0
        ? {
            type: "fade",
            durationFrames
          }
        : null,
      clipDurationFrames
    );

    set((currentState) => {
      const selectedId = currentState.selectedClipId;

      if (!selectedId) {
        return currentState;
      }

      const currentTargetClip = getTransitionTargetClip(
        currentState.project,
        selectedId
      );

      if (!currentTargetClip) {
        return currentState;
      }

      return {
        project: {
          ...currentState.project,
          sequence: {
            ...currentState.project.sequence,
            clips: currentState.project.sequence.clips.map((candidate) => {
              if (candidate.id !== currentTargetClip.id) {
                return candidate;
              }

              return edge === "in"
                ? {
                    ...candidate,
                    transitionIn:
                      nextDurationFrames > 0
                        ? {
                            type: "fade",
                            durationFrames: nextDurationFrames
                          }
                        : null
                  }
                : {
                    ...candidate,
                    transitionOut:
                      nextDurationFrames > 0
                        ? {
                            type: "fade",
                            durationFrames: nextDurationFrames
                          }
                        : null
                  };
            })
          }
        },
        selectedClipId: currentTargetClip.id,
        selectedAssetId: currentTargetClip.assetId
      };
    });

    return nextDurationFrames > 0
      ? `${edge === "in" ? "Fade in" : "Fade out"} updated.`
      : `${edge === "in" ? "Fade in" : "Fade out"} cleared.`;
  },
  extractAudioFromSelectedClip: () => {
    const state = useEditorStore.getState();

    if (!state.selectedClipId) {
      return "Select a timeline clip before extracting audio.";
    }

    const targetClip = getTransitionTargetClip(state.project, state.selectedClipId);

    if (!targetClip) {
      return "Select a video clip to extract audio.";
    }

    const asset = state.project.assets.find(
      (candidate) => candidate.id === targetClip.assetId
    );

    if (!asset?.hasAudio) {
      return "This source clip does not contain embedded audio.";
    }

    const linkedClips = getLinkedClips(state.project, targetClip.id);
    const existingAudioClip = linkedClips.find((candidate) => {
      const track = state.project.sequence.tracks.find(
        (trackCandidate) => trackCandidate.id === candidate.trackId
      );

      return track?.kind === "audio";
    });
    const existingIndependentAudioClip = findIndependentAudioCompanion(
      state.project,
      targetClip
    );

    if (existingAudioClip) {
      if (!targetClip.linkedGroupId && !existingAudioClip.linkedGroupId) {
        return "Audio is already extracted and independent.";
      }

      set((currentState) => {
        const selectedId = currentState.selectedClipId;

        if (!selectedId) {
          return currentState;
        }

        const currentTargetClip = getTransitionTargetClip(
          currentState.project,
          selectedId
        );

        if (!currentTargetClip?.linkedGroupId) {
          return currentState;
        }

        return {
          project: {
            ...currentState.project,
            sequence: {
              ...currentState.project.sequence,
              clips: currentState.project.sequence.clips.map((candidate) =>
                candidate.linkedGroupId === currentTargetClip.linkedGroupId
                  ? {
                      ...candidate,
                      linkedGroupId: null
                    }
                  : candidate
              )
            }
          }
        };
      });

      return "Audio extracted. The audio clip is now independent from the video clip.";
    }

    if (existingIndependentAudioClip) {
      return "Audio is already extracted and available on the audio track.";
    }

    const audioTrackId = getPrimaryTrackId(state.project, "audio");

    if (!audioTrackId) {
      return "No audio track is available in the timeline.";
    }

    set((currentState) => {
      const selectedId = currentState.selectedClipId;

      if (!selectedId) {
        return currentState;
      }

      const currentTargetClip = getTransitionTargetClip(
        currentState.project,
        selectedId
      );

      if (!currentTargetClip) {
        return currentState;
      }

      const audioClip: TimelineClip = {
        id: createId(),
        assetId: currentTargetClip.assetId,
        trackId: audioTrackId,
        startFrame: currentTargetClip.startFrame,
        trimStartFrames: currentTargetClip.trimStartFrames,
        trimEndFrames: currentTargetClip.trimEndFrames,
        linkedGroupId: null,
        isEnabled: currentTargetClip.isEnabled,
        transitionIn: null,
        transitionOut: null
      };
      const nextProject = resolveTracks(
        {
          ...currentState.project,
          sequence: {
            ...currentState.project.sequence,
            clips: [...currentState.project.sequence.clips, audioClip]
          }
        },
        [audioTrackId]
      );

      return {
        project: nextProject
      };
    });

    return "Audio extracted onto the primary audio track.";
  },
  applyTransitionToSelectedClip: (edge, type = "fade") => {
    const state = useEditorStore.getState();

    if (!state.selectedClipId) {
      return "Select a timeline clip before adding a transition.";
    }

    const targetClip = getTransitionTargetClip(state.project, state.selectedClipId);

    if (!targetClip) {
      return "Transitions currently apply to video timeline clips.";
    }

    const asset = state.project.assets.find(
      (candidate) => candidate.id === targetClip.assetId
    );

    if (!asset) {
      return "The selected clip is missing its source media.";
    }

    const durationFrames = getClipDurationFrames(
      targetClip,
      asset,
      state.project.sequence.settings.fps
    );
    const transitionDurationFrames = getClipTransitionDurationFrames(
      {
        type,
        durationFrames: Math.max(
          6,
          Math.round(state.project.sequence.settings.fps * 0.5)
        )
      },
      durationFrames
    );

    if (transitionDurationFrames < 1) {
      return "The selected clip is too short for that transition.";
    }

    set((currentState) => {
      const selectedId = currentState.selectedClipId;

      if (!selectedId) {
        return currentState;
      }

      const currentTargetClip = getTransitionTargetClip(
        currentState.project,
        selectedId
      );

      if (!currentTargetClip) {
        return currentState;
      }

      return {
        project: {
          ...currentState.project,
          sequence: {
            ...currentState.project.sequence,
            clips: currentState.project.sequence.clips.map((candidate) => {
              if (candidate.id !== currentTargetClip.id) {
                return candidate;
              }

              return edge === "in"
                ? {
                    ...candidate,
                    transitionIn: {
                      type,
                      durationFrames: transitionDurationFrames
                    }
                  }
                : {
                    ...candidate,
                    transitionOut: {
                      type,
                      durationFrames: transitionDurationFrames
                    }
                  };
            })
          }
        },
        selectedClipId: currentTargetClip.id,
        selectedAssetId: currentTargetClip.assetId
      };
    });

    return `${type} ${edge === "in" ? "intro" : "outro"} transition added.`;
  },
  setPlayheadFrame: (playheadFrame) => {
    set((state) => {
      const nextFrame = clampPlayhead(state.project, playheadFrame);

      if (nextFrame === state.playback.playheadFrame) {
        return state;
      }

      return {
        playback: {
          ...state.playback,
          playheadFrame: nextFrame
        }
      };
    });
  },
  nudgePlayhead: (deltaFrames) => {
    set((state) => {
      const nextFrame = clampPlayhead(
        state.project,
        state.playback.playheadFrame + deltaFrames
      );

      if (nextFrame === state.playback.playheadFrame) {
        return state;
      }

      return {
        playback: {
          ...state.playback,
          playheadFrame: nextFrame
        }
      };
    });
  },
  setPlaybackPlaying: (isPlaying) => {
    set((state) => {
      if (state.playback.isPlaying === isPlaying) {
        return state;
      }

      return {
        playback: {
          ...state.playback,
          isPlaying
        }
      };
    });
  },
  stopPlayback: () => {
    set((state) => {
      if (!state.playback.isPlaying) {
        return state;
      }

      return {
        playback: {
          ...state.playback,
          isPlaying: false
        }
      };
    });
  },
  setToolMode: (toolMode) => {
    set({
      toolMode
    });
  },
  toggleBladeTool: () => {
    set((state) => ({
      toolMode: state.toolMode === "blade" ? "select" : "blade"
    }));
  },
  setEnvironment: (environment) => {
    set({
      environment
    });
  }
}));
