import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function secureEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function frameFragmentedText(value: string): Buffer[] {
  const payload = Buffer.from(value, "utf8");
  const CHUNK_SIZE = 32 * 1024;
  if (payload.length <= CHUNK_SIZE) {
    if (payload.length < 126) return [Buffer.concat([Buffer.from([0x81, payload.length]), payload])];
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return [Buffer.concat([header, payload])];
  }

  const frames: Buffer[] = [];
  let offset = 0;
  let isFirst = true;

  while (offset < payload.length) {
    const chunkLength = Math.min(CHUNK_SIZE, payload.length - offset);
    const isFinal = offset + chunkLength >= payload.length;
    const chunk = payload.subarray(offset, offset + chunkLength);

    const opcode = isFirst ? 0x01 : 0x00; // 0x01 for text, 0x00 for continuation
    const fin = isFinal ? 0x80 : 0x00;
    const byte0 = fin | opcode;

    if (chunkLength < 126) {
      frames.push(Buffer.concat([Buffer.from([byte0, chunkLength]), chunk]));
    } else {
      const header = Buffer.alloc(4);
      header[0] = byte0;
      header[1] = 126;
      header.writeUInt16BE(chunkLength, 2);
      frames.push(Buffer.concat([header, chunk]));
    }

    offset += chunkLength;
    isFirst = false;
  }

  return frames;
}

function reject(socket: Socket, status = "403 Forbidden"): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export function attachStudioWebSocket(
  server: Server,
  sessionToken: string
): { broadcast: (data: unknown) => void; close: () => void } {
  const sockets = new Set<Socket>();

  const onUpgrade = (req: IncomingMessage, socket: Socket): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (url.pathname !== "/events/studio") return; // Let other handlers process if not /events/studio

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

    const close = (): void => {
      sockets.delete(socket);
    };
    socket.once("close", close);
    socket.once("error", close);
  };

  server.on("upgrade", onUpgrade);

  const broadcast = (data: unknown): void => {
    const payload = JSON.stringify(data);
    const frames = frameFragmentedText(payload);
    for (const socket of sockets) {
      if (!socket.destroyed) {
        for (const frame of frames) {
          socket.write(frame);
        }
      }
    }
  };

  const close = (): void => {
    server.off("upgrade", onUpgrade);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };

  return { broadcast, close };
}
