import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [resolve(frontend, "node_modules/vite/bin/vite.js"), "--host", "localhost"], {
  cwd: frontend,
  stdio: "inherit",
  env: { ...process.env, VITE_DEMO_MODE: "true" },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
