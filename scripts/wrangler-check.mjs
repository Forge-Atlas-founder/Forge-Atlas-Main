import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const mode = process.argv[2];

const commands = {
  worker: ["deploy", "--dry-run", "--config", "workers/api/wrangler.toml", "--outdir", ".wrangler/worker-dry-run"],
  pages: ["pages", "functions", "build", "functions", "--outdir", ".wrangler/pages-functions", "--output-routes-path", ".wrangler/pages-routes.json", "--compatibility-date", "2026-07-13"]
};

if (!commands[mode]) {
  console.error("Use wrangler-check.mjs with either worker or pages.");
  process.exit(2);
}

const env = { ...process.env, WRANGLER_SEND_METRICS: "false", XDG_CONFIG_HOME: path.join(root, ".wrangler", "config") };
for (const key of [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
  "NODE_USE_ENV_PROXY", "NPM_CONFIG_PROXY", "NPM_CONFIG_HTTP_PROXY", "NPM_CONFIG_HTTPS_PROXY",
  "npm_config_proxy", "npm_config_http_proxy", "npm_config_https_proxy"
]) delete env[key];

const result = spawnSync(executable, commands[mode], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) {
  console.error(`Wrangler could not start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
