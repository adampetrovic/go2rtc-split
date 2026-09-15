import {
  createSplitStream,
  humaniseStreamName,
  LAYOUT_VALUES,
  OBJECT_FIT_VALUES,
  parseEnum,
  parseStreams,
  type LayoutMode,
  type LocationLike,
  type ObjectFitMode,
  type RuntimeConfig,
  type SplitStream,
} from "../shared/config";

export const USER_SETTINGS_STORAGE_KEY = "go2rtc-split:user-settings:v1";
export const USER_SETTINGS_VERSION = 1;

export interface UserSettings {
  version: typeof USER_SETTINGS_VERSION;
  streams: SplitStream[];
  layout: LayoutMode;
  objectFit: ObjectFitMode;
  cleanView?: boolean;
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface StreamCandidate {
  src: string;
  label?: string;
  muted?: boolean;
}

export function readUserSettings(storage: StorageLike | null = defaultStorage()): UserSettings | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return coerceUserSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeUserSettings(settings: UserSettings, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(coerceUserSettings(settings) ?? settings));
  } catch {
    // Browsers can throw for localStorage in private modes or when quota is full.
  }
}

export function clearUserSettings(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(USER_SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore unavailable localStorage.
  }
}

export function createUserSettings(config: RuntimeConfig): UserSettings {
  return {
    version: USER_SETTINGS_VERSION,
    streams: cloneStreams(config.streams),
    layout: config.layout,
    objectFit: config.objectFit,
    cleanView: config.features.cleanView,
  };
}

export function applyUserSettings(config: RuntimeConfig, settings: UserSettings | null): RuntimeConfig {
  if (!settings) return config;

  return {
    ...config,
    streams: cloneStreams(settings.streams),
    layout: settings.layout,
    objectFit: settings.objectFit,
    features: {
      ...config.features,
      cleanView: settings.cleanView ?? config.features.cleanView,
    },
  };
}

export function resolveStreamsApiUrl(config: RuntimeConfig, locationLike: LocationLike): string {
  return new URL(config.go2rtc.streamsPath || "/api/streams", locationLike.origin).toString();
}

export function parseGo2rtcStreams(payload: unknown): SplitStream[] {
  return normaliseCandidates(collectStreamCandidates(payload));
}

export function createManualStream(src: string, label?: string, index = 0): SplitStream | null {
  return createSplitStream(src, label || humaniseStreamName(src), index);
}

function coerceUserSettings(value: unknown): UserSettings | null {
  if (!isRecord(value) || value.version !== USER_SETTINGS_VERSION) return null;

  const streams = Array.isArray(value.streams) ? parseStreams(JSON.stringify(value.streams), []) : [];
  const layout = parseEnum(stringValue(value.layout), LAYOUT_VALUES, "auto");
  const objectFit = parseEnum(stringValue(value.objectFit), OBJECT_FIT_VALUES, "contain");
  const cleanView = typeof value.cleanView === "boolean" ? value.cleanView : undefined;

  return {
    version: USER_SETTINGS_VERSION,
    streams,
    layout,
    objectFit,
    cleanView,
  };
}

function collectStreamCandidates(payload: unknown): StreamCandidate[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item, index) => candidateFromArrayItem(item, index));
  }

  if (!isRecord(payload)) return [];

  if ("streams" in payload && !looksLikeGo2rtcStreamDetails(payload)) {
    return collectStreamCandidates(payload.streams);
  }

  return Object.entries(payload).flatMap(([key, value]) => candidateFromRecordEntry(key, value));
}

function candidateFromArrayItem(item: unknown, index: number): StreamCandidate[] {
  if (typeof item === "string") return [{ src: item }];
  if (!isRecord(item)) return [];

  const src = firstString(item.src, item.stream, item.name, item.id, item.url);
  if (!src) return [];

  return [
    {
      src,
      label: firstString(item.label, item.title, item.name, item.id) || humaniseStreamName(src),
      muted: typeof item.muted === "boolean" ? item.muted : undefined,
    },
  ];
}

function candidateFromRecordEntry(key: string, value: unknown): StreamCandidate[] {
  const trimmedKey = key.trim();
  if (!trimmedKey) return [];

  if (isRecord(value)) {
    return [
      {
        src: trimmedKey,
        label: firstString(value.label, value.title, value.name) || humaniseStreamName(trimmedKey),
        muted: typeof value.muted === "boolean" ? value.muted : undefined,
      },
    ];
  }

  if (typeof value === "string" && /^\d+$/.test(trimmedKey)) {
    return [{ src: value }];
  }

  return [{ src: trimmedKey, label: humaniseStreamName(trimmedKey) }];
}

function normaliseCandidates(candidates: StreamCandidate[]): SplitStream[] {
  const seen = new Set<string>();
  const streams: SplitStream[] = [];

  for (const candidate of candidates) {
    const src = candidate.src.trim();
    if (!src || seen.has(src)) continue;

    const stream = createSplitStream(src, candidate.label, streams.length, candidate.muted);
    if (!stream) continue;

    streams.push(stream);
    seen.add(src);
  }

  return streams;
}

function looksLikeGo2rtcStreamDetails(value: Record<string, unknown>): boolean {
  return Array.isArray(value.producers) || Array.isArray(value.consumers);
}

function cloneStreams(streams: SplitStream[]): SplitStream[] {
  return streams.map((stream) => ({ ...stream }));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
