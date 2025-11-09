const fs = require("fs");
const path = require("path");
const { nowMs } = require("./utils");
const { logInfo } = require("./logger");

const DATA_FILE = path.join(__dirname, "..", "queue.json");
const LOCK_FILE = DATA_FILE + ".lock";

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      jobs: [],
      config: {
        max_retries: "3",
        backoff_base: "2",
        workers_stop: "0",
      },
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    logInfo("Initialized new queue.json");
  }
}

function acquireLock(retries = 50, delayMs = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      return fd;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  throw new Error("Could not acquire file lock");
}

function releaseLock(fd) {
  try {
    fs.closeSync(fd);
  } catch (_) {}
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch (_) {}
}

function readDataUnsafe() {
  if (!fs.existsSync(DATA_FILE)) {
    ensureDataFile();
  }
  const raw = fs.readFileSync(DATA_FILE, "utf8") || "{}";
  try {
    const data = JSON.parse(raw);
    if (!data.jobs) data.jobs = [];
    if (!data.config) data.config = {};
    return data;
  } catch (e) {
    throw new Error("Failed to parse queue.json: " + e.message);
  }
}

function writeDataUnsafe(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function withDataLocked(mutatorFn) {
  ensureDataFile();
  const fd = acquireLock();
  try {
    const data = readDataUnsafe();
    const result = mutatorFn(data);
    writeDataUnsafe(data);
    return result;
  } finally {
    releaseLock(fd);
  }
}

function readData() {
  ensureDataFile();
  return readDataUnsafe();
}

function recoverProcessingJobs() {
  withDataLocked((data) => {
    let changed = 0;
    const now = nowMs();
    for (const job of data.jobs) {
      if (job.state === "processing") {
        job.state = "pending";
        job.updated_at = now;
        changed++;
      }
    }
    if (changed > 0) {
      logInfo(`Recovered ${changed} processing jobs back to pending`);
    }
  });
}

function initDb() {
  ensureDataFile();
}

module.exports = {
  initDb,
  withDataLocked,
  readData,
  recoverProcessingJobs,
};
