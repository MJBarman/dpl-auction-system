// The server's clock, as this device can best tell it.
//
// Every countdown (the hammer timer, the 30 seconds for a guess, the timeout)
// ends at a moment on the server's clock, and a phone's own clock can be
// minutes off. Each state the server sends carries its time, so the gap is
// measured as states arrive — once, here, at the moment of arrival. Measuring
// it later, when a countdown happens to appear on screen, would use a state
// that may be many seconds old and make the countdown read too long.

let skew: number | null = null; // this device's clock minus the server's, in ms

/** Call when a state has just arrived, with the time the server stamped on it. */
export function noteServerTime(serverTime: unknown): void {
  if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) return;
  const sample = Date.now() - serverTime; // the real gap plus the time spent on the way
  // The smallest sample spent least time on the way, so it is the truest one.
  // A sample several seconds from what we hold means this device's clock was
  // changed (or the first samples were very late): start again from it.
  skew = skew === null || Math.abs(sample - skew) > 5000 ? sample : Math.min(skew, sample);
}

/** The time on the server's clock right now. */
export function serverNow(): number {
  return Date.now() - (skew ?? 0);
}
