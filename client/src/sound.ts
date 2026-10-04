// Auction sounds, synthesized with the Web Audio API: the "new player" reveal,
// the "new bid" chime and the SOLD gavel.
//
// Why no audio files: synthesized sounds ship nothing extra in the bundle,
// work offline, and never 404 on the host. The new-player sound is a whoosh
// that lands on a deep hit and a bright, ringing chord, like a broadcast
// reveal. The bid chime is a short, bright two-note ping, crisp enough to cut
// through auction-hall chatter and safe to fire back-to-back in a bidding war.
// SOLD is the big moment: a hard wooden gavel strike over a deep impact and a
// short brass stab, ringing out in a hall, the way a professional auction room
// sounds when the hammer falls.

let ctx: AudioContext | null = null;

/** iOS mutes Web Audio while the ring/silent switch is on, which on a
 *  captain's phone reads as "the bid sound is broken". Safari's Audio Session
 *  API lets a page play like a media app instead. Browsers without it skip
 *  this; every device can still mute the sounds from its own toggle. */
function preferPlaybackSession(): void {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {
    /* not supported — keep the browser default */
  }
}

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null; // ancient browser with no Web Audio — degrade silently
  if (!ctx) {
    preferPlaybackSession();
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Browsers keep a freshly-created AudioContext "suspended" until a user
 *  gesture resumes it. Call this from a real tap/click/keydown so that later,
 *  event-driven sounds — a bid or a sale arriving over the socket, with no
 *  gesture of its own — are allowed to play. Once unlocked it stays unlocked
 *  (iOS can interrupt it again after a call or a locked screen; the next tap
 *  resumes it). */
export function unlockAudio(): void {
  const ac = audioCtx();
  if (!ac || ac.state === 'running') return;
  void ac.resume().catch(() => {});
  // iOS only treats the context as unlocked once something has started
  // inside the gesture itself: a silent one-sample blip does it.
  try {
    const blip = ac.createBufferSource();
    blip.buffer = ac.createBuffer(1, 1, ac.sampleRate);
    blip.connect(ac.destination);
    blip.start();
  } catch {
    /* ignore */
  }
}

/** Lets anything listening (the end-to-end tests) know which sound fired and
 *  whether the context could actually play it. */
function announce(kind: 'draw' | 'bid' | 'sold', played: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent('dpl:sound', { detail: { kind, played } }));
  } catch {
    /* ignore */
  }
}

/** The running context, or null while it is still locked (never interacted with). */
function runningCtx(): AudioContext | null {
  const ac = audioCtx();
  if (!ac) return null;
  if (ac.state !== 'running') {
    void ac.resume().catch(() => {});
    return null; // still locked — a real gesture must unlock it first
  }
  return ac;
}

/** Play one crisp two-note bid chime. */
export function playBidSound(): void {
  const ac = runningCtx();
  announce('bid', ac !== null);
  if (ac) scheduleBid(ac, ac.destination, ac.currentTime);
}

/** Play the SOLD gavel. */
export function playSoldSound(): void {
  const ac = runningCtx();
  announce('sold', ac !== null);
  if (ac) scheduleSold(ac, ac.destination, ac.currentTime + 0.01);
}

/** Play the new-player reveal. */
export function playDrawSound(): void {
  const ac = runningCtx();
  announce('draw', ac !== null);
  if (ac) scheduleDraw(ac, ac.destination, ac.currentTime + 0.01);
}

// ---- the sounds themselves -------------------------------------------------
// Each schedules onto any context (live or offline) from t0, so the same
// code can be rendered to a file for listening tests.

export function scheduleBid(ac: BaseAudioContext, dest: AudioNode, t0: number): void {
  // Master gain keeps overlapping pings well below clipping.
  const out = ac.createGain();
  out.gain.value = 0.6;
  out.connect(dest);

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

/** Overall SOLD level after the glue compressor (tuned by rendering it). */
const SOLD_MAKEUP = 1.45;

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const hallCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise, made once per context. */
function noise(ac: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ac);
  if (!buf) {
    buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, buf);
  }
  return buf;
}

/** A synthetic hall: 2.8 seconds of decaying stereo noise, used as a reverb
 *  impulse response so the gavel rings out like a big auction room. */
function hall(ac: BaseAudioContext): AudioBuffer {
  let buf = hallCache.get(ac);
  if (!buf) {
    const seconds = 2.8;
    const len = Math.floor(ac.sampleRate * seconds);
    buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
      }
    }
    hallCache.set(ac, buf);
  }
  return buf;
}

/** A burst of filtered noise with a fast attack and an exponential decay. */
function noiseHit(ac: BaseAudioContext, out: AudioNode, t0: number, opts: {
  type: BiquadFilterType; freq: number; q: number; gain: number; decay: number;
}): void {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  src.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.decay);
  src.connect(filter);
  filter.connect(g);
  g.connect(out);
  src.start(t0);
  src.stop(t0 + opts.decay + 0.05);
}

/** A sine that drops in pitch while it decays: struck wood, or a deep thud. */
function tone(ac: BaseAudioContext, out: AudioNode, t0: number, opts: {
  from: number; to: number; glide: number; gain: number; decay: number; type?: OscillatorType;
}): void {
  const osc = ac.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.from, t0);
  osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.glide);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.decay);
  osc.connect(g);
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + opts.decay + 0.05);
}

/** Master bus for the big sounds: a compressor glues the layers, make-up gain
 *  brings the whole hit up, and a fast limiter keeps the peak clear of clipping. */
function masterBus(ac: BaseAudioContext, dest: AudioNode, makeupGain: number): GainNode {
  const master = ac.createGain();
  master.gain.value = 1;
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 6;
  glue.ratio.value = 4;
  glue.attack.value = 0.003;
  glue.release.value = 0.35;
  const makeup = ac.createGain();
  makeup.gain.value = makeupGain;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  master.connect(glue);
  glue.connect(makeup);
  makeup.connect(limiter);
  limiter.connect(dest);
  return master;
}

/** The room: a hall reverb returning into `master` at the given wet level. */
function hallSend(ac: BaseAudioContext, master: AudioNode, wet: number): ConvolverNode {
  const room = ac.createConvolver();
  room.buffer = hall(ac);
  const roomLevel = ac.createGain();
  roomLevel.gain.value = wet;
  room.connect(roomLevel);
  roomLevel.connect(master);
  return room;
}

/** Overall level of the new-player sound (tuned by rendering it). */
const DRAW_MAKEUP = 1.1;
/** Where the new-player hit lands after the whoosh starts. The projector's
 *  reveal raises the name on the same beat (screen.css, .scr-reveal). */
const DRAW_HIT = 0.4;

export function scheduleDraw(ac: BaseAudioContext, dest: AudioNode, t0: number): void {
  const master = masterBus(ac, dest, DRAW_MAKEUP);
  const room = hallSend(ac, master, 0.3);
  const hit = t0 + DRAW_HIT;

  // 1. The whoosh: air through a band that sweeps up and swells into the hit,
  //    flying across the stereo field where the browser can pan, over a
  //    rising tone that gives it pitch.
  const whoosh = ac.createGain();
  whoosh.gain.value = 1;
  const pan = typeof ac.createStereoPanner === 'function' ? ac.createStereoPanner() : null;
  if (pan) {
    pan.pan.setValueAtTime(-0.7, t0);
    pan.pan.linearRampToValueAtTime(0.7, hit);
    whoosh.connect(pan);
    pan.connect(master);
  } else {
    whoosh.connect(master);
  }
  whoosh.connect(room);
  const air = ac.createBufferSource();
  air.buffer = noise(ac);
  air.loop = true;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(300, t0);
  band.frequency.exponentialRampToValueAtTime(5200, hit);
  const swell = ac.createGain();
  swell.gain.setValueAtTime(0.0001, t0);
  swell.gain.exponentialRampToValueAtTime(0.7, hit - 0.03);
  swell.gain.exponentialRampToValueAtTime(0.0001, hit + 0.06);
  air.connect(band);
  band.connect(swell);
  swell.connect(whoosh);
  air.start(t0);
  air.stop(hit + 0.1);
  const riser = ac.createOscillator();
  riser.type = 'sine';
  riser.frequency.setValueAtTime(160, t0);
  riser.frequency.exponentialRampToValueAtTime(640, hit);
  const riserLevel = ac.createGain();
  riserLevel.gain.setValueAtTime(0.0001, t0);
  riserLevel.gain.exponentialRampToValueAtTime(0.14, hit - 0.02);
  riserLevel.gain.exponentialRampToValueAtTime(0.0001, hit + 0.05);
  riser.connect(riserLevel);
  riserLevel.connect(whoosh);
  riser.start(t0);
  riser.stop(hit + 0.1);

  // 2. The hit: a deep thump and a snappy crack for the room speakers, a
  //    spray of air into the hall, and a bright A-major chord, lightly strummed
  //    and bell-like, that carries on phone and laptop speakers.
  tone(ac, master, hit, { from: 150, to: 46, glide: 0.22, gain: 0.95, decay: 0.5 });
  noiseHit(ac, master, hit, { type: 'lowpass', freq: 2600, q: 0.8, gain: 0.55, decay: 0.12 });
  noiseHit(ac, room, hit, { type: 'highpass', freq: 6000, q: 0.5, gain: 0.25, decay: 0.9 });
  const bell = ac.createGain();
  bell.gain.value = 1;
  bell.connect(master);
  bell.connect(room);
  const chord = [880, 1108.73, 1318.51, 1760]; // A5 C#6 E6 A6
  chord.forEach((f, i) => {
    const at = hit + i * 0.012;
    tone(ac, bell, at, { from: f, to: f, glide: 0.01, gain: 0.16, decay: 1.1, type: 'triangle' });
    // a slightly stretched octave on top makes it ring like a bell
    tone(ac, bell, at, { from: f * 2.01, to: f * 2.01, glide: 0.01, gain: 0.05, decay: 0.5 });
  });
}

export function scheduleSold(ac: BaseAudioContext, dest: AudioNode, t0: number): void {
  const master = masterBus(ac, dest, SOLD_MAKEUP);
  // The room: everything sends into one hall reverb.
  const room = hallSend(ac, master, 0.4);

  // 1. The gavel: a sharp crack, the hollow "tok" of the hardwood block
  //    (three damped wood modes) and the thump of the blow behind it.
  const gavel = ac.createGain();
  gavel.gain.value = 1;
  gavel.connect(master);
  gavel.connect(room);
  noiseHit(ac, gavel, t0, { type: 'bandpass', freq: 2600, q: 1.1, gain: 1, decay: 0.05 });
  noiseHit(ac, gavel, t0, { type: 'bandpass', freq: 950, q: 2.5, gain: 1, decay: 0.12 });
  tone(ac, gavel, t0, { from: 560, to: 520, glide: 0.05, gain: 0.7, decay: 0.14 });
  tone(ac, gavel, t0, { from: 1190, to: 1120, glide: 0.04, gain: 0.45, decay: 0.08 });
  tone(ac, gavel, t0, { from: 1960, to: 1880, glide: 0.03, gain: 0.3, decay: 0.05 });
  tone(ac, gavel, t0, { from: 180, to: 72, glide: 0.09, gain: 0.9, decay: 0.25 });

  // 2. The impact underneath: a deep falling boom and a short low rumble,
  //    for the room speakers.
  tone(ac, master, t0, { from: 110, to: 38, glide: 0.9, gain: 0.75, decay: 1.8 });
  noiseHit(ac, master, t0, { type: 'lowpass', freq: 200, q: 0.7, gain: 0.4, decay: 0.9 });

  // 3. A crash cymbal: the bright wash that carries the hit on phone and
  //    laptop speakers, which cannot play the boom.
  noiseHit(ac, room, t0, { type: 'highpass', freq: 5000, q: 0.5, gain: 0.3, decay: 2.2 });
  noiseHit(ac, master, t0, { type: 'highpass', freq: 5000, q: 0.5, gain: 0.32, decay: 2.0 });

  // 4. A brass stab: a bright D-major chord of detuned saws behind a filter
  //    that snaps open, held for a beat, then let ring into the hall.
  const stab = ac.createGain();
  stab.gain.setValueAtTime(0.0001, t0);
  stab.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
  stab.gain.setValueAtTime(0.9, t0 + 0.55);
  stab.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1);
  const brass = ac.createBiquadFilter();
  brass.type = 'lowpass';
  brass.Q.value = 1.4;
  brass.frequency.setValueAtTime(500, t0);
  brass.frequency.exponentialRampToValueAtTime(3800, t0 + 0.06);
  brass.frequency.exponentialRampToValueAtTime(1700, t0 + 0.9);
  brass.connect(stab);
  stab.connect(master);
  stab.connect(room);
  const chord = [146.83, 220, 293.66, 369.99, 440]; // D3 A3 D4 F#4 A4
  for (const f of chord) {
    for (const cents of [-7, 7]) {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = cents;
      const g = ac.createGain();
      g.gain.value = 0.055;
      osc.connect(g);
      g.connect(brass);
      osc.start(t0);
      osc.stop(t0 + 2.2);
    }
  }
}
