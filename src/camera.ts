// Camera acquisition. Must be called from a user gesture (the Start
// button) — iOS Safari rejects getUserMedia/play() outside one.
//
// NOTE: audio is explicitly false. Milestone 2 will add Web Audio API
// blow detection (AnalyserNode on a mic MediaStream), but Milestone 1
// must never trigger a microphone permission prompt.

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API unavailable — use HTTPS or localhost.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  video.srcObject = stream;

  // Wait until dimensions are known so downstream coordinate mapping
  // (object-fit: cover math) has real videoWidth/videoHeight.
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  await video.play();
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
