// src/jobRepository.js
const { v4: uuidv4 } = require("uuid");
const { withDataLocked, readData } = require("./db");
const { nowMs } = require("./utils");
const { getIntConfig } = require("./configRepository");

const VALID_STATES = ["pending", "processing", "completed", "failed", "dead"];

function createJob(data) {
  const id = data.id || uuidv4();
  const command = data.command;
  const createdAt = nowMs();
  const maxRetries =
    typeof data.max_retries === "number"
      ? data.max_retries
      : getIntConfig("max_retries", 3);

  const job = {
    id,
    command,
    state: "pending",
    attempts: 0,
    max_retries: maxRetries,
    run_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
    last_error: null,
  };

  withDataLocked((dataFile) => {
    dataFile.jobs.push(job);
  });

  return job;
}

function listJobs({ state } = {}) {
  const data = readData();
  let jobs = data.jobs.slice();
  if (state) {
    if (!VALID_STATES.includes(state)) {
      throw new Error(`Invalid state: ${state}`);
    }
    jobs = jobs.filter((j) => j.state === state);
  }
  // newest first
  jobs.sort((a, b) => b.created_at - a.created_at);
  return jobs.slice(0, 200);
}

function fetchAndMarkNextJob() {
  const now = nowMs();
  return withDataLocked((data) => {
    let selected = null;

    for (const job of data.jobs) {
      if (
        (job.state === "pending" || job.state === "failed") &&
        job.run_at <= now
      ) {
        if (!selected || job.created_at < selected.created_at) {
          selected = job;
        }
      }
    }

    if (!selected) return null;

    selected.state = "processing";
    selected.updated_at = now;

    return { ...selected };
  });
}

function markJobCompleted(id) {
  const now = nowMs();
  withDataLocked((data) => {
    const job = data.jobs.find((j) => j.id === id);
    if (!job) return;
    job.state = "completed";
    job.last_error = null;
    job.updated_at = now;
  });
}

function scheduleJobRetry(jobSnapshot, errorMessage) {
  const now = nowMs();
  return withDataLocked((data) => {
    const job = data.jobs.find((j) => j.id === jobSnapshot.id);
    if (!job) return "missing";

    const newAttempts = job.attempts + 1;
    const maxRetries = job.max_retries;
    const backoffBase = getIntConfig("backoff_base", 2);

    if (newAttempts > maxRetries) {
      job.state = "dead";
      job.attempts = newAttempts;
      job.last_error = String(errorMessage || "");
      job.updated_at = now;
      return "dead";
    }

    const delaySeconds = Math.pow(backoffBase, newAttempts);
    job.state = "failed";
    job.attempts = newAttempts;
    job.run_at = now + delaySeconds * 1000;
    job.last_error = String(errorMessage || "");
    job.updated_at = now;
    return "failed";
  });
}

function getJobById(id) {
  const data = readData();
  return data.jobs.find((j) => j.id === id) || null;
}

function getStateCounts() {
  const data = readData();
  const counts = {};
  for (const j of data.jobs) {
    counts[j.state] = (counts[j.state] || 0) + 1;
  }
  return counts;
}

function listDeadJobs() {
  const data = readData();
  return data.jobs
    .filter((j) => j.state === "dead")
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 200);
}

function retryDeadJob(id) {
  const now = nowMs();
  withDataLocked((data) => {
    const job = data.jobs.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    if (job.state !== "dead") {
      throw new Error(`Job ${id} is not dead`);
    }
    job.state = "pending";
    job.attempts = 0;
    job.run_at = now;
    job.last_error = null;
    job.updated_at = now;
  });
}

module.exports = {
  createJob,
  listJobs,
  fetchAndMarkNextJob,
  markJobCompleted,
  scheduleJobRetry,
  getJobById,
  getStateCounts,
  listDeadJobs,
  retryDeadJob,
};
