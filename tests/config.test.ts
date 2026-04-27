import { describe, expect, it } from "vitest";
import { buildRuntimeConfig } from "../server/config";
import { DEFAULT_STREAMS, parseBoolean, parseStreams, resolveWsUrl } from "../src/shared/config";

describe("runtime config", () => {
  it("defaults to the split base path", () => {
    const config = buildRuntimeConfig({});
    expect(config.basePath).toBe("/split");
  });

  it("parses comma separated stream configuration", () => {
    const streams = parseStreams("stream_a:Stream A,stream_b:Stream B");
    expect(streams).toEqual([
      { id: "stream-a", src: "stream_a", label: "Stream A", muted: undefined },
      { id: "stream-b", src: "stream_b", label: "Stream B", muted: undefined },
    ]);
  });

  it("parses JSON stream configuration", () => {
    const streams = parseStreams('[{"id":"one","src":"cam_1","label":"Room One","muted":true}]');
    expect(streams).toEqual([{ id: "one", src: "cam_1", label: "Room One", muted: true }]);
  });

  it("falls back to defaults for invalid streams", () => {
    expect(parseStreams("[]")).toEqual(DEFAULT_STREAMS);
    expect(parseStreams("not-json,")).toEqual([{ id: "not-json", src: "not-json", label: "Not Json", muted: undefined }]);
  });

  it("parses booleans conservatively", () => {
    expect(parseBoolean("yes", false)).toBe(true);
    expect(parseBoolean("off", true)).toBe(false);
    expect(parseBoolean("maybe", true)).toBe(true);
  });

  it("builds same-origin go2rtc websocket URLs", () => {
    const config = buildRuntimeConfig({ GO2RTC_QUERY: "media=video+audio" });
    const url = resolveWsUrl(config, "stream_a", { protocol: "https:", origin: "https://go2rtc.example.test" });
    expect(url).toBe("wss://go2rtc.example.test/api/ws?media=video%2Baudio&src=stream_a");
  });

  it("supports an absolute websocket URL template", () => {
    const config = buildRuntimeConfig({ GO2RTC_WS_URL: "wss://example.test/custom?src={src}&token=abc" });
    const url = resolveWsUrl(config, "stream_b", { protocol: "https:", origin: "https://ignored.test" });
    expect(url).toBe("wss://example.test/custom?src=stream_b&token=abc");
  });
});
