const { spawn } = require("child_process");
const {
  fetchAndMarkNextJob,
  markJobCompleted,
  scheduleJobRetry,
} = require("./jobRepository");
const { sleep } = require("./utils");
const { getBoolConfig, setConfig } = require("./configRepository");
const { logInfo, logWarn, logError } = require("./logger");
const { recoverProcessingJobs } = require("./db");

let localStopFlag = false;

function requestStopWorkers() {
  localStopFlag = true;
  setConfig("workers_stop", "1");
}

function shouldStop() {
  const globalStop = getBoolConfig("workers_stop", false);
  return localStopFlag || globalStop;
}

async function runWorkerLoop(workerId, pollIntervalMs = 500) {
  logInfo(`Worker ${workerId} started`);

  while (!shouldStop()) {
    const job = fetchAndMarkNextJob();
    if (!job) {
      await sleep(pollIntervalMs);
      continue;
    }

    logInfo(`Worker ${workerId} picked job ${job.id}: ${job.command}`);

    try {
      const exitCode = await executeCommand(job.command);
      if (exitCode === 0) {
        markJobCompleted(job.id);
        logInfo(`Worker ${workerId} completed job ${job.id}`);
      } else {
        const state = scheduleJobRetry(job, `Exit code ${exitCode}`);
        logWarn(
          `Worker ${workerId} job ${job.id} failed with exit code ${exitCode}, state now: ${state}`
        );
      }
    } catch (err) {
      const state = scheduleJobRetry(job, err.message);
      logError(
        `Worker ${workerId} error running job ${job.id}: ${err.message}, state now: ${state}`
      );
    }
  }

  logInfo(`Worker ${workerId} stopping gracefully`);
}

function executeCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: "ignore",
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve(code));
  });
}

async function startWorkers(count, pollIntervalMs = 500) {
  setConfig("workers_stop", "0");
  localStopFlag = false;

  recoverProcessingJobs();

  const workers = [];
  for (let i = 0; i < count; i++) {
    workers.push(runWorkerLoop(i + 1, pollIntervalMs));
  }

  process.on("SIGINT", () => {
    logInfo("SIGINT received, requesting workers to stop...");
    requestStopWorkers();
  });
  process.on("SIGTERM", () => {
    logInfo("SIGTERM received, requesting workers to stop...");
    requestStopWorkers();
  });

  await Promise.all(workers);
  logInfo("All workers stopped");
}

module.exports = {
  startWorkers,
  requestStopWorkers,
};
