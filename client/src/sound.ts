// Auction "new bid" chime, synthesized with the Web Audio API.
//
// Why no audio file: a synthesized ping ships nothing extra in the bundle,
// works offline, and never 404s on the free-tier host. The tone is a short,
// bright two-note chime — crisp enough to cut through auction-hall chatter
// without being harsh, and safe to fire back-to-back during a bidding war.

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null; // ancient browser with no Web Audio — degrade silently
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Browsers keep a freshly-created AudioContext "suspended" until a user
 *  gesture resumes it. Call this from a real click/keydown so that later,
 *  event-driven pings — a captain's bid arriving over the socket, with no
 *  gesture of its own — are allowed to sound. Once unlocked it stays unlocked. */
export function unlockAudio(): void {
  const ac = audioCtx();
  if (ac && ac.state === 'suspended') void ac.resume();
}

/** Play one crisp two-note bid chime. No-op if Web Audio is unavailable or the
 *  context is still locked (never interacted with). */
export function playBidSound(): void {
  const ac = audioCtx();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();
  if (ac.state !== 'running') return; // still locked — a real gesture must unlock first

  const t0 = ac.currentTime;

  // Master gain keeps overlapping pings well below clipping.
  const out = ac.createGain();
  out.gain.value = 0.6;
  out.connect(ac.destination);

  // Two quick rising notes read as a deliberate "alert", not a flat beep.
  const notes = [
    { freq: 784, at: 0, dur: 0.16 },    // G5
    { freq: 1175, at: 0.075, dur: 0.20 }, // D6
  ];
  for (const n of notes) {
    const start = t0 + n.at;
    const osc = ac.createOscillator();
    osc.type = 'triangle'; // rounder than a square wave, still bright
    osc.frequency.setValueAtTime(n.freq, start);

    // Fast attack + exponential decay = a struck-chime shape, not a hum.
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.9, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);

    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(start + n.dur + 0.02);
  }
}
