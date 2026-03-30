#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = resolve(process.env.HOME, ".pi/ui/config.toml");
const BACKEND_BIN = resolve(ROOT, "backend/target/release/pi-server");

const COLORS = { backend: "\x1b[36m", web: "\x1b[35m", reset: "\x1b[0m" };

function prefix(name, data) {
  const color = COLORS[name] || "";
  const lines = data.toString().split("\n");
  for (const line of lines) {
    if (line.trim()) process.stdout.write(`${color}[${name}]${COLORS.reset} ${line}\n`);
  }
}

function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], ...opts });
  child.stdout.on("data", (d) => prefix(name, d));
  child.stderr.on("data", (d) => prefix(name, d));
  child.on("exit", (code) => {
    prefix(name, `exited with code ${code}`);
    cleanup();
  });
  return child;
}

const children = [];

function cleanup() {
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

const mode = process.argv[2] || "dev";

if (mode === "dev" || mode === "backend") {
  children.push(run("backend", BACKEND_BIN, ["-c", CONFIG]));
}

if (mode === "dev" || mode === "web") {
  children.push(run("web", "yarn", ["start", "--web"], { env: { ...process.env, BROWSER: "none" } }));
}

if (mode === "build:web") {
  children.push(run("web", "yarn", ["web:build"]));
}

if (mode === "build:backend") {
  children.push(run("backend", "cargo", ["build", "--release"], { cwd: resolve(ROOT, "backend") }));
}

if (mode === "build") {
  const web = run("web", "yarn", ["web:build"]);
  web.on("exit", (code) => {
    if (code !== 0) return cleanup();
    children.push(run("backend", "cargo", ["build", "--release"], { cwd: resolve(ROOT, "backend") }));
  });
  children.push(web);
}
