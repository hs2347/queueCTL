# queuectl

A minimal, production-flavoured **CLI-based background job queue system**.

`queuectl` lets you:

- Enqueue shell commands as background jobs
- Run one or more workers to execute jobs
- Retry failed jobs with **exponential backoff**
- Move permanently failing jobs into a **Dead Letter Queue (DLQ)**
- Persist all job data across restarts (JSON file storage)
- Inspect, list, and re-drive jobs via a clean CLI

Designed to match the assignment requirements while keeping the code small, readable, and easy to reason about.

---

## Features Overview

✅ CLI tool: `queuectl`  
✅ Persistent storage (JSON file `queue.json`)  
✅ Multiple workers (`--count`)  
✅ Atomic job claiming to avoid duplicate execution  
✅ Retry mechanism with exponential backoff  
✅ Dead Letter Queue (DLQ) + `dlq:retry`  
✅ Configuration via CLI (`max_retries`, `backoff_base`)  
✅ Graceful shutdown of workers  
✅ Basic status & listing commands  
✅ Clear separation of concerns

> Note: Storage is implemented using a lock-protected JSON file instead of SQLite for portability and zero native build issues. This still meets the "persistent job storage" requirement.

---

## Project Structure

```text
queuectl/
  package.json
  bin/
    queuectl          # CLI entrypoint (shebang)
  src/
    cli.js            # Command-line interface definitions
    db.js             # JSON storage + locking + recovery
    configRepository.js
    jobRepository.js  # Job CRUD, lifecycle transitions
    worker.js         # Worker loop and execution logic
    logger.js
    utils.js
  README.md
  queue.json          # Auto-created data file (jobs + config)
```

## Installation & Setup

### Prerequisites

- Node.js **v18+** (tested on Node 22)
- `npm`

### Steps

```bash
git clone <your-repo-url> queuectl
cd queuectl

npm install
chmod +x bin/queuectl
npm link        # optional; installs `queuectl` as a local global command
```

### Enqueue a Job

Add a job by passing a JSON payload (must include command):

```bash
queuectl enqueue '{"command":"echo Hello from queue"}'
```

#### Optional fields:

- `id` — custom job id (otherwise a UUID is generated)
- `max_retries` — override default retry count for this job

**Example:**

```bash
queuectl enqueue '{"id":"job-1","command":"echo hi","max_retries":5}'
```

This creates a job with:

- `state = "pending"`
- `attempts = 0`
- `run_at = now`

### Start Workers

Start one or more workers to process jobs:

```bash
queuectl worker:start --count 3
```

**Behavior:**

Each worker:

- polls for jobs in pending / eligible failed state
- atomically claims one job and marks it processing
- executes the job's command using the system shell
- updates job to completed, failed, or dead

Workers keep running, waiting for new jobs.

#### Stop workers gracefully:

- In the same terminal: **Ctrl + C**

Or from another terminal:

```bash
queuectl worker:stop
```

Workers finish their current job before exiting.

### Check Status

Show counts of jobs in each state:

```bash
queuectl status
```

**Example:**

```
Job Status:
pending 1
processing 0
completed 3
failed 0
dead 1
```

### List Jobs

List all jobs:

```bash
queuectl list
```

#### Filter by state:

```bash
queuectl list --state pending
queuectl list --state completed
queuectl list --state dead
```

#### Inspect a single job:

```bash
queuectl show <job-id>
```

### Dead Letter Queue (DLQ)

Jobs that exceed max_retries are marked dead and form the DLQ.

#### List DLQ jobs:

```bash
queuectl dlq:list
```

#### Retry a DLQ job:

```bash
queuectl dlq:retry <job-id>
```

This moves the job to:

- `state = "pending"`
- `attempts = 0`
- `run_at = now`

Workers will then pick it up again.

### Configuration

Configuration is stored inside queue.json under config and controlled via:

```bash
queuectl config get <key>
queuectl config set <key> <value>
```

#### Supported keys:

- `max_retries` — default maximum retries per job (if job doesn't override)
- `backoff_base` — base for exponential backoff
- `(internal) workers_stop` — used to signal workers to stop

#### Examples:

```bash
queuectl config set max_retries 3
queuectl config set backoff_base 2
queuectl config get max_retries
```

If a job includes its own max_retries, that value is used instead of the global one.

## Architecture Overview

### Job Model

Each job in queue.json looks like:

```json
{
  "id": "uuid-or-custom",
  "command": "echo 'Hello'",
  "state": "pending | processing | completed | failed | dead",
  "attempts": 0,
  "max_retries": 3,
  "run_at": 1730899200000,
  "created_at": 1730899200000,
  "updated_at": 1730899200000,
  "last_error": null
}
```

### Lifecycle

#### Enqueue

- `state = "pending"`, `attempts = 0`, `run_at = now`.

#### Worker Claim

Under a file lock, a worker:

- finds the oldest eligible job (pending / failed with run_at <= now)
- marks it processing
- returns it to execute.

#### Execute

Command is run using child_process.spawn with shell: true.

#### On Success

- `state = "completed"`
- `last_error = null`

#### On Failure

- `attempts++`

If attempts > max_retries:

- `state = "dead"`
- job is visible in DLQ.

Else:

- `state = "failed"`
- `run_at = now + backoff_delay`
- `last_error` recorded

#### DLQ Retry

`dlq:retry`:

- `state = "pending"`
- `attempts = 0`
- `run_at = now`
- clears `last_error`

### Exponential Backoff

For failure attempt n (1-based), using backoff_base = b:

- `delay_seconds = b ^ n`

**Example with b = 2:**

- 1st failure → 2s
- 2nd failure → 4s
- 3rd failure → 8s

then DLQ once attempts > max_retries

### Persistence & Locking

All state is stored in queue.json:

- `jobs`: all jobs
- `config`: global settings

Writes go through a simple lock file queue.json.lock via withDataLocked:

- prevents concurrent write corruption
- suitable for a single-node CLI + worker model

On worker startup only:

- any processing jobs left over from a crash are recovered back to pending
- ensures no job is stuck indefinitely in processing.

### Worker Concurrency & Safety

Multiple workers share the same storage.

`fetchAndMarkNextJob`:

- runs under lock
- picks exactly one job
- marks it processing before returning.

This ensures:

- no duplicate execution
- at-most-once semantics for each job in this single-node design.

### Graceful Shutdown

Ctrl + C in worker process or `queuectl worker:stop`:

- sets a stop flag (workers_stop).

workers:

- finish current job
- stop polling
- exit cleanly.

## Testing Instructions

These manual tests demonstrate correctness and match the assignment's scenarios.

### 1. Basic Success

```bash
queuectl enqueue '{"command":"echo ok"}'
queuectl worker:start --count 1
```

**Expect:** job transitions pending → processing → completed.

**Check:**

```bash
queuectl status
```

### 2. Automatic Retries + DLQ

```bash
queuectl config set max_retries 2
queuectl config set backoff_base 2
queuectl enqueue '{"command":"powershell -Command \"exit 1\""}'
queuectl worker:start --count 1
```

**Expect:**

- Worker logs multiple failures.
- After retries, job state = "dead".
- Visible via:

```bash
queuectl dlq:list
```

### 3. DLQ Retry

```bash
queuectl dlq:list # note a dead job id
queuectl dlq:retry <id>
queuectl show <id> # state = pending, attempts = 0
queuectl worker:start --count 1
```

**Expect:** job is re-attempted according to retry rules.

### 4. Multiple Workers, No Duplicates

```bash
for i in $(seq 1 10); do
  queuectl enqueue "{\"command\":\"echo job-$i\"}";
done

queuectl worker:start --count 3
```

**Expect:**

- All 10 jobs end up completed.
- No job is picked twice in logs.
- `queuectl status` → completed = 10, no unexpected failed/dead.

### 5. Invalid Command Handling

```bash
queuectl enqueue '{"command":"this_command_does_not_exist_123"}'
queuectl worker:start --count 1
```

**Expect:**

- Worker logs failure.
- Job is retried up to max_retries.
- Ends in dead (visible in DLQ).
- No crash of the worker or CLI.

### 6. Invalid Input Handling

```bash
queuectl enqueue 'not-json'
```

**Expect:**

- Clear error message.
- No job created.

### 7. Crash Recovery

```bash
queuectl enqueue '{"id":"crash-test","command":"powershell -Command \"Start-Sleep -Seconds 20\""}'
queuectl worker:start --count 1
```

# once "picked job crash-test" appears, terminate the worker process abruptly

**Then:**

```bash
queuectl worker:start --count 1
queuectl show crash-test
```

**Expect:**

- On restart, processing job is recovered to pending.
- Worker picks and completes it.
- No job stays stuck as processing.

### 8. Graceful Shutdown

```bash
queuectl enqueue '{"command":"powershell -Command \"Start-Sleep -Seconds 5\""}'
queuectl worker:start --count 1
```

# during run, press Ctrl + C

**Expect:**

- Logs indicate stop requested.
- Worker finishes the current job, then exits.
- Job is completed.
