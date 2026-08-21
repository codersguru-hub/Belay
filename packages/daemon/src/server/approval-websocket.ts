import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { ApprovalEventHub } from "../approval/event-hub.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function secureEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function frameText(value: string): Buffer {
  const payload = Buffer.from(value, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  throw new Error("Approval event exceeds the WebSocket frame budget.");
}

function reject(socket: Socket, status = "403 Forbidden"): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export function attachApprovalWebSocket(
  server: Server,
  events: ApprovalEventHub,
  sessionToken: string
): () => void {
  const sockets = new Set<Socket>();
  const onUpgrade = (req: IncomingMessage, socket: Socket): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    // Both this listener and attachStudioWebSocket's are registered on the same server's
    // "upgrade" event, and Node calls every listener regardless of what an earlier one does to
    // the socket. A hard reject() here for any non-matching path would end/destroy the socket
    // before the other listener's own path check ever runs, killing /events/studio requests
    // before they're handled. Silently deferring to the next listener is what studio-websocket.ts
    // already does correctly for its own non-matching case.
    if (url.pathname !== "/events") return;
    if (req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]) return reject(socket);
    const host = (req.headers.host ?? "").split(":", 1)[0]?.toLowerCase();
    const origin = req.headers.origin ? new URL(req.headers.origin).hostname.toLowerCase() : host;
    if (!host || !["127.0.0.1", "localhost", "[::1]"].includes(host) || origin !== host) {
      return reject(socket);
    }
    const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((value) => value.trim());
    const expectedProtocol = `belay-token.${sessionToken}`;
    const cookieToken = String(req.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("belay_session="))
      ?.slice("belay_session=".length);
    const protocolAuthorized = protocols.some((value) => secureEqual(value, expectedProtocol));
    const cookieAuthorized = cookieToken ? secureEqual(cookieToken, sessionToken) : false;
    if (!protocolAuthorized && !cookieAuthorized) return reject(socket, "401 Unauthorized");
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
      return reject(socket, "400 Bad Request");
    }
    const accept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
    const selectedProtocol = protocolAuthorized
      ? `Sec-WebSocket-Protocol: ${expectedProtocol}\r\n`
      : "";
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: ${expectedProtocol}\r\n\r\n`
        .replace(`Sec-WebSocket-Protocol: ${expectedProtocol}\r\n`, selectedProtocol)
    );
    sockets.add(socket);
    const unsubscribe = events.subscribe((event) => {
      if (!socket.destroyed) socket.write(frameText(JSON.stringify(event)));
    });
    const close = (): void => {
      sockets.delete(socket);
      unsubscribe();
    };
    socket.once("close", close);
    socket.once("error", close);
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };
}
