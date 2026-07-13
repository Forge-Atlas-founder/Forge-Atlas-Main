import assert from "node:assert/strict";
import test from "node:test";
import { analyzeHtml, fetchPublicHtml, validatePublicHttpsUrl } from "../src/audit.js";

const completeHtml = `<!doctype html><html lang="en"><head>
<title>Forge Atlas deterministic audit example</title>
<meta name="description" content="A complete sample page description that is long enough for a deterministic metadata audit.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Forge Atlas audit">
<meta property="og:description" content="A complete social description.">
<meta property="og:image" content="https://example.com/preview.jpg">
<link rel="canonical" href="https://example.com/">
</head><body><h1>One primary heading</h1></body></html>`;

test("public URL validation accepts a conventional HTTPS origin", () => {
  assert.equal(validatePublicHttpsUrl("https://example.com/path#fragment").href, "https://example.com/path");
});

test("public URL validation blocks private, ambiguous, credentialed, and nonstandard targets", () => {
  const denied = [
    "http://example.com/",
    "https://localhost/",
    "https://localhost./",
    "https://127.0.0.1/",
    "https://8.8.8.8/",
    "https://[::1]/",
    "https://metadata.google.internal/",
    "https://2130706433/",
    "https://user:password@example.com/",
    "https://example.com:8443/"
  ];
  for (const value of denied) assert.throws(() => validatePublicHttpsUrl(value), (error) => error.status === 400);
});

test("deterministic audit scores a complete document at 100", () => {
  const result = analyzeHtml(completeHtml, "https://example.com/");
  assert.equal(result.score, 100);
  assert.equal(result.failed, 0);
  assert.equal(result.checks.length, 11);
});

test("deterministic audit reports missing page signals", () => {
  const result = analyzeHtml("<!doctype html><html><body><h2>No primary heading</h2></body></html>", "https://example.com/");
  assert.equal(result.score, 20);
  assert.equal(result.failed, 9);
});

test("remote fetch rejects a redirect into a private address", async () => {
  const fakeFetch = async () => new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } });
  await assert.rejects(fetchPublicHtml("https://example.com/", fakeFetch), (error) => error.code === "PRIVATE_TARGET_DENIED");
});

test("remote fetch accepts bounded HTML and reports the final URL", async () => {
  const fakeFetch = async () => new Response(completeHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  const result = await fetchPublicHtml("https://example.com/", fakeFetch);
  assert.equal(result.finalUrl, "https://example.com/");
  assert.equal(result.html, completeHtml);
});

test("remote fetch rejects non-HTML and oversized targets", async () => {
  const nonHtml = async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  await assert.rejects(fetchPublicHtml("https://example.com/", nonHtml), (error) => error.code === "HTML_REQUIRED");

  const oversized = async () => new Response("small", { status: 200, headers: { "Content-Type": "text/html", "Content-Length": "1000001" } });
  await assert.rejects(fetchPublicHtml("https://example.com/", oversized), (error) => error.code === "TARGET_TOO_LARGE");
});
