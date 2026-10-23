import crypto from "crypto";

/**
 * Calculates a deterministic pseudo-random jitter for an email slot.
 * Returns an extra delay in milliseconds in the range [0, (jitterPct / 100) * baseGapMs].
 *
 * Guaranteed properties:
 * 1. Deterministic: identical (seed, seq) always yields the exact same value.
 * 2. Non-negative: jitter >= 0, so the base minimum gap is NEVER violated.
 */
export function getDeterministicJitter(
  seed: string,
  seq: number,
  baseGapMs: number,
  jitterPct: number
): number {
  if (jitterPct <= 0 || baseGapMs <= 0) {
    return 0;
  }

  const hash = crypto
    .createHash("sha256")
    .update(`${seed}:${seq}`)
    .digest();

  // Read first 4 bytes as unsigned 32-bit integer and normalize to [0, 1)
  const uint = hash.readUInt32BE(0);
  const factor = uint / 0xffffffff;

  const maxJitter = (jitterPct / 100) * baseGapMs;
  return Math.floor(factor * maxJitter);
}
