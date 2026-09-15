import { describe, expect, it } from "vitest";
import { buildRuntimeConfig } from "../server/config";
import {
  applyUserSettings,
  parseGo2rtcStreams,
  readUserSettings,
  resolveStreamsApiUrl,
  USER_SETTINGS_STORAGE_KEY,
  writeUserSettings,
  type StorageLike,
  type UserSettings,
} from "../src/client/settings";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("browser settings", () => {
  it("parses go2rtc /api/streams responses", () => {
    expect(
      parseGo2rtcStreams({
        front_yard: { producers: [], consumers: [] },
        back_yard: { name: "Back Yard", producers: [] },
      }),
    ).toEqual([
      { id: "front-yard", src: "front_yard", label: "Front Yard", muted: undefined },
      { id: "back-yard", src: "back_yard", label: "Back Yard", muted: undefined },
    ]);
  });

  it("parses wrapped and array stream lists", () => {
    expect(parseGo2rtcStreams({ streams: ["front_yard", { src: "garage_lq", label: "Garage Low" }, "front_yard"] })).toEqual([
      { id: "front-yard", src: "front_yard", label: "Front Yard", muted: undefined },
      { id: "garage-low", src: "garage_lq", label: "Garage Low", muted: undefined },
    ]);
  });

  it("stores selected streams and applies them over deploy defaults", () => {
    const storage = new MemoryStorage();
    const baseConfig = buildRuntimeConfig({ GO2RTC_STREAMS: "deploy_cam:Deploy", LAYOUT: "auto", OBJECT_FIT: "contain" });
    const settings: UserSettings = {
      version: 1,
      streams: [{ id: "front-yard", src: "front_yard", label: "Front Yard" }],
      layout: "grid",
      objectFit: "cover",
      cleanView: true,
    };

    writeUserSettings(settings, storage);

    expect(storage.getItem(USER_SETTINGS_STORAGE_KEY)).toContain("front_yard");
    const saved = readUserSettings(storage);
    expect(saved).toEqual({ ...settings, streams: [{ ...settings.streams[0], muted: undefined }] });

    const effective = applyUserSettings(baseConfig, saved);
    expect(effective.streams).toEqual([{ id: "front-yard", src: "front_yard", label: "Front Yard", muted: undefined }]);
    expect(effective.layout).toBe("grid");
    expect(effective.objectFit).toBe("cover");
    expect(effective.features.cleanView).toBe(true);
  });

  it("leaves deploy clean-view defaults untouched for old saved settings", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        streams: [{ id: "front-yard", src: "front_yard", label: "Front Yard" }],
        layout: "stack",
        objectFit: "contain",
      }),
    );

    const baseConfig = buildRuntimeConfig({ CLEAN_VIEW: "true" });
    const effective = applyUserSettings(baseConfig, readUserSettings(storage));

    expect(effective.features.cleanView).toBe(true);
  });

  it("builds same-origin go2rtc stream discovery URLs", () => {
    const config = buildRuntimeConfig({ GO2RTC_STREAMS_PATH: "/custom/streams" });
    expect(resolveStreamsApiUrl(config, { protocol: "https:", origin: "https://go2rtc.example.test" })).toBe(
      "https://go2rtc.example.test/custom/streams",
    );
  });
});
