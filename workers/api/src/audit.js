import { ApiError } from "./errors.js";

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isPrivateIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

export function isPrivateIpv6(hostname) {
  const host = stripIpv6Brackets(hostname).toLowerCase();
  if (!host.includes(":")) return false;
  return host === "::" || host === "::1" || host.startsWith("::ffff:") || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host) || host.startsWith("ff") || host.startsWith("2001:db8") || host.startsWith("2001:10") || host.startsWith("2001:2");
}

export function validatePublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "INVALID_URL", "Enter a valid public HTTPS URL.");
  }
  if (url.protocol !== "https:") throw new ApiError(400, "HTTPS_REQUIRED", "Only public HTTPS URLs can be audited.");
  if (url.username || url.password) throw new ApiError(400, "URL_CREDENTIALS_DENIED", "URLs containing credentials are not allowed.");
  if (url.port && url.port !== "443") throw new ApiError(400, "PORT_DENIED", "Only the standard HTTPS port is allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!hostname) throw new ApiError(400, "PUBLIC_HOST_REQUIRED", "Enter a public hostname.");
  url.hostname = hostname;
  const reservedName = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa") || hostname === "metadata.google.internal" || hostname === "instance-data";
  const ambiguousNumericHost = /^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname);
  const directIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || stripIpv6Brackets(hostname).includes(":");
  if (reservedName || ambiguousNumericHost || directIp || isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) throw new ApiError(400, "PRIVATE_TARGET_DENIED", "Direct IP, local, private, and reserved network targets are not allowed.");
  if (hostname.length > 253 || !hostname.includes(".")) throw new ApiError(400, "PUBLIC_HOST_REQUIRED", "Enter a public hostname.");
  url.hash = "";
  return url;
}

async function readBoundedText(response, maxBytes = MAX_HTML_BYTES) {
  const declared = Number(response.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new ApiError(422, "TARGET_TOO_LARGE", "The target page is larger than the audit limit.");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ApiError(422, "TARGET_TOO_LARGE", "The target page is larger than the audit limit.");
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ApiError(422, "TARGET_TOO_LARGE", "The target page is larger than the audit limit.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

export async function fetchPublicHtml(input, fetchImpl = fetch) {
  let current = validatePublicHttpsUrl(input);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response;
    try {
      response = await fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "User-Agent": "ForgeAtlasAudit/11.0 (+https://forge-atlas.io/command/)"
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(12_000) : undefined
      });
    } catch (error) {
      throw new ApiError(422, "TARGET_UNAVAILABLE", error?.name === "TimeoutError" ? "The target page timed out." : "The target page could not be reached.");
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === MAX_REDIRECTS) throw new ApiError(422, "TOO_MANY_REDIRECTS", "The target exceeded the redirect limit.");
      const location = response.headers.get("Location");
      if (!location) throw new ApiError(422, "INVALID_REDIRECT", "The target returned a redirect without a destination.");
      current = validatePublicHttpsUrl(new URL(location, current).href);
      continue;
    }

    if (!response.ok) throw new ApiError(422, "TARGET_RESPONSE_ERROR", `The target returned HTTP ${response.status}.`);
    const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new ApiError(422, "HTML_REQUIRED", "The target did not return an HTML page.");
    return { html: await readBoundedText(response), finalUrl: current.href };
  }
  throw new ApiError(422, "TOO_MANY_REDIRECTS", "The target exceeded the redirect limit.");
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function decodeEntities(value) {
  return value.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}

function stripMarkup(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " "));
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

function metaValue(html, key, expected) {
  const tag = tags(html, "meta").find((candidate) => attribute(candidate, key).toLowerCase() === expected.toLowerCase());
  return decodeEntities(attribute(tag || "", "content"));
}

function canonicalValue(html) {
  const tag = tags(html, "link").find((candidate) => attribute(candidate, "rel").toLowerCase().split(/\s+/).includes("canonical"));
  return attribute(tag || "", "href");
}

function result(id, label, passed, weight, detail) {
  return { id, label, passed, weight, detail };
}

export function analyzeHtml(html, finalUrl) {
  const title = stripMarkup(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = metaValue(html, "name", "description");
  const canonical = canonicalValue(html);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const viewport = metaValue(html, "name", "viewport");
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || "";
  const language = attribute(htmlTag, "lang");
  const robots = metaValue(html, "name", "robots").toLowerCase();
  const ogTitle = metaValue(html, "property", "og:title");
  const ogDescription = metaValue(html, "property", "og:description");
  const ogImage = metaValue(html, "property", "og:image");
  const canonicalIsAbsoluteHttps = /^https:\/\//i.test(canonical);
  const ogImageIsAbsoluteHttps = /^https:\/\//i.test(ogImage);

  const checks = [
    result("https", "HTTPS", finalUrl.startsWith("https://"), 10, finalUrl.startsWith("https://") ? "Final URL uses HTTPS." : "Final URL is not HTTPS."),
    result("title", "Page title", title.length >= 10 && title.length <= 60, 15, title ? `${title.length} characters; target 10–60.` : "Missing title."),
    result("description", "Meta description", description.length >= 50 && description.length <= 160, 15, description ? `${description.length} characters; target 50–160.` : "Missing meta description."),
    result("canonical", "Canonical URL", canonicalIsAbsoluteHttps, 10, canonicalIsAbsoluteHttps ? canonical : canonical ? "Canonical must be an absolute HTTPS URL." : "Missing canonical URL."),
    result("h1", "Primary heading", h1Count === 1, 10, `${h1Count} H1 element${h1Count === 1 ? "" : "s"}; target exactly one.`),
    result("viewport", "Mobile viewport", /width\s*=\s*device-width/i.test(viewport), 10, viewport || "Missing viewport meta tag."),
    result("language", "Document language", /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(language), 5, language || "Missing html lang attribute."),
    result("og-title", "Open Graph title", Boolean(ogTitle), 5, ogTitle || "Missing og:title."),
    result("og-description", "Open Graph description", Boolean(ogDescription), 5, ogDescription || "Missing og:description."),
    result("og-image", "Open Graph image", ogImageIsAbsoluteHttps, 5, ogImageIsAbsoluteHttps ? ogImage : ogImage ? "og:image must be an absolute HTTPS URL." : "Missing og:image."),
    result("indexable", "Indexing directive", !/(?:^|[,\s])noindex(?:[,\s]|$)/i.test(robots), 10, robots.includes("noindex") ? "robots meta includes noindex." : "No page-level noindex directive detected.")
  ];
  const score = checks.filter((check) => check.passed).reduce((total, check) => total + check.weight, 0);
  const target = new URL(finalUrl);
  return {
    score,
    passed: checks.filter((check) => check.passed).length,
    failed: checks.filter((check) => !check.passed).length,
    title: title || target.hostname,
    finalUrl,
    checks
  };
}
