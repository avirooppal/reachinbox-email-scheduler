import client from "prom-client";

// Create Prometheus registry
export const register = new client.Registry();

// Enable default system metrics
client.collectDefaultMetrics({ register, prefix: "outbox_" });

// Custom domain metrics
export const emailsSentCounter = new client.Counter({
  name: "outbox_emails_sent_total",
  help: "Total emails successfully sent",
  labelNames: ["sender_id"],
  registers: [register]
});

export const emailsFailedCounter = new client.Counter({
  name: "outbox_emails_failed_total",
  help: "Total emails permanently failed",
  labelNames: ["sender_id", "reason"],
  registers: [register]
});

export const emailsRescheduledCounter = new client.Counter({
  name: "outbox_emails_rescheduled_total",
  help: "Total email jobs postponed by rate limit or minimum delay",
  labelNames: ["sender_id", "reason"],
  registers: [register]
});

export const rateLimitHitsCounter = new client.Counter({
  name: "outbox_rate_limit_hits_total",
  help: "Count of times an hourly rate cap was hit",
  labelNames: ["sender_id"],
  registers: [register]
});

export const senderFailoversCounter = new client.Counter({
  name: "outbox_sender_failovers_total",
  help: "Count of email delivery failovers between senders",
  labelNames: ["from_sender_id", "to_sender_id"],
  registers: [register]
});

export const queueDepthGauge = new client.Gauge({
  name: "outbox_queue_depth",
  help: "Current number of delayed or waiting jobs in queue",
  labelNames: ["queue_name", "status"],
  registers: [register]
});
