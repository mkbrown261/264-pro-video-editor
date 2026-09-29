import { describe, it, expect } from "vitest";
import type { MediaAsset } from "../shared/models";
import { assetKind, matchesSmartBin } from "../shared/mediaKinds";

const a = (p: Partial<MediaAsset>): MediaAsset => ({ id: "x", name: "clip.mp4", sourcePath: "/m/clip.mp4", previewUrl: "", thumbnailUrl: null, durationSeconds: 10, nativeFps: 30, width: 1920, height: 1080, hasAudio: true, ...p });

describe("assetKind", () => {
  it("classifies video, audio-only and stills", () => {
    expect(assetKind(a({}))).toBe("video");
    expect(assetKind(a({ width: 0, height: 0, sourcePath: "/m/song.mp3" }))).toBe("audio");
    expect(assetKind(a({ sourcePath: "/m/still.png", hasAudio: false }))).toBe("image");
  });
});

describe("matchesSmartBin", () => {
  it("applies every rule field", () => {
    const uhd = a({ id: "u", name: "A001_ProRes", height: 2160, videoCodec: "prores", durationSeconds: 40 });
    expect(matchesSmartBin(uhd, { kind: "video", minHeight: 2160, codec: "ProRes", nameContains: "a001", minSeconds: 30 })).toBe(true);
    expect(matchesSmartBin(uhd, { maxSeconds: 30 })).toBe(false);
    expect(matchesSmartBin(uhd, { usage: "unused" }, new Set(["u"]))).toBe(false);
    expect(matchesSmartBin(uhd, { usage: "used" }, new Set(["u"]))).toBe(true);
  });
});
