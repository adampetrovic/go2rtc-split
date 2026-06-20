export interface BackgroundAudioTarget {
  video: {
    muted: boolean;
  };
}

export type BackgroundAudioSnapshot<T extends BackgroundAudioTarget> = Map<T, boolean>;

export function muteForBackground<T extends BackgroundAudioTarget>(
  activeStreams: T[],
  existingSnapshot: BackgroundAudioSnapshot<T> | null,
  onMuteChange: (active: T) => void,
): BackgroundAudioSnapshot<T> {
  if (existingSnapshot) return existingSnapshot;

  const snapshot = new Map(activeStreams.map((active) => [active, active.video.muted]));
  for (const active of activeStreams) {
    active.video.muted = true;
    onMuteChange(active);
  }
  return snapshot;
}

export function restoreAfterBackground<T extends BackgroundAudioTarget>(
  activeStreams: T[],
  snapshot: BackgroundAudioSnapshot<T> | null,
  onMuteChange: (active: T) => void,
): null {
  if (!snapshot) return null;

  for (const active of activeStreams) {
    const muted = snapshot.get(active);
    if (muted === undefined) continue;
    active.video.muted = muted;
    onMuteChange(active);
  }

  return null;
}
