import { AudioMeter } from "./audio-meter";
import { muteForBackground, restoreAfterBackground, type BackgroundAudioSnapshot } from "./background-audio";
import { Go2rtcPeer, type StreamStatusUpdate } from "./rtc";
import {
  applyUserSettings,
  clearUserSettings,
  createManualStream,
  createUserSettings,
  parseGo2rtcStreams,
  readUserSettings,
  resolveStreamsApiUrl,
  writeUserSettings,
  type UserSettings,
} from "./settings";
import "./styles.css";
import { DEFAULT_RUNTIME_CONFIG, type LayoutMode, type ObjectFitMode, type RuntimeConfig, type SplitStream } from "../shared/config";

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

interface SleepRecoveryOptions {
  forceReconnect?: boolean;
  reason?: string;
}

interface SleepRecoveryController {
  recover: (options?: SleepRecoveryOptions) => Promise<void>;
  cleanup: () => void;
}

const LAYOUT_OPTIONS: Array<{ value: LayoutMode; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Responsive vertical/grid layout" },
  { value: "stack", label: "Vertical", description: "One camera per row" },
  { value: "grid", label: "Grid", description: "Balanced tiled view" },
];

const OBJECT_FIT_OPTIONS: Array<{ value: ObjectFitMode; label: string; description: string }> = [
  { value: "contain", label: "Fit", description: "Show the full frame" },
  { value: "cover", label: "Crop", description: "Fill each tile" },
  { value: "fill", label: "Stretch", description: "Ignore aspect ratio" },
];

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

function renderStart(baseConfig: RuntimeConfig): void {
  app.replaceChildren();

  const savedSettings = readUserSettings();
  const config = applyUserSettings(baseConfig, savedSettings);
  const screen = element("main", "start-screen");
  const card = element("section", "start-card");
  const streamCount = config.streams.length;
  const settingsSource = savedSettings ? "Browser settings" : "Deploy defaults";

  const title = element("h1", undefined, config.appName);
  const summary = element(
    "p",
    "start-copy",
    streamCount > 0
      ? `${streamCount} camera${streamCount === 1 ? "" : "s"} selected · ${layoutLabel(config.layout)} · ${settingsSource}`
      : "No cameras selected yet. Open settings to choose any stream published by go2rtc.",
  );

  const streamList = createStreamSummaryList(config.streams);
  const actions = element("div", "start-actions");
  const button = element("button", "primary-button", streamCount === 0 ? "No cameras selected" : "Start");
  button.type = "button";
  button.disabled = streamCount === 0;
  button.addEventListener("click", () => {
    void startMonitor(config, baseConfig);
  });

  const settings = element("button", "secondary-button", "Settings");
  settings.type = "button";
  settings.addEventListener("click", () => {
    renderSettings(baseConfig);
  });

  actions.append(button, settings);
  card.append(element("p", "eyebrow", "go2rtc Split"), title, summary, streamList, actions);
  screen.append(card);
  app.append(screen);
}

function createStreamSummaryList(streams: SplitStream[]): HTMLElement {
  const list = element("ul", "stream-list");

  if (streams.length === 0) {
    const item = element("li");
    item.append(element("span", "stream-list-label", "No cameras selected"), element("span", "stream-list-source", "Use Settings to add streams."));
    list.append(item);
    return list;
  }

  for (const stream of streams) {
    const item = element("li");
    item.append(element("span", "stream-list-label", stream.label), element("span", "stream-list-source", stream.src));
    list.append(item);
  }

  return list;
}

function renderSettings(baseConfig: RuntimeConfig): void {
  app.replaceChildren();

  const current = createUserSettings(applyUserSettings(baseConfig, readUserSettings()));
  let draftStreams = current.streams;
  let draftLayout = current.layout;
  let draftObjectFit = current.objectFit;
  let availableStreams: SplitStream[] = [];

  const screen = element("main", "settings-screen");
  const card = element("section", "settings-card");
  const header = element("div", "settings-header");
  const headerCopy = element("div");
  headerCopy.append(
    element("p", "eyebrow", "Settings"),
    element("h1", undefined, "Camera views"),
    element("p", "settings-copy", "Choose any go2rtc streams this browser should show, then pick the split-view style."),
  );
  const back = element("button", "secondary-button", "Back");
  back.type = "button";
  back.addEventListener("click", () => {
    renderStart(baseConfig);
  });
  header.append(headerCopy, back);

  const layoutField = createChoiceField("Split view", LAYOUT_OPTIONS, draftLayout, (value) => {
    draftLayout = value;
  });
  const objectFitField = createChoiceField("Video fit", OBJECT_FIT_OPTIONS, draftObjectFit, (value) => {
    draftObjectFit = value;
  });

  const selectedSection = element("section", "settings-section");
  selectedSection.append(element("h2", undefined, "Selected cameras"));
  const selectedHelp = element("p", "settings-copy", "These cameras will be opened in the order shown.");
  const selectedList = element("ol", "selected-streams");
  selectedSection.append(selectedHelp, selectedList);

  const discoverSection = element("section", "settings-section");
  const discoverHeader = element("div", "section-header");
  discoverHeader.append(element("h2", undefined, "Available go2rtc streams"));
  const refresh = element("button", "secondary-button", "Refresh");
  refresh.type = "button";
  discoverHeader.append(refresh);
  const discoveryStatus = element("p", "settings-copy");
  const availableList = element("div", "available-streams");
  discoverSection.append(discoverHeader, discoveryStatus, availableList);

  const manualSection = element("section", "settings-section manual-stream-section");
  manualSection.append(element("h2", undefined, "Add stream manually"));
  const manualGrid = element("div", "manual-stream-grid");
  const srcInput = element("input", "text-input");
  srcInput.type = "text";
  srcInput.placeholder = "go2rtc stream name, e.g. front_yard";
  srcInput.autocomplete = "off";
  const labelInput = element("input", "text-input");
  labelInput.type = "text";
  labelInput.placeholder = "Label (optional)";
  labelInput.autocomplete = "off";
  const addManual = element("button", "secondary-button", "Add");
  addManual.type = "button";
  manualGrid.append(labelledControl("Stream", srcInput), labelledControl("Label", labelInput), addManual);
  manualSection.append(manualGrid);

  const actions = element("div", "settings-actions");
  const reset = element("button", "secondary-button", "Reset defaults");
  reset.type = "button";
  const save = element("button", "secondary-button", "Save");
  save.type = "button";
  const saveAndStart = element("button", "primary-button", "Save & start");
  saveAndStart.type = "button";
  actions.append(reset, save, saveAndStart);

  const renderSelectedStreams = () => {
    selectedList.replaceChildren();

    if (draftStreams.length === 0) {
      const empty = element("li", "empty-state", "No cameras selected. Pick streams below or add one manually.");
      selectedList.append(empty);
    }

    draftStreams.forEach((stream, index) => {
      const item = element("li", "selected-stream");
      const meta = element("div", "selected-stream-meta");
      meta.append(element("span", "stream-list-label", stream.label), element("span", "stream-list-source", stream.src));

      const controls = element("div", "selected-stream-controls");
      const up = element("button", "icon-button", "↑");
      up.type = "button";
      up.disabled = index === 0;
      up.setAttribute("aria-label", `Move ${stream.label} up`);
      up.addEventListener("click", () => {
        draftStreams = moveStream(draftStreams, index, index - 1);
        renderSelectedStreams();
      });

      const down = element("button", "icon-button", "↓");
      down.type = "button";
      down.disabled = index === draftStreams.length - 1;
      down.setAttribute("aria-label", `Move ${stream.label} down`);
      down.addEventListener("click", () => {
        draftStreams = moveStream(draftStreams, index, index + 1);
        renderSelectedStreams();
      });

      const remove = element("button", "secondary-button", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        draftStreams = draftStreams.filter((candidate) => candidate.src !== stream.src);
        renderSelectedStreams();
        renderAvailableStreams();
      });

      controls.append(up, down, remove);
      item.append(meta, controls);
      selectedList.append(item);
    });

    saveAndStart.disabled = draftStreams.length === 0;
  };

  const renderAvailableStreams = () => {
    availableList.replaceChildren();
    const streams = mergeStreams(availableStreams, draftStreams);

    if (streams.length === 0) {
      availableList.append(element("p", "empty-state", "No stream list available yet. You can still add a stream manually."));
      return;
    }

    for (const stream of streams) {
      const checked = draftStreams.some((candidate) => candidate.src === stream.src);
      const row = element("label", `available-stream${checked ? " is-selected" : ""}`);
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (!draftStreams.some((candidate) => candidate.src === stream.src)) {
            draftStreams = [...draftStreams, stream];
          }
        } else {
          draftStreams = draftStreams.filter((candidate) => candidate.src !== stream.src);
        }
        renderSelectedStreams();
        renderAvailableStreams();
      });
      const meta = element("span", "available-stream-meta");
      meta.append(element("span", "stream-list-label", stream.label), element("span", "stream-list-source", stream.src));
      row.append(checkbox, meta);
      availableList.append(row);
    }
  };

  const currentDraftSettings = (): UserSettings => ({
    version: 1,
    streams: draftStreams,
    layout: draftLayout,
    objectFit: draftObjectFit,
  });

  const persistDraft = (): UserSettings => {
    const settings = currentDraftSettings();
    writeUserSettings(settings);
    return settings;
  };

  addManual.addEventListener("click", () => {
    const src = srcInput.value.trim();
    if (!src || draftStreams.some((stream) => stream.src === src)) return;

    const stream = createManualStream(src, labelInput.value.trim() || undefined, draftStreams.length);
    if (!stream) return;

    draftStreams = [...draftStreams, stream];
    srcInput.value = "";
    labelInput.value = "";
    renderSelectedStreams();
    renderAvailableStreams();
  });

  srcInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addManual.click();
  });
  labelInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addManual.click();
  });

  refresh.addEventListener("click", () => {
    void refreshAvailableStreams();
  });

  reset.addEventListener("click", () => {
    clearUserSettings();
    renderStart(baseConfig);
  });

  save.addEventListener("click", () => {
    persistDraft();
    renderStart(baseConfig);
  });

  saveAndStart.addEventListener("click", () => {
    const settings = persistDraft();
    void startMonitor(applyUserSettings(baseConfig, settings), baseConfig);
  });

  async function refreshAvailableStreams(): Promise<void> {
    const url = resolveStreamsApiUrl(baseConfig, window.location);
    discoveryStatus.textContent = `Loading ${url} …`;
    refresh.disabled = true;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      availableStreams = parseGo2rtcStreams(await response.json());
      discoveryStatus.textContent =
        availableStreams.length > 0
          ? `Found ${availableStreams.length} go2rtc stream${availableStreams.length === 1 ? "" : "s"}.`
          : "go2rtc returned no streams. Add one manually if you know the source name.";
    } catch (error: unknown) {
      availableStreams = [];
      discoveryStatus.textContent = `Could not load go2rtc streams (${errorMessage(error)}). Add a stream manually or check the route to ${url}.`;
    } finally {
      refresh.disabled = false;
      renderAvailableStreams();
    }
  }

  renderSelectedStreams();
  renderAvailableStreams();
  card.append(header, layoutField, objectFitField, selectedSection, discoverSection, manualSection, actions);
  screen.append(card);
  app.append(screen);
  void refreshAvailableStreams();
}

async function startMonitor(config: RuntimeConfig, baseConfig: RuntimeConfig): Promise<void> {
  app.replaceChildren();

  const audioContext = await createAudioContext(config);
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
  const recoveryController = createSleepRecoveryController(config, activeStreams, audioContext);
  const stopMonitor = (nextScreen: () => void = () => renderStart(baseConfig)) => {
    recoveryController.cleanup();
    fullscreenController?.cleanup();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    for (const active of activeStreams) {
      active.peer.stop();
      active.meter?.stop();
    }
    nextScreen();
  };
  const globalControls = createGlobalControls(
    config,
    activeStreams,
    fullscreenController,
    () => recoveryController.recover({ forceReconnect: true, reason: "Manual audio recovery" }),
    stopMonitor,
    () => {
      stopMonitor(() => renderSettings(baseConfig));
    },
  );
  if (globalControls.childElementCount > 0) {
    monitor.append(globalControls);
  }

  monitor.append(audioBlocked);
  app.append(monitor);

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
  const topMeta = element("div", "panel-meta");
  const topActions = element("div", "panel-actions panel-actions-top");
  const fullscreenButton = config.features.fullscreenButton && config.features.streamFullscreenButton ? element("button", "icon-button focus-button") : undefined;
  title.append(dot, label);
  if (!config.features.showStatus) {
    statusText.classList.add("is-hidden");
  }
  if (fullscreenButton) {
    fullscreenButton.type = "button";
    topActions.append(fullscreenButton);
  }
  topMeta.append(statusText);
  if (topActions.childElementCount > 0) {
    topMeta.append(topActions);
  }
  top.append(title, topMeta);

  const bottom = element("div", "panel-bottom");
  const meterElement = element("div", "audio-meter");
  meterElement.append(element("span"));
  const bottomActions = element("div", "panel-actions");
  const muteButton = config.features.showControls ? element("button", "icon-button") : undefined;
  if (muteButton) {
    muteButton.type = "button";
    bottomActions.append(muteButton);
  }

  if (config.features.audioMeters) {
    bottom.append(meterElement);
  }
  if (bottomActions.childElementCount > 0) {
    bottom.append(bottomActions);
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

function createGlobalControls(
  config: RuntimeConfig,
  activeStreams: ActiveStream[],
  fullscreenController: FullscreenController,
  onRecoverPlayback: () => Promise<void>,
  onStop: () => void,
  onSettings: () => void,
): HTMLElement {
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

    if (config.features.sleepRecovery) {
      const recover = element("button", "secondary-button", "Recover audio");
      recover.type = "button";
      recover.addEventListener("click", () => {
        void onRecoverPlayback();
      });
      controls.append(recover);
    }
  }

  if (config.features.fullscreenButton && config.features.documentFullscreenButton && isFullscreenSupported()) {
    const fullscreen = element("button", "secondary-button fullscreen-button", "Fullscreen");
    fullscreen.type = "button";
    fullscreen.addEventListener("click", () => {
      void fullscreenController.toggleDocument();
    });
    controls.append(fullscreen);
    fullscreenController.registerGlobalButton(fullscreen);
  }

  if (config.features.showControls) {
    const settings = element("button", "secondary-button", "Settings");
    settings.type = "button";
    settings.addEventListener("click", onSettings);
    controls.append(settings);

    const stop = element("button", "secondary-button", "Stop");
    stop.type = "button";
    stop.addEventListener("click", onStop);
    controls.append(stop);
  }

  return controls;
}

function createSleepRecoveryController(config: RuntimeConfig, activeStreams: ActiveStream[], audioContext: AudioContext | null): SleepRecoveryController {
  const shouldListen = config.features.sleepRecovery || config.features.wakeLock;
  let hiddenAt = document.visibilityState === "hidden" ? Date.now() : 0;
  let pendingTimer = 0;
  let pendingForceReconnect = false;
  let pendingReason = "App resumed";
  let backgroundAudioSnapshot: BackgroundAudioSnapshot<ActiveStream> | null = null;
  let disposed = false;

  const recover = async (options: SleepRecoveryOptions = {}) => {
    if (disposed) return;

    await requestWakeLock(config);

    if (!config.features.sleepRecovery) return;

    const forceReconnect = Boolean(options.forceReconnect);
    const reason = options.reason ?? "Playback recovery";

    await resumeAudioContext(audioContext);
    await Promise.all(activeStreams.map((active) => active.meter?.resume() ?? Promise.resolve()));

    if (forceReconnect) {
      for (const active of activeStreams) {
        active.peer.restart(reason);
      }
    }

    await Promise.all(activeStreams.map((active) => active.peer.unlockPlayback()));
  };

  const scheduleRecovery = (forceReconnect: boolean, reason: string) => {
    if (!shouldListen || disposed) return;

    pendingForceReconnect ||= forceReconnect;
    if (forceReconnect || pendingReason === "App resumed") {
      pendingReason = reason;
    }

    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      pendingTimer = 0;
      const forceReconnectNow = pendingForceReconnect;
      const reasonNow = pendingReason;
      pendingForceReconnect = false;
      pendingReason = "App resumed";
      void recover({ forceReconnect: forceReconnectNow, reason: reasonNow });
    }, 250);
  };

  const suspendForHidden = () => {
    hiddenAt ||= Date.now();
    backgroundAudioSnapshot = muteForBackground(activeStreams, backgroundAudioSnapshot, updateMuteButton);
  };

  const resumeFromHidden = (reason: string, forceReconnect: boolean) => {
    const wasHidden = hiddenAt > 0;
    const hiddenFor = wasHidden ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    backgroundAudioSnapshot = restoreAfterBackground(activeStreams, backgroundAudioSnapshot, updateMuteButton);

    const shouldReconnect = forceReconnect || (wasHidden && hiddenFor >= config.recovery.reconnectAfterMs);
    const recoveryReason = shouldReconnect && wasHidden ? `${reason} after ${formatDuration(hiddenFor)}` : reason;
    scheduleRecovery(shouldReconnect, recoveryReason);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      suspendForHidden();
      return;
    }

    if (document.visibilityState === "visible") {
      resumeFromHidden("App resumed", false);
    }
  };

  const onPageHide = () => {
    suspendForHidden();
  };

  const onPageShow = (event: PageTransitionEvent) => {
    resumeFromHidden(event.persisted ? "Page restored" : "Page shown", event.persisted);
  };

  const onFocus = () => {
    if (document.visibilityState === "visible") {
      scheduleRecovery(false, "Window focused");
    }
  };

  if (shouldListen) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
  }

  return {
    recover,
    cleanup() {
      disposed = true;
      window.clearTimeout(pendingTimer);
      backgroundAudioSnapshot = restoreAfterBackground(activeStreams, backgroundAudioSnapshot, updateMuteButton);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
    },
  };
}

function createFullscreenController(config: RuntimeConfig, activeStreams: ActiveStream[], monitor: HTMLElement): FullscreenController {
  let globalButton: HTMLButtonElement | null = null;
  let focusedStream: ActiveStream | null = null;
  let nativeFocusedStream: ActiveStream | null = null;
  let audioSnapshot: Map<ActiveStream, boolean> | null = null;

  const setFocusedStream = (next: ActiveStream | null) => {
    if (next && !audioSnapshot) {
      audioSnapshot = new Map(activeStreams.map((active) => [active, active.video.muted]));
    }

    if (!next && focusedStream) {
      restoreFocusedAudio(activeStreams, audioSnapshot);
      audioSnapshot = null;
    }

    focusedStream = next;
    monitor.classList.toggle("is-focus-mode", Boolean(focusedStream));
    monitor.classList.toggle("is-stream-fullscreen", Boolean(focusedStream));

    for (const active of activeStreams) {
      active.panel.classList.toggle("is-focused", active === focusedStream);
    }

    if (focusedStream) {
      applyFocusedAudio(config, activeStreams, focusedStream);
    }

    updateStreamFullscreenButtons(activeStreams, focusedStream);
  };

  const sync = () => {
    const fullscreenElement = document.fullscreenElement;
    const fullscreenStream = findFullscreenStream(activeStreams);

    monitor.classList.toggle("is-fullscreen", Boolean(fullscreenElement));

    if (fullscreenStream) {
      nativeFocusedStream = fullscreenStream;
      setFocusedStream(fullscreenStream);
    } else if (!fullscreenElement && nativeFocusedStream) {
      nativeFocusedStream = null;
      setFocusedStream(null);
    }

    updateGlobalFullscreenButton(globalButton, Boolean(fullscreenElement));
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
      if (focusedStream === active) {
        if (document.fullscreenElement === active.panel) {
          await document.exitFullscreen().catch(() => undefined);
        }
        nativeFocusedStream = null;
        setFocusedStream(null);
        return;
      }

      setFocusedStream(active);

      if (isFullscreenSupported()) {
        await active.panel.requestFullscreen({ navigationUI: "hide" }).then(() => {
          nativeFocusedStream = active;
        }).catch(() => {
          nativeFocusedStream = null;
        });
      }
    },
    registerGlobalButton(button) {
      globalButton = button;
      updateGlobalFullscreenButton(globalButton, Boolean(document.fullscreenElement));
    },
    cleanup() {
      document.removeEventListener("fullscreenchange", sync);
      setFocusedStream(null);
      nativeFocusedStream = null;
      updateGlobalFullscreenButton(globalButton, false);
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
  active.fullscreenButton.textContent = isFullscreen ? "Split view" : "Full screen";
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

function createChoiceField<T extends string>(
  legendText: string,
  options: Array<{ value: T; label: string; description: string }>,
  selected: T,
  onChange: (value: T) => void,
): HTMLFieldSetElement {
  const field = element("fieldset", "choice-field");
  const legend = element("legend", undefined, legendText);
  const group = element("div", "choice-grid");

  for (const option of options) {
    const label = element("label", "choice-card");
    const input = element("input");
    input.type = "radio";
    input.name = slugFieldName(legendText);
    input.value = option.value;
    input.checked = option.value === selected;
    input.addEventListener("change", () => {
      if (input.checked) onChange(option.value);
    });

    const content = element("span", "choice-content");
    content.append(element("span", "choice-title", option.label), element("span", "choice-description", option.description));
    label.append(input, content);
    group.append(label);
  }

  field.append(legend, group);
  return field;
}

function labelledControl(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = element("label", "field-label");
  label.append(element("span", undefined, labelText), control);
  return label;
}

function moveStream(streams: SplitStream[], from: number, to: number): SplitStream[] {
  if (to < 0 || to >= streams.length) return streams;
  const next = [...streams];
  const [stream] = next.splice(from, 1);
  if (!stream) return streams;
  next.splice(to, 0, stream);
  return next;
}

function mergeStreams(first: SplitStream[], second: SplitStream[]): SplitStream[] {
  const merged: SplitStream[] = [];
  const seen = new Set<string>();

  for (const stream of [...first, ...second]) {
    if (seen.has(stream.src)) continue;
    merged.push(stream);
    seen.add(stream.src);
  }

  return merged;
}

function layoutLabel(layout: LayoutMode): string {
  return LAYOUT_OPTIONS.find((option) => option.value === layout)?.label ?? titleCase(layout);
}

function slugFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hasGlobalControls(config: RuntimeConfig): boolean {
  return config.features.showControls || (config.features.fullscreenButton && config.features.documentFullscreenButton && isFullscreenSupported());
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

async function resumeAudioContext(context: AudioContext | null): Promise<void> {
  if (!context || context.state === "closed" || context.state === "running") return;
  await context.resume().catch(() => undefined);
}

async function requestWakeLock(config: RuntimeConfig): Promise<void> {
  if (!config.features.wakeLock || !("wakeLock" in navigator)) return;

  try {
    await navigator.wakeLock.request("screen");
  } catch {
    // iOS Safari and some PWA contexts do not expose or grant wake locks.
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 90) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;

  return `${(minutes / 60).toFixed(1).replace(/\.0$/, "")}h`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
