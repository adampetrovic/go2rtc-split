import { createReadStream, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createManifest } from "../src/shared/config.js";
import { buildRuntimeConfig } from "./config.js";

const config = buildRuntimeConfig();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(serverDir, "../client");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
};

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error("request failed", error);
    sendText(response, 500, "Internal Server Error");
  });
});

server.listen(port, host, () => {
  console.log(`go2rtc-split listening on http://${host}:${port}${config.basePath || "/"}`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/healthz" || url.pathname === "/readyz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (!isInsideBasePath(url.pathname, config.basePath)) {
    sendText(response, 404, "Not Found");
    return;
  }

  const relativePath = stripBasePath(url.pathname, config.basePath);

  if (relativePath === "" && !url.pathname.endsWith("/")) {
    redirect(response, `${url.pathname}/${url.search}`);
    return;
  }

  if (relativePath === "/config.json") {
    sendJson(response, 200, config, {
      "Cache-Control": "no-store",
    });
    return;
  }

  if (relativePath === "/manifest.webmanifest") {
    sendJson(response, 200, createManifest(config), {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    return;
  }

  const filePath = relativePath === "" || relativePath === "/" ? "/index.html" : relativePath;
  const resolved = safeResolve(staticDir, filePath);

  if (!resolved) {
    sendText(response, 403, "Forbidden");
    return;
  }

  if (await serveFile(response, resolved)) return;

  if (request.headers.accept?.includes("text/html")) {
    await serveFile(response, path.join(staticDir, "index.html"));
    return;
  }

  sendText(response, 404, "Not Found");
}

function isInsideBasePath(pathname: string, basePath: string): boolean {
  if (basePath === "") return true;
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === "") return pathname;
  const stripped = pathname.slice(basePath.length);
  return stripped === "" ? "" : stripped;
}

function safeResolve(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.resolve(root, `.${decoded}`);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSeparator)) return null;
  return resolved;
}

async function serveFile(response: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
  } catch {
    return false;
  }

  const extension = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Content-Length": statSync(filePath).size,
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(filePath).pipe(response);
  return true;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(value, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

function sendText(response: ServerResponse, statusCode: number, value: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
  });
  response.end(value);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(308, {
    Location: location,
  });
  response.end();
}
