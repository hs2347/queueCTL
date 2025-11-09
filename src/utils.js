const { logError } = require("./logger");

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJobJson(input) {
  try {
    const job = JSON.parse(input);
    if (!job.command || typeof job.command !== "string") {
      throw new Error('Job JSON must have a "command" string field');
    }
    return job;
  } catch (err) {
    logError("Failed to parse job JSON:", err.message);
    process.exit(1);
  }
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toISOString();
}

module.exports = {
  nowMs,
  sleep,
  parseJobJson,
  toInt,
  formatTs,
};
