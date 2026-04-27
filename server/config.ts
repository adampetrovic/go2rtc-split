import {
  DEFAULT_RUNTIME_CONFIG,
  parseBoolean,
  parseEnum,
  parseIceServers,
  parseNumber,
  parseQuery,
  parseStreams,
  normaliseBasePath,
  normalisePath,
  type RuntimeConfig,
} from "../src/shared/config.js";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const LAYOUT_VALUES = ["auto", "stack", "grid"] as const;
const OBJECT_FIT_VALUES = ["contain", "cover", "fill"] as const;
const AUDIO_MODE_VALUES = ["mixed", "muted"] as const;

export function buildRuntimeConfig(env: Env = process.env): RuntimeConfig {
  const defaults = DEFAULT_RUNTIME_CONFIG;
  const minReconnect = Math.round(parseNumber(env.RECONNECT_MIN_MS, defaults.reconnect.minMs, { min: 250, max: 60_000 }));
  const maxReconnect = Math.round(parseNumber(env.RECONNECT_MAX_MS, defaults.reconnect.maxMs, { min: minReconnect, max: 120_000 }));
  const audioMode = parseEnum(env.AUDIO_MODE, AUDIO_MODE_VALUES, defaults.audio.mode);

  return {
    appName: env.APP_NAME?.trim() || defaults.appName,
    pageTitle: env.PAGE_TITLE?.trim() || env.APP_NAME?.trim() || defaults.pageTitle,
    basePath: normaliseBasePath(env.BASE_PATH ?? defaults.basePath),
    streams: parseStreams(env.GO2RTC_STREAMS ?? env.STREAMS, defaults.streams),
    layout: parseEnum(env.LAYOUT, LAYOUT_VALUES, defaults.layout),
    objectFit: parseEnum(env.OBJECT_FIT, OBJECT_FIT_VALUES, defaults.objectFit),
    go2rtc: {
      wsUrl: env.GO2RTC_WS_URL?.trim() || null,
      wsPath: normalisePath(env.GO2RTC_WS_PATH, defaults.go2rtc.wsPath),
      streamParam: env.GO2RTC_STREAM_PARAM?.trim() || defaults.go2rtc.streamParam,
      extraQuery: parseQuery(env.GO2RTC_QUERY),
    },
    audio: {
      mode: audioMode,
      startMuted: audioMode === "muted" || parseBoolean(env.START_MUTED, defaults.audio.startMuted),
      volume: parseNumber(env.DEFAULT_VOLUME, defaults.audio.volume, { min: 0, max: 1 }),
    },
    reconnect: {
      minMs: minReconnect,
      maxMs: maxReconnect,
    },
    rtc: {
      iceServers: parseIceServers(env.ICE_SERVERS, defaults.rtc.iceServers),
    },
    features: {
      showControls: parseBoolean(env.SHOW_CONTROLS, defaults.features.showControls),
      showStatus: parseBoolean(env.SHOW_STATUS, defaults.features.showStatus),
      nativeVideoControls: parseBoolean(env.NATIVE_VIDEO_CONTROLS, defaults.features.nativeVideoControls),
      wakeLock: parseBoolean(env.WAKE_LOCK, defaults.features.wakeLock),
      fullscreenButton: parseBoolean(env.FULLSCREEN_BUTTON, defaults.features.fullscreenButton),
      audioMeters: parseBoolean(env.AUDIO_METERS, defaults.features.audioMeters),
      audioUnlockPrompt: parseBoolean(env.AUDIO_UNLOCK_PROMPT, defaults.features.audioUnlockPrompt),
    },
  };
}
