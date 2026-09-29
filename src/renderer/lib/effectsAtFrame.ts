import type { ClipEffect } from "../../shared/models";
import { interpolateKeyframes, type CurveKeyframe } from "../components/KeyframeCurveEditor";

/** Resolve animated effect parameters for a clip at a timeline frame. */
export function effectsAtFrame(effects: ClipEffect[] | undefined, frame: number): ClipEffect[] {
  if (!effects?.length) return [];
  return effects.map((ef) => {
    if (!ef.enabled || !ef.keyframes || Object.keys(ef.keyframes).length === 0) return ef;
    const params = { ...ef.params };
    for (const [key, kfArr] of Object.entries(ef.keyframes)) {
      if (!kfArr || kfArr.length === 0) continue;
      const vals = (kfArr as CurveKeyframe[]).map((k) => k.value);
      params[key] = interpolateKeyframes(kfArr as CurveKeyframe[], frame, Math.min(...vals), Math.max(...vals));
    }
    return { ...ef, params };
  });
}
