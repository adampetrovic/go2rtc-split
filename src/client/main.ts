import { AudioMeter } from "./audio-meter";
import { Go2rtcPeer, type StreamStatusUpdate } from "./rtc";
import "./styles.css";
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig, type SplitStream } from "../shared/config";

interface ActiveStream {
  stream: SplitStream;
  panel: HTMLElement;
  statusText: HTMLElement;
  video: HTMLVideoElement;
  muteButton?: HTMLButtonElement;
  meter: AudioMeter | null;
  peer: Go2rtcPeer;
}

const app = getAppRoot();

void boot();

async function boot(): Promise<void> {
  const config = await loadRuntimeConfig();
  document.title = config.pageTitle;

  if (!("RTCPeerConnection" in window) || !("WebSocket" in window)) {
    renderFatal("This browser does not support the WebRTC features needed for go2rtc Split.");
    return;
  }

  renderStart(config);
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const configUrl = new URL("config.json", currentDirectoryUrl(window.location.href));
  try {
    const response = await fetch(configUrl, { cache: "no-store" });
    if (!response.ok) return DEFAULT_RUNTIME_CONFIG;
    return (await response.json()) as RuntimeConfig;
  } catch {
    return DEFAULT_RUNTIME_CONFIG;
  }
}

function renderStart(config: RuntimeConfig): void {
  app.replaceChildren();

  const screen = element("main", "start-screen");
  const card = element("section", "start-card");
  const eyebrow = element("p", "eyebrow", "Split monitor");
  const title = element("h1", undefined, config.appName);
  const copy = element(
    "p",
    "start-copy",
    "Open both go2rtc streams in one focused view. Audio from every unmuted stream is played together by the browser, so either room can be heard.",
  );
  const list = element("ul", "stream-list");

  if (config.streams.length === 0) {
    const item = element("li");
    item.textContent = "Set GO2RTC_STREAMS to choose the streams to display.";
    list.append(item);
  } else {
    for (const stream of config.streams) {
      const item = element("li");
      item.textContent = `${stream.label} · ${stream.src}`;
      list.append(item);
    }
  }

  const button = element("button", "primary-button", config.streams.length === 0 ? "No streams configured" : "Start monitor");
  button.type = "button";
  button.disabled = config.streams.length === 0;
  button.addEventListener("click", () => {
    void startMonitor(config);
  });

  card.append(eyebrow, title, copy, list, button);
  screen.append(card);
  app.append(screen);
}

async function startMonitor(config: RuntimeConfig): Promise<void> {
  app.replaceChildren();

  let audioContext: AudioContext | null = null;
  const monitor = element("main", `monitor layout-${config.layout}`);
  if (hasGlobalControls(config)) {
    monitor.classList.add("has-global-controls");
  }
  monitor.style.setProperty("--video-fit", config.objectFit);

  const grid = element("section", "video-grid");
  const audioBlocked = element("div", "audio-blocked");
  const audioBlockedButton = element("button", undefined, "Tap to enable audio playback");
  audioBlockedButton.type = "button";
  audioBlocked.append(audioBlockedButton);

  const activeStreams: ActiveStream[] = [];

  for (const stream of config.streams) {
    const active = createStreamPanel(stream, config, audioContext, () => {
      if (!config.features.audioUnlockPrompt) return;
      monitor.classList.add("audio-needs-unlock");
      audioBlocked.classList.add("is-visible");
    });
    activeStreams.push(active);
    grid.append(active.panel);
  }

  monitor.append(grid);

  const globalControls = createGlobalControls(config, activeStreams, monitor);
  if (globalControls.childElementCount > 0) {
    monitor.append(globalControls);
  }

  monitor.append(audioBlocked);
  app.append(monitor);

  void createAudioContext(config).then((context) => {
    audioContext = context;
  });

  audioBlockedButton.addEventListener("click", () => {
    monitor.classList.remove("audio-needs-unlock");
    audioBlocked.classList.remove("is-visible");
    for (const active of activeStreams) {
      if (config.audio.mode !== "muted") active.video.muted = false;
      updateMuteButton(active);
      void active.peer.unlockPlayback();
    }
    void audioContext?.resume().catch(() => undefined);
  });

  for (const active of activeStreams) {
    void active.peer.unlockPlayback();
  }

  await requestWakeLock(config);

  for (const active of activeStreams) {
    active.peer.start();
  }

  await Promise.all(activeStreams.map((active) => active.peer.unlockPlayback()));
}

function createStreamPanel(
  stream: SplitStream,
  config: RuntimeConfig,
  audioContext: AudioContext | null,
  onPlaybackBlocked: () => void,
): ActiveStream {
  const panel = element("article", "stream-panel");
  panel.dataset.state = "idle";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.controls = config.features.nativeVideoControls;
  video.muted = Boolean(config.audio.startMuted || config.audio.mode === "muted" || stream.muted);
  video.volume = config.audio.volume;

  const top = element("div", "panel-top");
  const title = element("div", "stream-title");
  const dot = element("span", "status-dot");
  const label = element("span", "stream-label", stream.label);
  const statusText = element("span", "status-text", "Idle");
  title.append(dot, label);
  if (!config.features.showStatus) {
    statusText.classList.add("is-hidden");
  }
  top.append(title, statusText);

  const bottom = element("div", "panel-bottom");
  const meterElement = element("div", "audio-meter");
  meterElement.append(element("span"));
  const actions = element("div", "panel-actions");
  const muteButton = config.features.showControls ? element("button", "icon-button") : undefined;
  if (muteButton) {
    muteButton.type = "button";
    actions.append(muteButton);
  }

  if (config.features.audioMeters) {
    bottom.append(meterElement);
  }
  if (config.features.showControls) {
    bottom.append(actions);
  }

  panel.append(video, top);
  if (bottom.childElementCount > 0) {
    panel.append(bottom);
  }

  attachViewportGestures(panel, video);

  const meter = config.features.audioMeters ? new AudioMeter(meterElement) : null;

  const peer = new Go2rtcPeer(stream, video, config, {
    onStatus: (update) => updateStatus(panel, statusText, update),
    onAudioTrack: (mediaStream) => {
      if (meter) void meter.attach(mediaStream, audioContext ?? undefined);
    },
    onPlaybackBlocked,
  });

  const active: ActiveStream = { stream, panel, statusText, video, muteButton, meter, peer };

  muteButton?.addEventListener("click", () => {
    video.muted = !video.muted;
    updateMuteButton(active);
  });
  updateMuteButton(active);

  return active;
}

function createGlobalControls(config: RuntimeConfig, activeStreams: ActiveStream[], monitor: HTMLElement): HTMLElement {
  const controls = element("nav", "global-controls");

  if (config.features.showControls) {
    const muteAll = element("button", "secondary-button", "Mute all");
    muteAll.type = "button";
    muteAll.addEventListener("click", () => {
      const shouldMute = activeStreams.some((active) => !active.video.muted);
      for (const active of activeStreams) {
        active.video.muted = shouldMute;
        updateMuteButton(active);
      }
      muteAll.textContent = shouldMute ? "Listen all" : "Mute all";
    });
    controls.append(muteAll);
  }

  if (config.features.fullscreenButton && isFullscreenSupported()) {
    const fullscreen = element("button", "secondary-button fullscreen-button", "Fullscreen");
    fullscreen.type = "button";
    fullscreen.addEventListener("click", () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
      }
    });
    controls.append(fullscreen);

    const updateFullscreenState = () => {
      const isFullscreen = Boolean(document.fullscreenElement);
      monitor.classList.toggle("is-fullscreen", isFullscreen);
      fullscreen.classList.toggle("is-hidden", isFullscreen);
    };
    document.addEventListener("fullscreenchange", updateFullscreenState);
    updateFullscreenState();
  }

  if (config.features.showControls) {
    const stop = element("button", "secondary-button", "Stop");
    stop.type = "button";
    stop.addEventListener("click", () => {
      for (const active of activeStreams) {
        active.peer.stop();
        active.meter?.stop();
      }
      renderStart(config);
    });
    controls.append(stop);
  }

  return controls;
}

function updateStatus(panel: HTMLElement, statusText: HTMLElement, update: StreamStatusUpdate): void {
  panel.dataset.state = update.status;
  const readable = update.status === "reconnecting" && update.detail ? `Reconnecting` : titleCase(update.status);
  statusText.textContent = readable;
  if (update.detail) panel.title = update.detail;
}

function updateMuteButton(active: ActiveStream): void {
  if (!active.muteButton) return;
  active.muteButton.textContent = active.video.muted ? "Listen" : "Mute";
  active.muteButton.setAttribute("aria-label", `${active.video.muted ? "Listen to" : "Mute"} ${active.stream.label}`);
}

function hasGlobalControls(config: RuntimeConfig): boolean {
  return config.features.showControls || (config.features.fullscreenButton && isFullscreenSupported());
}

function isFullscreenSupported(): boolean {
  return document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function";
}

function attachViewportGestures(panel: HTMLElement, video: HTMLVideoElement): void {
  const state = {
    scale: 1,
    x: 0,
    y: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    startDistance: 0,
    startCenter: { x: 0, y: 0 },
    pointers: new Map<number, { x: number; y: number }>(),
    lastTap: 0,
  };

  const apply = () => {
    const clamped = clampPan(panel, state.scale, state.x, state.y);
    state.x = clamped.x;
    state.y = clamped.y;
    video.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
    panel.classList.toggle("is-zoomed", state.scale > 1.01);
  };

  const reset = () => {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    apply();
  };

  panel.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    try {
      panel.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic tests and some browser edge cases can lack an active pointer capture target.
    }
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const now = Date.now();
    if (state.pointers.size === 1 && now - state.lastTap < 280) {
      reset();
      state.lastTap = 0;
      return;
    }
    state.lastTap = now;

    state.startScale = state.scale;
    state.startX = state.x;
    state.startY = state.y;
    state.startDistance = pointerDistance(state.pointers);
    state.startCenter = pointerCenter(state.pointers);
  });

  panel.addEventListener("pointermove", (event) => {
    if (!state.pointers.has(event.pointerId)) return;
    event.preventDefault();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (state.pointers.size >= 2) {
      const distance = pointerDistance(state.pointers);
      const center = pointerCenter(state.pointers);
      const nextScale = state.startDistance > 0 ? state.startScale * (distance / state.startDistance) : state.scale;
      state.scale = clamp(nextScale, 1, 6);
      state.x = state.startX + center.x - state.startCenter.x;
      state.y = state.startY + center.y - state.startCenter.y;
      apply();
      return;
    }

    if (state.scale <= 1) return;
    const point = [...state.pointers.values()][0];
    state.x = state.startX + point.x - state.startCenter.x;
    state.y = state.startY + point.y - state.startCenter.y;
    apply();
  });

  const endPointer = (event: PointerEvent) => {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);
    if (state.pointers.size > 0) {
      state.startScale = state.scale;
      state.startX = state.x;
      state.startY = state.y;
      state.startDistance = pointerDistance(state.pointers);
      state.startCenter = pointerCenter(state.pointers);
    }
  };

  panel.addEventListener("pointerup", endPointer);
  panel.addEventListener("pointercancel", endPointer);
  panel.addEventListener("dblclick", (event) => {
    event.preventDefault();
    reset();
  });
  panel.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      state.scale = clamp(state.scale - event.deltaY * 0.01, 1, 6);
      apply();
    },
    { passive: false },
  );
}

function pointerDistance(pointers: Map<number, { x: number; y: number }>): number {
  const values = [...pointers.values()];
  if (values.length < 2) return 0;
  return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
}

function pointerCenter(pointers: Map<number, { x: number; y: number }>): { x: number; y: number } {
  const values = [...pointers.values()];
  if (values.length === 0) return { x: 0, y: 0 };
  const sum = values.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / values.length, y: sum.y / values.length };
}

function clampPan(panel: HTMLElement, scale: number, x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, (panel.clientWidth * (scale - 1)) / 2);
  const maxY = Math.max(0, (panel.clientHeight * (scale - 1)) / 2);
  return {
    x: clamp(x, -maxX, maxX),
    y: clamp(y, -maxY, maxY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function createAudioContext(config: RuntimeConfig): Promise<AudioContext | null> {
  if (!config.features.audioMeters) return null;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;

  try {
    const context = new AudioContextConstructor();
    await context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

async function requestWakeLock(config: RuntimeConfig): Promise<void> {
  if (!config.features.wakeLock || !("wakeLock" in navigator)) return;

  try {
    await navigator.wakeLock.request("screen");
  } catch {
    return;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void navigator.wakeLock.request("screen").catch(() => undefined);
    }
  });
}

function renderFatal(message: string): void {
  app.replaceChildren();
  const screen = element("main", "error-screen");
  const card = element("section", "error-card");
  card.append(element("p", "eyebrow", "Cannot start"), element("h1", undefined, "Unsupported browser"), element("p", "error-copy", message));
  screen.append(card);
  app.append(screen);
}

function getAppRoot(): HTMLDivElement {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) throw new Error("Missing app root");
  return root;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function currentDirectoryUrl(href: string): string {
  const url = new URL(href);
  if (!url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/[^/]*$/, "/");
  }
  return url.toString();
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
