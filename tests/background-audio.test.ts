import { describe, expect, it, vi } from "vitest";
import { muteForBackground, restoreAfterBackground } from "../src/client/background-audio";

interface TestStream {
  video: {
    muted: boolean;
  };
}

function stream(muted: boolean): TestStream {
  return { video: { muted } };
}

describe("background audio guard", () => {
  it("mutes every active stream while preserving the previous mute state", () => {
    const activeStreams = [stream(false), stream(true), stream(false)];
    const onMuteChange = vi.fn();

    const snapshot = muteForBackground(activeStreams, null, onMuteChange);

    expect(activeStreams.map((active) => active.video.muted)).toEqual([true, true, true]);
    expect([...snapshot.values()]).toEqual([false, true, false]);
    expect(onMuteChange).toHaveBeenCalledTimes(3);
  });

  it("keeps the first snapshot when background events fire repeatedly", () => {
    const activeStreams = [stream(false), stream(true)];
    const onMuteChange = vi.fn();

    const snapshot = muteForBackground(activeStreams, null, onMuteChange);
    const repeated = muteForBackground(activeStreams, snapshot, onMuteChange);

    expect(repeated).toBe(snapshot);
    expect([...repeated.values()]).toEqual([false, true]);
    expect(onMuteChange).toHaveBeenCalledTimes(2);
  });

  it("restores the previous mute state after returning to the foreground", () => {
    const activeStreams = [stream(false), stream(true), stream(false)];
    const onMuteChange = vi.fn();
    const snapshot = muteForBackground(activeStreams, null, onMuteChange);

    const nextSnapshot = restoreAfterBackground(activeStreams, snapshot, onMuteChange);

    expect(nextSnapshot).toBeNull();
    expect(activeStreams.map((active) => active.video.muted)).toEqual([false, true, false]);
    expect(onMuteChange).toHaveBeenCalledTimes(6);
  });
});
