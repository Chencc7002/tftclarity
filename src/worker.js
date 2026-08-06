import { loadLocalEnvironment } from "./config/load-env.js";
import { createStorageRuntime } from "./storage/runtime.js";
import { ConclusionWorker } from "./jobs/conclusion-jobs.js";

loadLocalEnvironment();
const storage=await createStorageRuntime();
if(storage.config.processRole==="web")throw new Error("TFT_AGENT_PROCESS_ROLE=web cannot start the worker entrypoint");
const worker=new ConclusionWorker({store:storage.ephemeral,persistentStore:storage.persistent,attempts:storage.config.conclusionJobAttempts,backoffMs:storage.config.conclusionJobBackoffMs,concurrency:storage.config.workerConcurrency});
worker.start();
const shutdown=async()=>{worker.stop();await storage.store.close?.();process.exit(0);};
process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);
console.log(JSON.stringify({event:"worker_started",role:storage.config.processRole,workerId:worker.workerId}));
