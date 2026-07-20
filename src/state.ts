// Minimal typed event emitter + shared debug/app state.
// Deliberately not zustand: the only cross-module traffic in Milestone 1
// is phase changes, errors and a throttled debug snapshot.

export type Phase =
  | 'idle'
  | 'starting-camera'
  | 'loading-model'
  | 'running'
  | 'error';

export interface HandDebug {
  /** Handedness label reported by MediaPipe ("Left" / "Right"). */
  label: string;
  /** Raw thumb-tip ↔ index-tip distance in normalized video coords. */
  rawDist: number;
  /** rawDist / hand-size reference (wrist ↔ middle MCP) — scale invariant. */
  ratio: number;
  pinching: boolean;
  fistArmed?: boolean;
  fistRatio?: number;
  fistOpened?: boolean;
}

export interface DebugInfo {
  fps: number;
  handCount: number;
  hands: HandDebug[];
}

type EventMap = {
  phase: Phase;
  error: string;
  debug: DebugInfo;
};

type Listener<P> = (payload: P) => void;

class Emitter<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<Listener<never>>>();

  on<K extends keyof T>(event: K, fn: Listener<T[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  emit<K extends keyof T>(event: K, payload: T[K]): void {
    this.listeners.get(event)?.forEach((fn) => (fn as Listener<T[K]>)(payload));
  }
}

export const bus = new Emitter<EventMap>();
