# Nüwa Creation — Milestone 1

Interactive hand-tracked "clay pinching" experience.
Vite + React + TypeScript, PixiJS v8 overlay, MediaPipe HandLandmarker.

## What Milestone 1 does

- **Start button** → camera permission request (never auto-requested on
  load; required for iOS Safari). Video is `playsinline muted`.
- Full-screen **mirrored** webcam preview (`object-fit: cover`).
- 1–2 hands tracked per frame (`detectForVideo`, GPU delegate), driven
  by `requestAnimationFrame`.
- Landmark dots drawn in a PixiJS layer, with coordinate mapping that
  compensates for both the mirror flip and the cover-crop, so dots sit
  on your fingers in desktop landscape and mobile portrait.
- **Pinch** = dist(thumb tip, index tip) / dist(wrist, middle MCP) —
  scale-invariant. Hysteresis (enter < 0.28, exit > 0.38) + 3-frame
  confirmation, so no flicker.
- A clay ball (#9c6b4a): pinch to grab it — it squashes and follows the
  thumb–index midpoint; release and it eases back to center.
- Press **d** to toggle the debug panel (FPS, raw + normalized pinch
  distance, gesture state, hand count).
- No microphone permission is requested (Web Audio blow detection is
  Milestone 2).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. `localhost` counts as a secure context, so
the camera works over plain HTTP here — no cert needed.

## Test on a phone (same Wi-Fi)

Cameras only work in **secure contexts**: `localhost` or HTTPS. Plain
`http://192.168.x.x:5173` will *not* get camera access, so the host
script enables a self-signed certificate (`@vitejs/plugin-basic-ssl`):

```bash
npm run dev:host        # = HTTPS=1 vite --host, listens on your LAN IP
```

1. Note the "Network" URL Vite prints, e.g. `https://192.168.1.23:5173`.
2. Open it in Safari on the phone.
3. Accept the self-signed certificate warning ("Show Details → visit
   this website").
4. Tap **Start** and allow camera access.

First load downloads ~10 MB of MediaPipe WASM + model from the CDN; a
loading screen is shown until it's ready.

## Module structure

| File | Responsibility |
| --- | --- |
| `src/camera.ts` | getUserMedia (video only), attach to `<video>` |
| `src/tracking.ts` | HandLandmarker setup (CDN wasm/model), per-frame `detectForVideo` with timestamp/frame guards |
| `src/gesture.ts` | Scale-invariant pinch metric, hysteresis + N-frame confirmation |
| `src/renderer.ts` | PixiJS v8 app, mirror/cover coordinate mapping, landmark dots, clay ball animation |
| `src/state.ts` | Minimal typed event emitter (phase / error / debug) |
| `src/App.tsx` | UI shell, start flow, rAF loop wiring, debug panel |

## Not in this milestone

Blowing (mic), throwing, Dunhuang visual style.
