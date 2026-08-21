import "dotenv/config";
import { exec } from "node:child_process";
import { TripWorker } from "./worker.js";
import { startServer } from "./server.js";

function acquireTermuxWakeLock() {
  if (process.platform === "android" || process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux")) {
    exec("termux-wake-lock", (err) => {
      if (err) {
        console.log("[power] termux-wake-lock not available or skipped:", err.message);
      } else {
        console.log("[power] termux-wake-lock acquired (Android CPU keep-awake enabled)");
      }
    });
  }
}

function releaseTermuxWakeLock() {
  if (process.platform === "android" || process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux")) {
    exec("termux-wake-unlock", () => {});
  }
}

acquireTermuxWakeLock();
const worker = new TripWorker();
await worker.start();
await startServer(worker);

const shutdown = async () => {
  releaseTermuxWakeLock();
  await worker.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

