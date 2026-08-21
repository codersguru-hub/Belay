import { existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function serveDashboardAsset(
  pathname: string,
  res: ServerResponse,
  dashboardDirectory: string,
  sessionToken: string
): boolean {
  const root = resolve(dashboardDirectory);
  const requestedPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const candidate = resolve(root, requestedPath);
  if (!inside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    return false;
  }
  const isDocument = extname(candidate) === ".html";
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(candidate)] ?? "application/octet-stream",
    "cache-control": isDocument ? "no-store" : "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(isDocument
      ? {
          "set-cookie": `belay_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`
        }
      : {})
  });
  res.end(readFileSync(candidate));
  return true;
}
