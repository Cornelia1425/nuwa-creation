// UI shell + per-frame wiring for Milestone 1.
//
// Architecture note (Milestone 2+): blow detection will use the Web
// Audio API — an AnalyserNode over a microphone MediaStream, gated
// behind its own explicit user action. Milestone 1 must NOT request
// microphone permission anywhere (camera.ts asks for video only).

import { useEffect, useRef, useState } from 'react';
import { startCamera } from './camera';
import {
  createHandTracker,
  VideoTracker,
  WRIST,
  THUMB_TIP,
  INDEX_TIP,
} from './tracking';
import {
  FistOpenDetector,
  PinchDetector,
  SwipeDetector,
  handOpenness,
  pinchMetric,
} from './gesture';
import { Renderer, makeVideoToScreen, type ScreenPoint } from './renderer';
import { FadeLoopAudio } from './audio';
import { bus, type DebugInfo, type Phase, type HandDebug } from './state';

interface LoopDeps {
  video: HTMLVideoElement;
  tracker: VideoTracker;
  renderer: Renderer;
  rainSound: FadeLoopAudio;
  music: FadeLoopAudio;
}

interface LoopHandle {
  stop: () => void;
}

// Openness thresholds for the music gate (fistRatio scale: a closed
// fist sits near 0.96, a spread hand near 1.5).
const MUSIC_FIST_CLOSE = 1.02;
/** Music keeps playing this long after the hand leaves the frame. */
const MUSIC_MISSING_GRACE_MS = 1200;

/** rAF-driven loop: detect → gesture → render → (throttled) debug. */
function startLoop({
  video,
  tracker,
  renderer,
  rainSound,
  music,
}: LoopDeps): LoopHandle {
  // Keyed by handedness label so a detector keeps its hysteresis state
  // even when MediaPipe reorders the hands array between frames.
  const pinchDetectors = new Map<string, PinchDetector>();
  const fistDetectors = new Map<string, FistOpenDetector>();
  const swipeDetectors = new Map<string, SwipeDetector>();

  let rafId = 0;
  let lastFrame = performance.now();
  let fps = 0;
  let lastDebugEmit = 0;
  let raining = false;
  let musicOn = false;
  let handMissingMs = 0;

  const frame = (now: number) => {
    rafId = requestAnimationFrame(frame);
    const dtMs = now - lastFrame;
    lastFrame = now;
    if (dtMs > 0) fps = fps * 0.9 + (1000 / dtMs) * 0.1;

    const result = tracker.detect(now);
    const toScreen = makeVideoToScreen(
      video.videoWidth,
      video.videoHeight,
      renderer.screenW,
      renderer.screenH,
    );

    const screenHands: ScreenPoint[][] = [];
    const handDebugs: HandDebug[] = [];
    const seen = new Set<string>();
    let fistPoint: ScreenPoint | null = null;
    let fistTriggered = false;
    let maxOpenness = 0;

    const landmarksList = result?.landmarks ?? [];
    const handednessList = result?.handedness ?? [];
    for (let i = 0; i < landmarksList.length; i += 1) {
      const landmarks = landmarksList[i];
      const label = handednessList[i]?.[0]?.categoryName ?? `hand-${i}`;
      seen.add(label);

      let pinchDetector = pinchDetectors.get(label);
      if (!pinchDetector) {
        pinchDetector = new PinchDetector();
        pinchDetectors.set(label, pinchDetector);
      }

      let fistDetector = fistDetectors.get(label);
      if (!fistDetector) {
        fistDetector = new FistOpenDetector();
        fistDetectors.set(label, fistDetector);
      }

      let swipeDetector = swipeDetectors.get(label);
      if (!swipeDetector) {
        swipeDetector = new SwipeDetector();
        swipeDetectors.set(label, swipeDetector);
      }

      const metric = pinchMetric(landmarks);
      const pinching = pinchDetector.update(metric.ratio);

      screenHands.push(landmarks.map((lm) => toScreen(lm.x, lm.y)));
      const openedThisFrame = fistDetector.update(landmarks, dtMs);
      if (openedThisFrame) {
        const thumb = landmarks[THUMB_TIP];
        const index = landmarks[INDEX_TIP];
        fistPoint = toScreen((thumb.x + index.x) / 2, (thumb.y + index.y) / 2);
        fistTriggered = true;
      }
      const fistDebug = fistDetector.getDebug();
      handDebugs.push({
        label,
        ...metric,
        pinching,
        fistArmed: fistDebug.armed,
        fistRatio: fistDebug.fistRatio,
        fistOpened: openedThisFrame,
      });

      const openness = handOpenness(landmarks);
      maxOpenness = Math.max(maxOpenness, openness);

      // Full-screen swipe: right-to-left starts the rain, left-to-right
      // with an open hand stops it. Tracked at the wrist — it follows
      // the arm's sweep more steadily than a fingertip.
      const wrist = toScreen(landmarks[WRIST].x, landmarks[WRIST].y);
      const swipe = swipeDetector.update(
        wrist.x,
        wrist.y,
        openness,
        renderer.screenW,
        renderer.screenH,
        now,
        dtMs,
      );
      if (swipe === 'left') raining = true;
      if (swipe === 'right') raining = false;
    }

    // Hands that vanished this frame keep state briefly, then reset.
    for (const [label, detector] of pinchDetectors) {
      if (!seen.has(label)) detector.noteMissing();
    }
    for (const [label, detector] of fistDetectors) {
      if (!seen.has(label)) detector.noteMissing();
    }
    for (const [label, detector] of swipeDetectors) {
      if (!seen.has(label)) detector.noteMissing();
    }

    // Creation music: the fist-then-open gesture starts (or resumes)
    // the song; closing the hand back into a fist pauses it, and the
    // next fist-then-open picks up where it left off.
    if (fistTriggered) musicOn = true;
    if (landmarksList.length > 0) {
      handMissingMs = 0;
      if (maxOpenness <= MUSIC_FIST_CLOSE) musicOn = false;
    } else {
      handMissingMs += dtMs;
      if (handMissingMs > MUSIC_MISSING_GRACE_MS) musicOn = false;
    }
    music.setPlaying(musicOn);
    music.update(dtMs);

    renderer.setRaining(raining);
    rainSound.setPlaying(raining);
    rainSound.update(dtMs);

    renderer.drawLandmarks(screenHands);
    renderer.update(dtMs, fistPoint, fistTriggered);

    if (now - lastDebugEmit > 100) {
      lastDebugEmit = now;
      bus.emit('debug', {
        fps,
        handCount: result?.landmarks.length ?? 0,
        hands: handDebugs,
      });
    }
  };

  rafId = requestAnimationFrame(frame);
  return {
    stop: () => cancelAnimationFrame(rafId),
  };
}

function DebugPanel({ info }: { info: DebugInfo | null }) {
  if (!info) return <div className="debug-panel">waiting for frames…</div>;
  const lines = [
    `fps        ${info.fps.toFixed(1)}`,
    `hands      ${info.handCount}`,
    ...info.hands.map(
      (h) =>
        `${h.label.padEnd(6)} raw ${h.rawDist.toFixed(3)}  ` +
        `ratio ${h.ratio.toFixed(3)}  ${h.pinching ? 'PINCH' : 'open'}  ` +
        `fist ${h.fistArmed ? 'ARMED' : 'idle'}  ` +
        `fr ${h.fistRatio?.toFixed(3) ?? '---'}  ` +
        `${h.fistOpened ? 'OPEN!' : ''}`,
    ),
  ];
  return <div className="debug-panel">{lines.join('\n')}</div>;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pixiMountRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const loopRef = useRef<LoopHandle | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const [debug, setDebug] = useState<DebugInfo | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') setShowDebug((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => bus.on('debug', setDebug), []);

  // Camera + model init must be triggered by the Start button: iOS
  // Safari only grants getUserMedia/autoplay inside a user gesture.
  const handleStart = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      // Created inside the click handler so the browser lets us play
      // them later from gestures (autoplay unlock). Music fades fast so
      // it tracks the open/close of the hand responsively.
      const rainSound = new FadeLoopAudio(`${import.meta.env.BASE_URL}rainsound.mp3`);
      rainSound.unlock();
      const music = new FadeLoopAudio(
        `${import.meta.env.BASE_URL}unique.mp3`,
        3,
        2.4,
        0.9,
      );
      music.unlock();

      setPhase('starting-camera');
      await startCamera(videoRef.current!);

      setPhase('loading-model');
      const landmarker = await createHandTracker();

      const renderer = new Renderer();
      await renderer.init(pixiMountRef.current!);

      loopRef.current = startLoop({
        video: videoRef.current!,
        tracker: new VideoTracker(landmarker, videoRef.current!),
        renderer,
        rainSound,
        music,
      });
      setPhase('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
      startedRef.current = false;
    }
  };

  return (
    <>
      {/* playsInline + muted are required for iOS Safari inline playback */}
      <video ref={videoRef} className="camera-video" playsInline muted />
      <div ref={pixiMountRef} />

      {phase === 'idle' && (
        <div className="overlay">
          <h1>女娲造人 · Nüwa Creation</h1>
          <p>
            Make a fist, then open your hand — mud flies out and lands as
            small humans. Sweep your hand right-to-left across the screen
            to summon rain; sweep left-to-right with fingers spread to
            clear it. Allow camera access when prompted — nothing is
            recorded or uploaded.
          </p>
          <button className="start-button" onClick={handleStart}>
            Start
          </button>
        </div>
      )}

      {(phase === 'starting-camera' || phase === 'loading-model') && (
        <div className="overlay">
          <div className="spinner" />
          <p>
            {phase === 'starting-camera'
              ? 'Waiting for camera…'
              : 'Downloading hand-tracking model…'}
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="overlay">
          <h1>Something went wrong</h1>
          <p className="error-text">{error}</p>
          <button className="start-button" onClick={() => setPhase('idle')}>
            Try again
          </button>
        </div>
      )}

      {phase === 'running' && showDebug && <DebugPanel info={debug} />}
      {phase === 'running' && !showDebug && (
        <div className="debug-hint">press “d” for debug</div>
      )}
    </>
  );
}
