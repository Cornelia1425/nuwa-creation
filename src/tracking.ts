// MediaPipe HandLandmarker wrapper (tasks-vision, VIDEO running mode).
// WASM + model come from the official CDNs; the caller shows a loading
// state while this downloads (~10 MB the first time, then HTTP-cached).

import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Landmark indices we care about (MediaPipe hand topology).
export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;

export async function createHandTracker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
  });
}

/**
 * Runs detection for the current video frame. Skips inference when the
 * video hasn't produced a new frame since last call (detectForVideo
 * requires strictly increasing timestamps, and re-running on the same
 * frame wastes GPU time), returning the previous result instead.
 */
export class VideoTracker {
  private lastVideoTime = -1;
  private lastResult: HandLandmarkerResult | null = null;

  constructor(
    private landmarker: HandLandmarker,
    private video: HTMLVideoElement,
  ) {}

  detect(nowMs: number): HandLandmarkerResult | null {
    if (
      this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      this.video.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = this.video.currentTime;
      this.lastResult = this.landmarker.detectForVideo(this.video, nowMs);
    }
    return this.lastResult;
  }
}

export function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
