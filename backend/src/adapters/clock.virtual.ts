import { Clock } from "../core/ports.js";

/**
 * VIRTUAL CLOCK ADAPTER
 * Injects deterministic virtual time into domain functions,
 * enabling multi-day simulations to execute in seconds.
 */
export class VirtualClock implements Clock {
  private currentMs: number;

  constructor(initialTime: Date | number = Date.now()) {
    this.currentMs = typeof initialTime === "number" ? initialTime : initialTime.getTime();
  }

  setTime(time: Date | number): void {
    this.currentMs = typeof time === "number" ? time : time.getTime();
  }

  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }
}
