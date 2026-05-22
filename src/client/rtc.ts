import { resolveWsUrl, type RuntimeConfig, type SplitStream } from "../shared/config";

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "error" | "closed";

export interface StreamStatusUpdate {
  status: StreamStatus;
  detail?: string;
}

export interface Go2rtcPeerCallbacks {
  onStatus: (update: StreamStatusUpdate) => void;
  onAudioTrack: (stream: MediaStream) => void;
  onPlaybackBlocked: () => void;
}

export class Go2rtcPeer {
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private readonly mediaStream = new MediaStream();
  private reconnectTimer = 0;
  private reconnectAttempt = 0;
  private stopped = true;
  private playPromise: Promise<void> | null = null;
  private generation = 0;

  constructor(
    private readonly stream: SplitStream,
    private readonly video: HTMLVideoElement,
    private readonly config: RuntimeConfig,
    private readonly callbacks: Go2rtcPeerCallbacks,
  ) {
    this.video.srcObject = this.mediaStream;
  }

  start(): void {
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
    this.closeConnections();
    this.clearMediaStream();
    this.callbacks.onStatus({ status: "closed" });
  }

  restart(detail = "Restarting stream"): void {
    if (this.stopped) return;

    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
    this.reconnectAttempt = 0;
    this.callbacks.onStatus({ status: "reconnecting", detail });
    this.clearMediaStream();
    this.connect();
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  setVolume(volume: number): void {
    this.video.volume = volume;
  }

  async unlockPlayback(): Promise<void> {
    try {
      await this.video.play();
    } catch {
      this.callbacks.onPlaybackBlocked();
    }
  }

  private connect(): void {
    if (this.stopped) return;

    this.closeConnections();
    const generation = ++this.generation;
    this.callbacks.onStatus({ status: this.reconnectAttempt > 0 ? "reconnecting" : "connecting" });

    const pc = new RTCPeerConnection({
      bundlePolicy: "max-bundle",
      iceServers: this.config.rtc.iceServers,
    });
    const ws = new WebSocket(resolveWsUrl(this.config, this.stream.src, window.location));

    this.pc = pc;
    this.ws = ws;

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.addEventListener("track", (event) => {
      if (!this.isActive(generation)) return;
      if (!this.mediaStream.getTracks().some((track) => track.id === event.track.id)) {
        this.mediaStream.addTrack(event.track);
      }

      if (event.track.kind === "audio") {
        this.callbacks.onAudioTrack(this.mediaStream);
      }

      this.callbacks.onStatus({ status: "live" });
      void this.ensurePlayback();
    });

    pc.addEventListener("icecandidate", (event) => {
      if (!this.isActive(generation) || !event.candidate || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "webrtc/candidate", value: event.candidate.candidate }));
    });

    pc.addEventListener("connectionstatechange", () => {
      if (!this.isActive(generation)) return;
      switch (pc.connectionState) {
        case "connected":
          this.reconnectAttempt = 0;
          this.callbacks.onStatus({ status: "live" });
          break;
        case "failed":
        case "closed":
        case "disconnected":
          this.scheduleReconnect(`WebRTC ${pc.connectionState}`);
          break;
      }
    });

    ws.addEventListener("open", () => {
      if (!this.isActive(generation)) return;
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (!this.isActive(generation) || ws.readyState !== WebSocket.OPEN || !pc.localDescription) return;
          ws.send(JSON.stringify({ type: "webrtc/offer", value: pc.localDescription.sdp }));
        })
        .catch((error: unknown) => this.scheduleReconnect(errorMessage(error)));
    });

    ws.addEventListener("message", (event) => {
      if (this.isActive(generation)) this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (this.isActive(generation)) this.scheduleReconnect("WebSocket closed");
    });

    ws.addEventListener("error", () => {
      if (this.isActive(generation)) this.scheduleReconnect("WebSocket error");
    });
  }

  private handleMessage(data: unknown): void {
    if (!this.pc) return;

    let message: { type?: string; value?: string };
    try {
      message = JSON.parse(String(data)) as { type?: string; value?: string };
    } catch {
      return;
    }

    if (message.type === "webrtc/candidate" && message.value) {
      void this.pc.addIceCandidate({ candidate: message.value, sdpMid: "0" }).catch(() => undefined);
      return;
    }

    if (message.type === "webrtc/answer" && message.value) {
      void this.pc.setRemoteDescription({ type: "answer", sdp: message.value }).catch((error: unknown) => {
        this.scheduleReconnect(errorMessage(error));
      });
      return;
    }

    if (message.type === "error") {
      this.scheduleReconnect(message.value || "go2rtc error");
    }
  }

  private async ensurePlayback(): Promise<void> {
    if (this.playPromise) return this.playPromise;
    this.playPromise = this.video
      .play()
      .catch(() => {
        this.callbacks.onPlaybackBlocked();
      })
      .finally(() => {
        this.playPromise = null;
      });
    return this.playPromise;
  }

  private scheduleReconnect(detail: string): void {
    if (this.stopped || this.reconnectTimer) return;

    this.callbacks.onStatus({ status: "reconnecting", detail });
    this.closeConnections();
    this.clearMediaStream();

    const delay = reconnectDelay(this.reconnectAttempt, this.config.reconnect.minMs, this.config.reconnect.maxMs);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      this.connect();
    }, delay);
  }

  private closeConnections(): void {
    this.generation += 1;

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
  }

  private clearMediaStream(): void {
    for (const track of this.mediaStream.getTracks()) {
      track.stop();
      this.mediaStream.removeTrack(track);
    }
  }

  private isActive(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }
}

function reconnectDelay(attempt: number, minMs: number, maxMs: number): number {
  const exponential = minMs * 2 ** Math.min(attempt, 8);
  const jitter = Math.round(Math.random() * minMs);
  return Math.min(maxMs, exponential + jitter);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
