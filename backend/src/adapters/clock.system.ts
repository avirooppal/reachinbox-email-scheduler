import { Clock } from "../core/ports.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}

export const systemClock = new SystemClock();
