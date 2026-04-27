import { AudioMeter } from "./audio-meter";
import { Go2rtcPeer, type StreamStatusUpdate } from "./rtc";
import "./styles.css";
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig, type SplitStream } from "../shared/config";

interface ActiveStream {
  stream: SplitStream;
  panel: HTMLElement;
  statusText: HTMLElement;
  video: HTMLVideoElement;
  muteButton: HTMLButtonElement;
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

  const audioContext = await createAudioContext(config);
  const monitor = element("main", `monitor layout-${config.layout}`);
  monitor.style.setProperty("--video-fit", config.objectFit);

  const grid = element("section", "video-grid");
  const audioBlocked = element("div", "audio-blocked");
  const audioBlockedButton = element("button", undefined, "Tap to enable audio playback");
  audioBlockedButton.type = "button";
  audioBlocked.append(audioBlockedButton);

  const activeStreams: ActiveStream[] = [];

  for (const stream of config.streams) {
    const active = createStreamPanel(stream, config, audioContext, () => {
      audioBlocked.classList.add("is-visible");
    });
    activeStreams.push(active);
    grid.append(active.panel);
  }

  monitor.append(grid);

  if (config.features.showControls) {
    monitor.append(createGlobalControls(config, activeStreams));
  }

  monitor.append(audioBlocked);
  app.append(monitor);

  audioBlockedButton.addEventListener("click", () => {
    audioBlocked.classList.remove("is-visible");
    for (const active of activeStreams) {
      if (config.audio.mode !== "muted") active.video.muted = false;
      updateMuteButton(active);
      void active.peer.unlockPlayback();
    }
    void audioContext?.resume().catch(() => undefined);
  });

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
  const muteButton = element("button", "icon-button");
  muteButton.type = "button";
  actions.append(muteButton);
  bottom.append(meterElement, actions);

  if (!config.features.audioMeters) {
    meterElement.classList.add("is-hidden");
  }

  if (!config.features.showControls) {
    actions.classList.add("is-hidden");
  }

  panel.append(video, top, bottom);

  const meter = config.features.audioMeters ? new AudioMeter(meterElement) : null;

  const peer = new Go2rtcPeer(stream, video, config, {
    onStatus: (update) => updateStatus(panel, statusText, update),
    onAudioTrack: (mediaStream) => {
      if (meter) void meter.attach(mediaStream, audioContext ?? undefined);
    },
    onPlaybackBlocked,
  });

  const active: ActiveStream = { stream, panel, statusText, video, muteButton, meter, peer };

  muteButton.addEventListener("click", () => {
    video.muted = !video.muted;
    updateMuteButton(active);
  });
  updateMuteButton(active);

  return active;
}

function createGlobalControls(config: RuntimeConfig, activeStreams: ActiveStream[]): HTMLElement {
  const controls = element("nav", "global-controls");

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

  if (config.features.fullscreenButton && document.fullscreenEnabled) {
    const fullscreen = element("button", "secondary-button", "Fullscreen");
    fullscreen.type = "button";
    fullscreen.addEventListener("click", () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
      }
    });
    controls.append(fullscreen);
  }

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

  return controls;
}

function updateStatus(panel: HTMLElement, statusText: HTMLElement, update: StreamStatusUpdate): void {
  panel.dataset.state = update.status;
  const readable = update.status === "reconnecting" && update.detail ? `Reconnecting` : titleCase(update.status);
  statusText.textContent = readable;
  if (update.detail) panel.title = update.detail;
}

function updateMuteButton(active: ActiveStream): void {
  active.muteButton.textContent = active.video.muted ? "Listen" : "Mute";
  active.muteButton.setAttribute("aria-label", `${active.video.muted ? "Listen to" : "Mute"} ${active.stream.label}`);
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
