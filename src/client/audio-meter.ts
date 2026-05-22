export class AudioMeter {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame = 0;
  private readonly samples = new Uint8Array(256);

  constructor(private readonly element: HTMLElement) {}

  async attach(stream: MediaStream, context?: AudioContext): Promise<void> {
    this.stop();

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.setLevel(0);
      return;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;

    this.context = context ?? new AudioContextConstructor();
    if (this.context.state === "suspended") {
      await this.context.resume().catch(() => undefined);
    }

    const audioOnlyStream = new MediaStream(audioTracks);
    this.source = this.context.createMediaStreamSource(audioOnlyStream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.72;
    this.source.connect(this.analyser);
    this.tick();
  }

  async resume(): Promise<void> {
    if (this.context && this.context.state !== "closed" && this.context.state !== "running") {
      await this.context.resume().catch(() => undefined);
    }
  }

  stop(): void {
    window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.setLevel(0);
  }

  private tick = (): void => {
    if (!this.analyser) return;

    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) {
      const centred = sample - 128;
      sum += centred * centred;
    }

    const rms = Math.sqrt(sum / this.samples.length) / 128;
    this.setLevel(Math.min(1, rms * 4.8));
    this.animationFrame = window.requestAnimationFrame(this.tick);
  };

  private setLevel(level: number): void {
    this.element.style.setProperty("--audio-level", level.toFixed(3));
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
