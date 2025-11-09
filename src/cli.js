const { Command } = require("commander");
const { initDb } = require("./db");
const {
  createJob,
  listJobs,
  getStateCounts,
  listDeadJobs,
  retryDeadJob,
  getJobById,
} = require("./jobRepository");
const { startWorkers, requestStopWorkers } = require("./worker");
const { getConfig, setConfig } = require("./configRepository");
const { parseJobJson, formatTs } = require("./utils");
const { logInfo, logError } = require("./logger");

initDb();

const program = new Command();
program
  .name("queuectl")
  .description("CLI-based background job queue system")
  .version("1.0.0");

program
  .command("enqueue")
  .description("Add a new job to the queue")
  .argument("<jobJson>", 'Job JSON with at least "command"')
  .action((jobJson) => {
    const data = parseJobJson(jobJson);
    const job = createJob(data);
    logInfo("Enqueued job:", job.id);
  });

program
  .command("worker:start")
  .description("Start one or more workers")
  .option("--count <n>", "Number of workers", "1")
  .option("--poll-interval <ms>", "Poll interval when idle", "500")
  .action(async (opts) => {
    const count = parseInt(opts.count, 10) || 1;
    const poll = parseInt(opts.pollInterval, 10) || 500;
    logInfo(`Starting ${count} worker(s)`);
    await startWorkers(count, poll);
  });

program
  .command("worker:stop")
  .description("Signal workers to stop gracefully")
  .action(() => {
    requestStopWorkers();
    logInfo(
      "Requested workers to stop. They will finish current jobs and exit."
    );
  });

program
  .command("status")
  .description("Show summary of job states")
  .action(() => {
    const counts = getStateCounts();
    console.log("Job Status:");
    const states = ["pending", "processing", "completed", "failed", "dead"];
    for (const s of states) {
      const c = counts[s] || 0;
      console.log(`  ${s.padEnd(10)} ${c}`);
    }
  });

program
  .command("list")
  .description("List jobs, optionally filtered by state")
  .option("--state <state>", "Filter by state")
  .action((opts) => {
    try {
      const jobs = listJobs({ state: opts.state });
      if (!jobs.length) {
        console.log("No jobs found");
        return;
      }
      console.log("id\tstate\tattempts\tmax_retries\trun_at\tcommand");
      for (const j of jobs) {
        console.log(
          `${j.id}\t${j.state}\t${j.attempts}\t${j.max_retries}\t${formatTs(
            j.run_at
          )}\t${j.command}`
        );
      }
    } catch (err) {
      logError(err.message);
      process.exit(1);
    }
  });

program
  .command("dlq:list")
  .description("List jobs in Dead Letter Queue (dead state)")
  .action(() => {
    const jobs = listDeadJobs();
    if (!jobs.length) {
      console.log("No dead jobs");
      return;
    }
    console.log("id\tattempts\tupdated_at\tlast_error\tcommand");
    for (const j of jobs) {
      console.log(
        `${j.id}\t${j.attempts}\t${formatTs(j.updated_at)}\t${(
          j.last_error || ""
        ).slice(0, 60)}\t${j.command}`
      );
    }
  });

program
  .command("dlq:retry")
  .description("Retry a job from DLQ by moving it back to pending")
  .argument("<id>", "Job id")
  .action((id) => {
    try {
      retryDeadJob(id);
      logInfo(`Moved job ${id} from DLQ to pending`);
    } catch (err) {
      logError(err.message);
      process.exit(1);
    }
  });

const configCmd = program
  .command("config")
  .description("Configuration management");

configCmd
  .command("get")
  .argument("<key>")
  .action((key) => {
    const val = getConfig(key, null);
    console.log(val === null ? "(not set)" : val);
  });

configCmd
  .command("set")
  .argument("<key>")
  .argument("<value>")
  .action((key, value) => {
    setConfig(key, value);
    logInfo(`Set ${key} = ${value}`);
  });

program
  .command("show")
  .description("Show details for a job id")
  .argument("<id>")
  .action((id) => {
    const job = getJobById(id);
    if (!job) {
      logError(`Job ${id} not found`);
      process.exit(1);
    }
    console.log(JSON.stringify(job, null, 2));
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
