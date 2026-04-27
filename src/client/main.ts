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
  fullscreenButton?: HTMLButtonElement;
  meter: AudioMeter | null;
  peer: Go2rtcPeer;
}

interface FullscreenController {
  toggleDocument: () => Promise<void>;
  toggleStream: (active: ActiveStream) => Promise<void>;
  registerGlobalButton: (button: HTMLButtonElement) => void;
  cleanup: () => void;
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
    "Open go2rtc streams in one focused view. In split view, audio from every unmuted stream is played together; fullscreen one stream to hear only that room.",
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
  let fullscreenController: FullscreenController | null = null;

  for (const stream of config.streams) {
    const active = createStreamPanel(
      stream,
      config,
      audioContext,
      () => {
        if (!config.features.audioUnlockPrompt) return;
        monitor.classList.add("audio-needs-unlock");
        audioBlocked.classList.add("is-visible");
      },
      (activeStream) => {
        void fullscreenController?.toggleStream(activeStream);
      },
    );
    activeStreams.push(active);
    grid.append(active.panel);
  }

  monitor.append(grid);

  fullscreenController = createFullscreenController(config, activeStreams, monitor);
  const globalControls = createGlobalControls(config, activeStreams, fullscreenController);
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
    const fullscreenStream = findFullscreenStream(activeStreams);
    if (fullscreenStream) {
      applyFocusedAudio(config, activeStreams, fullscreenStream);
    } else {
      for (const active of activeStreams) {
        if (config.audio.mode !== "muted") active.video.muted = false;
        updateMuteButton(active);
      }
    }
    for (const active of activeStreams) {
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
  onStreamFullscreen: (active: ActiveStream) => void,
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
  const fullscreenButton = config.features.fullscreenButton && isFullscreenSupported() ? element("button", "icon-button") : undefined;
  if (muteButton) {
    muteButton.type = "button";
    actions.append(muteButton);
  }
  if (fullscreenButton) {
    fullscreenButton.type = "button";
    actions.append(fullscreenButton);
  }

  if (config.features.audioMeters) {
    bottom.append(meterElement);
  }
  if (actions.childElementCount > 0) {
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

  const active: ActiveStream = { stream, panel, statusText, video, muteButton, fullscreenButton, meter, peer };

  muteButton?.addEventListener("click", () => {
    video.muted = !video.muted;
    updateMuteButton(active);
  });
  fullscreenButton?.addEventListener("click", () => {
    onStreamFullscreen(active);
  });
  updateMuteButton(active);
  updateStreamFullscreenButton(active, false);

  return active;
}

function createGlobalControls(config: RuntimeConfig, activeStreams: ActiveStream[], fullscreenController: FullscreenController): HTMLElement {
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
      void fullscreenController.toggleDocument();
    });
    controls.append(fullscreen);
    fullscreenController.registerGlobalButton(fullscreen);
  }

  if (config.features.showControls) {
    const stop = element("button", "secondary-button", "Stop");
    stop.type = "button";
    stop.addEventListener("click", () => {
      fullscreenController.cleanup();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
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

function createFullscreenController(config: RuntimeConfig, activeStreams: ActiveStream[], monitor: HTMLElement): FullscreenController {
  let globalButton: HTMLButtonElement | null = null;
  let focusedStream: ActiveStream | null = null;
  let audioSnapshot: Map<ActiveStream, boolean> | null = null;

  const sync = () => {
    const fullscreenElement = document.fullscreenElement;
    const fullscreenStream = findFullscreenStream(activeStreams);

    monitor.classList.toggle("is-fullscreen", Boolean(fullscreenElement));
    monitor.classList.toggle("is-stream-fullscreen", Boolean(fullscreenStream));

    if (fullscreenStream) {
      if (focusedStream !== fullscreenStream) {
        if (!audioSnapshot) {
          audioSnapshot = new Map(activeStreams.map((active) => [active, active.video.muted]));
        }
        focusedStream = fullscreenStream;
      }
      applyFocusedAudio(config, activeStreams, fullscreenStream);
    } else {
      if (focusedStream) {
        restoreFocusedAudio(activeStreams, audioSnapshot);
      }
      focusedStream = null;
      audioSnapshot = null;
    }

    updateGlobalFullscreenButton(globalButton, Boolean(fullscreenElement));
    updateStreamFullscreenButtons(activeStreams, fullscreenStream);
  };

  document.addEventListener("fullscreenchange", sync);
  sync();

  return {
    async toggleDocument() {
      if (!isFullscreenSupported()) return;
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
        return;
      }
      await document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    },
    async toggleStream(active) {
      if (!isFullscreenSupported()) return;
      if (document.fullscreenElement === active.panel) {
        await document.exitFullscreen().catch(() => undefined);
        return;
      }
      await active.panel.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    },
    registerGlobalButton(button) {
      globalButton = button;
      updateGlobalFullscreenButton(globalButton, Boolean(document.fullscreenElement));
    },
    cleanup() {
      document.removeEventListener("fullscreenchange", sync);
      if (focusedStream) restoreFocusedAudio(activeStreams, audioSnapshot);
      focusedStream = null;
      audioSnapshot = null;
      updateGlobalFullscreenButton(globalButton, false);
      updateStreamFullscreenButtons(activeStreams, null);
    },
  };
}

function findFullscreenStream(activeStreams: ActiveStream[]): ActiveStream | null {
  const fullscreenElement = document.fullscreenElement;
  if (!fullscreenElement) return null;
  return activeStreams.find((active) => fullscreenElement === active.panel || active.panel.contains(fullscreenElement)) ?? null;
}

function applyFocusedAudio(config: RuntimeConfig, activeStreams: ActiveStream[], fullscreenStream: ActiveStream): void {
  for (const active of activeStreams) {
    active.video.muted = config.audio.mode === "muted" || active !== fullscreenStream;
    updateMuteButton(active);
  }
  void fullscreenStream.peer.unlockPlayback();
}

function restoreFocusedAudio(activeStreams: ActiveStream[], snapshot: Map<ActiveStream, boolean> | null): void {
  if (!snapshot) return;
  for (const active of activeStreams) {
    const muted = snapshot.get(active);
    if (muted === undefined) continue;
    active.video.muted = muted;
    updateMuteButton(active);
  }
}

function updateGlobalFullscreenButton(button: HTMLButtonElement | null, isFullscreen: boolean): void {
  if (!button) return;
  button.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
  button.setAttribute("aria-label", isFullscreen ? "Exit fullscreen" : "Fullscreen all streams");
  button.classList.toggle("is-hidden", isFullscreen);
}

function updateStreamFullscreenButtons(activeStreams: ActiveStream[], fullscreenStream: ActiveStream | null): void {
  for (const active of activeStreams) {
    updateStreamFullscreenButton(active, active === fullscreenStream);
  }
}

function updateStreamFullscreenButton(active: ActiveStream, isFullscreen: boolean): void {
  if (!active.fullscreenButton) return;
  active.fullscreenButton.textContent = isFullscreen ? "Exit" : "Fullscreen";
  active.fullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? `Exit fullscreen for ${active.stream.label}` : `Fullscreen ${active.stream.label}`,
  );
  active.panel.classList.toggle("is-stream-fullscreen", isFullscreen);
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
