import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = resolve(frontendDir, "..");
const backendDir = resolve(projectDir, "backend");
const pythonCandidates = process.platform === "win32"
  ? [resolve(backendDir, ".venv", "Scripts", "python.exe")]
  : [resolve(backendDir, ".venv", "bin", "python")];
const python = pythonCandidates.find(existsSync);
const vite = resolve(frontendDir, "node_modules", "vite", "bin", "vite.js");

if (!python) {
  console.error("Backend virtual environment not found. Set it up once from the backend folder:");
  console.error("  py -m venv .venv");
  console.error("  .\\.venv\\Scripts\\Activate.ps1");
  console.error("  python -m pip install -r requirements.txt");
  process.exit(1);
}

if (!existsSync(vite)) {
  console.error("Vite is not installed. Run npm install from the singalong folder first.");
  process.exit(1);
}

const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = code;
}

function launch(label, command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.log(`${label} stopped${signal ? ` (${signal})` : ` with code ${code ?? 0}`}.`);
      stop(code ?? 1);
    }
  });
  return child;
}

console.log("Starting SingAlong web app and local audio service...");
launch("Audio service", python, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8001", "--reload"], backendDir);
launch("Web app", process.execPath, [vite, "--host", "127.0.0.1"], frontendDir);

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
