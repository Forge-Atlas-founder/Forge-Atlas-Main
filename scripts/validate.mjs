import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import platform from "../config/platform.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function tags(html, name) {
  if (name === "*") return html.match(/<[A-Za-z][^>]*>/g) || [];
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function routeFile(route) {
  if (route === "/") return path.join(dist, "index.html");
  return path.join(dist, route.replace(/^\//, ""), "index.html");
}

function localTarget(value) {
  const clean = value.split("#")[0].split("?")[0];
  if (!clean || clean.startsWith("#") || clean.startsWith("/api/")) return null;
  const relative = clean.replace(/^\//, "");
  if (!relative) return path.join(dist, "index.html");
  if (clean.endsWith("/")) return path.join(dist, relative, "index.html");
  return path.join(dist, relative);
}

check(fs.existsSync(dist), "dist/ is missing; run npm run build first.");

for (const page of platform.pages) {
  const file = routeFile(page.url);
  check(fs.existsSync(file), `Missing canonical page: ${page.url}`);
}

const htmlFiles = walk(dist).filter((file) => file.endsWith(".html"));
for (const file of htmlFiles) {
  const relative = path.relative(root, file);
  const html = read(file);
  const ids = tags(html, "*").map((tag) => attribute(tag, "id")).filter(Boolean);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
  const descriptionTag = tags(html, "meta").find((tag) => attribute(tag, "name").toLowerCase() === "description") || "";
  const description = attribute(descriptionTag, "content");
  const canonicalTag = tags(html, "link").find((tag) => attribute(tag, "rel").toLowerCase().split(/\s+/).includes("canonical")) || "";
  const canonical = attribute(canonicalTag, "href");

  check((html.match(/<h1\b/gi) || []).length === 1, `${relative}: expected exactly one H1.`);
  check(title.length >= 10 && title.length <= 70, `${relative}: title length is ${title.length}; expected 10–70.`);
  check(description.length >= 50 && description.length <= 160, `${relative}: description length is ${description.length}; expected 50–160.`);
  check(/^https:\/\/forge-atlas\.io(?:\/|$)/.test(canonical), `${relative}: canonical URL is missing or not absolute HTTPS.`);
  check(/<html\b[^>]*\blang="en"/i.test(html), `${relative}: html lang="en" is missing.`);
  check(duplicateIds.length === 0, `${relative}: duplicate IDs: ${[...new Set(duplicateIds)].join(", ")}.`);
  check(!/\sstyle\s*=/i.test(html), `${relative}: inline style attribute found.`);
  check(!/\son[a-z]+\s*=/i.test(html), `${relative}: inline event handler found.`);
  check(!/<script\b(?![^>]*\bsrc\s*=)/i.test(html), `${relative}: inline script found.`);
  check(!tags(html, "a").some((tag) => /\.html(?:[?#]|$)/i.test(attribute(tag, "href"))), `${relative}: internal navigation uses a .html URL.`);
  check(!/(?:href|src)="http:\/\//i.test(html), `${relative}: insecure HTTP resource found.`);

  for (const tag of [...tags(html, "a"), ...tags(html, "link"), ...tags(html, "script"), ...tags(html, "img")]) {
    const value = attribute(tag, tag.toLowerCase().startsWith("<a") || tag.toLowerCase().startsWith("<link") ? "href" : "src");
    if (!value || /^(?:https?:|mailto:|tel:|data:|#)/i.test(value)) continue;
    const target = localTarget(value);
    if (target) check(fs.existsSync(target), `${relative}: missing local target ${value}.`);
  }

  for (const tag of [...tags(html, "img")]) {
    check(Boolean(attribute(tag, "alt")), `${relative}: image without alt text.`);
  }

  for (const tag of [...tags(html, "button")]) {
    check(Boolean(attribute(tag, "type")), `${relative}: button without an explicit type.`);
  }
}

for (const page of platform.pages) {
  const html = read(routeFile(page.url));
  const canonical = attribute(tags(html, "link").find((tag) => attribute(tag, "rel").toLowerCase().includes("canonical")) || "", "href");
  check(canonical === `${platform.baseUrl}${page.url}`, `${page.url}: canonical does not match platform config.`);
}

const sitemap = read(path.join(dist, "sitemap.xml"));
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expectedUrls = platform.pages.map((page) => `${platform.baseUrl}${page.url}`);
check(JSON.stringify(sitemapUrls) === JSON.stringify(expectedUrls), "sitemap.xml does not exactly match config/platform.json.");

const robots = read(path.join(dist, "robots.txt"));
check(robots.includes(`Sitemap: ${platform.baseUrl}/sitemap.xml`), "robots.txt does not contain the absolute canonical sitemap URL.");
check(robots.includes("Disallow: /api/"), "robots.txt must keep API routes out of search crawling.");
check(robots.includes("Disallow: /cdn-cgi/"), "robots.txt must keep Cloudflare utility routes out of search crawling.");

const notFound = read(path.join(dist, "404.html"));
check(/<meta\s+name="robots"\s+content="noindex, nofollow">/i.test(notFound), "404.html must be noindex, nofollow.");

const llms = read(path.join(dist, "llms.txt"));
check(llms.startsWith("# Forge Atlas\n"), "llms.txt must begin with one H1 heading.");
check(!/\b(?:undefined|null)\b/i.test(llms), "llms.txt contains an unresolved value.");

const headers = read(path.join(dist, "_headers"));
check(headers.includes("Content-Security-Policy:"), "_headers is missing Content-Security-Policy.");
check(!headers.includes("'unsafe-inline'"), "Content-Security-Policy allows unsafe-inline.");
check(headers.includes("frame-ancestors 'none'"), "Content-Security-Policy must block framing.");
check(headers.includes("payment=()"), "Permissions-Policy must disable payment access while checkout is paused.");
check(headers.includes("Strict-Transport-Security:"), "_headers is missing HSTS.");

const routes = JSON.parse(read(path.join(dist, "_routes.json")));
check(JSON.stringify(routes.include) === JSON.stringify(["/api/*"]), "_routes.json must restrict Functions to /api/*.");
check(JSON.stringify(routes.exclude) === JSON.stringify([]), "_routes.json contains unexpected exclusions.");

const redirects = read(path.join(dist, "_redirects"));
for (const alias of ["/fight-club", "/versus", "/town-square", "/gallery", "/freelance"]) {
  check(new RegExp(`^${alias.replace("/", "\\/")}\\s+`, "m").test(redirects), `_redirects is missing legacy alias ${alias}.`);
}
check(!/\s200\s*$/m.test(redirects), "_redirects contains a soft-404 rewrite.");

const securityText = read(path.join(dist, ".well-known", "security.txt"));
for (const field of ["Contact:", "Expires:", "Canonical:", "Policy:"]) check(securityText.includes(field), `security.txt is missing ${field}`);

const workflowDirectory = path.join(root, ".github", "workflows");
const workflowFiles = walk(workflowDirectory).filter((file) => /\.ya?ml$/.test(file));
const workflowText = workflowFiles.map(read).join("\n");
check(!/pull_request_target\s*:/i.test(workflowText), "GitHub workflows must not use pull_request_target.");
check(!/terraform\s+apply/i.test(workflowText), "Terraform apply must not run from repository CI.");
for (const file of workflowFiles) {
  for (const match of read(file).matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    const action = match[1];
    if (action.startsWith("./") || action.startsWith("docker://")) continue;
    check(/@[0-9a-f]{40}$/i.test(action), `${path.relative(root, file)}: action is not pinned to a full commit SHA (${action}).`);
  }
}

const syntaxRoots = ["src/assets/js", "workers/api/src", "workers/api/test", "functions", "scripts"].map((part) => path.join(root, part));
const syntaxFiles = syntaxRoots.filter(fs.existsSync).flatMap(walk).filter((file) => /\.(?:js|mjs)$/.test(file));
for (const file of syntaxFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures.push(`${path.relative(root, file)}: JavaScript syntax check failed: ${String(error.stderr || error.message).trim()}`);
  }
}

const trackedAndNew = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenFiles = trackedAndNew.filter((file) => /(?:^|\/)\.(?:env|dev\.vars)(?:\.|$)/.test(file) && !file.endsWith(".example"));
check(forbiddenFiles.length === 0, `Secret-bearing environment files are tracked: ${forbiddenFiles.join(", ")}.`);

const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".njk", ".toml", ".txt", ".yaml", ".yml"]);
const secretPatterns = [
  /sk-(?:proj|live|test)-[A-Za-z0-9_-]{16,}/,
  /sk-ant-[A-Za-z0-9_-]{16,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
for (const relative of trackedAndNew) {
  if (!textExtensions.has(path.extname(relative).toLowerCase())) continue;
  const value = read(path.join(root, relative));
  if (secretPatterns.some((pattern) => pattern.test(value))) failures.push(`${relative}: possible credential or private key found.`);
}

if (failures.length) {
  console.error(`Validation failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML files, ${platform.pages.length} canonical routes, ${syntaxFiles.length} scripts, security headers, redirects, sitemap, and secret hygiene.`);
