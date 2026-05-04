export type LayoutMode = "auto" | "stack" | "grid";
export type ObjectFitMode = "contain" | "cover" | "fill";
export type AudioMode = "mixed" | "muted";

export interface SplitStream {
  id: string;
  src: string;
  label: string;
  muted?: boolean;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface LocationLike {
  protocol: string;
  origin: string;
}

export interface RuntimeConfig {
  appName: string;
  pageTitle: string;
  basePath: string;
  streams: SplitStream[];
  layout: LayoutMode;
  objectFit: ObjectFitMode;
  go2rtc: {
    wsUrl: string | null;
    wsPath: string;
    streamParam: string;
    extraQuery: Record<string, string>;
  };
  audio: {
    mode: AudioMode;
    startMuted: boolean;
    volume: number;
  };
  reconnect: {
    minMs: number;
    maxMs: number;
  };
  rtc: {
    iceServers: IceServerConfig[];
  };
  features: {
    showControls: boolean;
    showStatus: boolean;
    nativeVideoControls: boolean;
    wakeLock: boolean;
    fullscreenButton: boolean;
    documentFullscreenButton: boolean;
    streamFullscreenButton: boolean;
    audioMeters: boolean;
    audioUnlockPrompt: boolean;
  };
}

export const DEFAULT_STREAMS: SplitStream[] = [];

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  appName: "go2rtc Split",
  pageTitle: "go2rtc Split",
  basePath: "/split",
  streams: DEFAULT_STREAMS,
  layout: "auto",
  objectFit: "contain",
  go2rtc: {
    wsUrl: null,
    wsPath: "/api/ws",
    streamParam: "src",
    extraQuery: {},
  },
  audio: {
    mode: "mixed",
    startMuted: false,
    volume: 1,
  },
  reconnect: {
    minMs: 1_000,
    maxMs: 15_000,
  },
  rtc: {
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }],
  },
  features: {
    showControls: true,
    showStatus: true,
    nativeVideoControls: false,
    wakeLock: true,
    fullscreenButton: true,
    documentFullscreenButton: true,
    streamFullscreenButton: true,
    audioMeters: true,
    audioUnlockPrompt: true,
  },
};

export function normaliseBasePath(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (raw === "" || raw === "/") return "";
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

export function normalisePath(value: string | undefined | null, fallback: string): string {
  const raw = (value ?? fallback).trim();
  if (raw === "") return fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function parseBoolean(value: string | undefined | null, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "y":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "n":
    case "off":
      return false;
    default:
      return fallback;
  }
}

export function parseNumber(value: string | undefined | null, fallback: number, options: { min?: number; max?: number } = {}): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const min = options.min ?? Number.NEGATIVE_INFINITY;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, parsed));
}

export function parseEnum<T extends string>(value: string | undefined | null, allowed: readonly T[], fallback: T): T {
  if (value == null || value.trim() === "") return fallback;
  const normalised = value.trim().toLowerCase();
  return allowed.includes(normalised as T) ? (normalised as T) : fallback;
}

export function parseQuery(value: string | undefined | null): Record<string, string> {
  if (value == null || value.trim() === "") return {};
  const query = value.trim().replace(/^\?/, "");
  const result: Record<string, string> = {};

  for (const part of query.split("&")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    const rawValue = separator === -1 ? "" : part.slice(separator + 1);
    const key = safeDecode(rawKey);
    if (key) result[key] = safeDecode(rawValue);
  }

  return result;
}

export function parseIceServers(value: string | undefined | null, fallback: IceServerConfig[]): IceServerConfig[] {
  if (value == null || value.trim() === "") return fallback;

  const raw = value.trim();
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as IceServerConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      return fallback;
    }
  }

  const urls = raw
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);

  return urls.length > 0 ? [{ urls }] : fallback;
}

export function parseStreams(value: string | undefined | null, fallback: SplitStream[] = DEFAULT_STREAMS): SplitStream[] {
  if (value == null || value.trim() === "") return [...fallback];
  const raw = value.trim();

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as Array<string | Partial<SplitStream>>;
      const streams = parsed.map((item, index) => coerceStream(item, index)).filter(isSplitStream);
      return streams.length > 0 ? streams : [...fallback];
    } catch {
      return [...fallback];
    }
  }

  const streams = raw
    .split(",")
    .map((part, index) => {
      const [srcPart, ...labelParts] = part.split(":");
      const src = srcPart?.trim();
      const label = labelParts.join(":").trim();
      if (!src) return null;
      return normaliseStream({ src, label: label || humaniseStreamName(src) }, index);
    })
    .filter(isSplitStream);

  return streams.length > 0 ? streams : [...fallback];
}

export function resolveWsUrl(config: RuntimeConfig, streamSrc: string, locationLike: LocationLike): string {
  const endpoint = config.go2rtc.wsUrl?.trim();
  const params = new URLSearchParams(config.go2rtc.extraQuery);
  params.set(config.go2rtc.streamParam || "src", streamSrc);

  if (endpoint) {
    const templated = endpoint.replaceAll("{src}", encodeURIComponent(streamSrc));
    const url = new URL(templated);
    for (const [key, value] of params.entries()) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  const path = config.go2rtc.wsPath || "/api/ws";
  const url = new URL(path, locationLike.origin);
  url.protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function createManifest(config: RuntimeConfig): Record<string, unknown> {
  const base = config.basePath || "";
  const startUrl = `${base || "/"}${base ? "/" : ""}`;
  const iconPath = `${base}/icon.svg` || "/icon.svg";

  return {
    name: config.appName,
    short_name: config.appName.length > 12 ? "Split" : config.appName,
    description: "A fullscreen split-view monitor for go2rtc streams.",
    start_url: startUrl,
    scope: startUrl,
    display: "fullscreen",
    background_color: "#101010",
    theme_color: "#101010",
    icons: [
      {
        src: iconPath,
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
}

function coerceStream(item: string | Partial<SplitStream>, index: number): SplitStream | null {
  if (typeof item === "string") {
    return normaliseStream({ src: item, label: humaniseStreamName(item) }, index);
  }
  return normaliseStream(item, index);
}

function normaliseStream(item: Partial<SplitStream>, index: number): SplitStream | null {
  const src = item.src?.trim();
  if (!src) return null;
  const label = item.label?.trim() || humaniseStreamName(src);
  const id = item.id?.trim() || slugify(label || src) || `stream-${index + 1}`;
  return {
    id,
    src,
    label,
    muted: item.muted,
  };
}

function isSplitStream(stream: SplitStream | null): stream is SplitStream {
  return stream != null && stream.src.length > 0;
}

function humaniseStreamName(src: string): string {
  return src
    .replace(/[_-]+/g, " ")
    .replace(/\b(hq|lq|hd|sd)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || src;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
