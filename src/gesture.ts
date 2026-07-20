// Pinch detection.
//
// Metric: dist(thumb tip, index tip) / dist(wrist, middle-finger MCP).
// Dividing by a hand-internal reference length makes the threshold
// invariant to how far the hand is from the camera (30 cm or 1 m).
//
// Stability: hysteresis (enter < 0.28, exit > 0.38) plus a 3-frame
// confirmation window, so the state changes at most once per
// intentional gesture instead of flickering around the threshold.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { WRIST, THUMB_TIP, INDEX_TIP, MIDDLE_MCP, dist2d } from './tracking';

export const PINCH_ENTER = 0.28;
export const PINCH_EXIT = 0.38;
export const CONFIRM_FRAMES = 3;
/** Frames a hand may vanish before its detector resets. */
const MISSING_GRACE_FRAMES = 6;

export interface PinchMetric {
  rawDist: number;
  ratio: number;
}

export function pinchMetric(landmarks: NormalizedLandmark[]): PinchMetric {
  const rawDist = dist2d(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
  const handSize = dist2d(landmarks[WRIST], landmarks[MIDDLE_MCP]);
  return { rawDist, ratio: handSize > 1e-6 ? rawDist / handSize : Infinity };
}

export class PinchDetector {
  private active = false;
  private streak = 0;
  private missingFrames = 0;

  /** Feed one frame's ratio; returns the debounced pinch state. */
  update(ratio: number): boolean {
    this.missingFrames = 0;

    // Hysteresis: which state does this frame vote for?
    const vote = this.active ? ratio <= PINCH_EXIT : ratio < PINCH_ENTER;

    if (vote !== this.active) {
      this.streak += 1;
      if (this.streak >= CONFIRM_FRAMES) {
        this.active = vote;
        this.streak = 0;
      }
    } else {
      this.streak = 0;
    }
    return this.active;
  }

  /** Call on frames where this hand wasn't detected. */
  noteMissing(): boolean {
    this.missingFrames += 1;
    if (this.missingFrames > MISSING_GRACE_FRAMES) {
      this.active = false;
      this.streak = 0;
    }
    return this.active;
  }

  get isPinching(): boolean {
    return this.active;
  }
}

const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
const FIST_CLOSE_RATIO = 0.96;
const FIST_OPEN_RATIO = 1.38;
const FIST_OPEN_WINDOW_MS = 900;
const FIST_COOLDOWN_MS = 260;

function fistRatio(landmarks: NormalizedLandmark[], handSize: number): number {
  const safeSize = Math.max(handSize, 1e-6);
  const index = dist2d(landmarks[WRIST], landmarks[INDEX_TIP]) / safeSize;
  const middle = dist2d(landmarks[WRIST], landmarks[MIDDLE_TIP]) / safeSize;
  const ring = dist2d(landmarks[WRIST], landmarks[RING_TIP]) / safeSize;
  const pinky = dist2d(landmarks[WRIST], landmarks[PINKY_TIP]) / safeSize;
  return (index + middle + ring + pinky) / 4;
}

/**
 * Average fingertip extension (same metric FistOpenDetector uses):
 * ~0.9 for a fist, ~1.5+ for a fully spread hand.
 */
export function handOpenness(landmarks: NormalizedLandmark[]): number {
  const handSize = dist2d(landmarks[WRIST], landmarks[MIDDLE_MCP]);
  if (handSize <= 1e-6) return 0;
  return fistRatio(landmarks, handSize);
}

export class FistOpenDetector {
  private armed = false;
  private armedMs = 0;
  private cooldownMs = 0;
  private missingFrames = 0;
  private lastFistRatio = Infinity;

  update(landmarks: NormalizedLandmark[], dtMs: number): boolean {
    this.missingFrames = 0;
    this.cooldownMs = Math.max(0, this.cooldownMs - dtMs);

    const handSize = dist2d(landmarks[WRIST], landmarks[MIDDLE_MCP]);
    if (handSize <= 1e-6) {
      this.lastFistRatio = Infinity;
      this.armed = false;
      this.armedMs = 0;
      return false;
    }

    const ratio = fistRatio(landmarks, handSize);
    this.lastFistRatio = ratio;

    const closed = ratio <= FIST_CLOSE_RATIO;
    if (closed) {
      this.armed = true;
      this.armedMs = 0;
      return false;
    }

    if (this.armed) {
      this.armedMs += dtMs;
      if (this.armedMs > FIST_OPEN_WINDOW_MS) {
        this.armed = false;
        this.armedMs = 0;
      }
    }

    const opened = ratio >= FIST_OPEN_RATIO;
    const triggered = this.armed && opened && this.cooldownMs <= 0;
    if (!triggered) return false;

    this.armed = false;
    this.armedMs = 0;
    this.cooldownMs = FIST_COOLDOWN_MS;
    return true;
  }

  noteMissing(): void {
    this.missingFrames += 1;
    if (this.missingFrames > MISSING_GRACE_FRAMES) {
      this.armed = false;
      this.armedMs = 0;
      this.cooldownMs = 0;
      this.lastFistRatio = Infinity;
    }
  }

  getDebug(): { armed: boolean; fistRatio: number } {
    return {
      armed: this.armed,
      fistRatio: this.lastFistRatio,
    };
  }
}

// --- Full-screen horizontal swipe -------------------------------------

/** Direction the hand travelled across the screen. */
export type SwipeDirection = 'left' | 'right';

const SWIPE_WINDOW_MS = 1100;
/** Fraction of the screen width the hand must cross. */
const SWIPE_SPAN = 0.6;
/** Max vertical drift (fraction of screen height) for a "horizontal" swipe. */
const SWIPE_MAX_DRIFT = 0.4;
/** Fraction of samples that must be open-handed for open-hand swipes. */
const SWIPE_OPEN_FRACTION = 0.6;
const SWIPE_COOLDOWN_MS = 900;
const OPEN_HAND_RATIO = 1.3;

interface SwipeSample {
  t: number;
  x: number;
  y: number;
  open: boolean;
}

/**
 * Detects a hand sweeping across most of the screen within ~1 s.
 * Coordinates are screen pixels (already mirrored to match the
 * preview), so 'left' means the hand travelled right-to-left as the
 * user sees it. A leftward swipe accepts any hand shape; a rightward
 * swipe only counts when the hand is open (fingers extended).
 */
export class SwipeDetector {
  private trail: SwipeSample[] = [];
  private cooldownMs = 0;

  update(
    x: number,
    y: number,
    openness: number,
    screenW: number,
    screenH: number,
    nowMs: number,
    dtMs: number,
  ): SwipeDirection | null {
    this.cooldownMs = Math.max(0, this.cooldownMs - dtMs);
    this.trail.push({ t: nowMs, x, y, open: openness >= OPEN_HAND_RATIO });
    while (this.trail.length > 0 && nowMs - this.trail[0].t > SWIPE_WINDOW_MS) {
      this.trail.shift();
    }
    if (this.cooldownMs > 0 || this.trail.length < 4) return null;

    const first = this.trail[0];
    const last = this.trail[this.trail.length - 1];
    const dx = last.x - first.x;
    if (Math.abs(last.y - first.y) > screenH * SWIPE_MAX_DRIFT) return null;
    if (Math.abs(dx) < screenW * SWIPE_SPAN) return null;

    const direction: SwipeDirection = dx < 0 ? 'left' : 'right';
    if (direction === 'right') {
      const openCount = this.trail.filter((s) => s.open).length;
      if (openCount / this.trail.length < SWIPE_OPEN_FRACTION) return null;
    }

    this.trail = [];
    this.cooldownMs = SWIPE_COOLDOWN_MS;
    return direction;
  }

  noteMissing(): void {
    this.trail = [];
  }
}
