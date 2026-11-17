export interface WakelockState {
  /** The reader asked to keep the screen on. */
  keepAwake: boolean;
  /** Auto page turn is running, so the reader may not touch the screen for minutes. */
  autoPlaying: boolean;
  /** TTS is reading aloud. */
  speaking: boolean;
  /** A hidden tab must never hold the lock (the platform revokes it anyway). */
  visible: boolean;
}

/**
 * Whether the screen lock should be held right now.
 * Reading by hand is covered by `keepAwake`; hands-free modes always hold it
 * so the screen does not sleep in the middle of a chapter.
 */
export function wakelockWanted(state: WakelockState): boolean {
  if (!state.visible) return false;
  return state.keepAwake || state.autoPlaying || state.speaking;
}
