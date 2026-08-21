import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { VaultError } from "./errors.js";

const AGE_OPERATION_TIMEOUT_MS = 15_000;
const AGE_OUTPUT_LIMIT_BYTES = 1024 * 1024;

export interface RecipientMetadata {
  type: "ssh-ed25519" | "ssh-rsa";
  fingerprint: string;
}

export interface KeyWrapAdapter {
  inspectRecipient(publicKeyPath: string): RecipientMetadata;
  wrapDek(dek: Buffer, publicKeyPath: string): Buffer;
  unwrapDek(wrappedDek: Buffer, identityPath: string): Buffer;
}

function requireReadableFile(filePath: string, kind: "recipient" | "identity"): string {
  if (!isAbsolute(filePath)) {
    throw new VaultError(
      kind === "recipient" ? "UNSUPPORTED_RECIPIENT" : "UNSUPPORTED_IDENTITY",
      `The ${kind} must be an explicit readable file.`
    );
  }
  try {
    const canonical = realpathSync.native(resolve(filePath));
    if (!statSync(canonical).isFile()) {
      throw new Error("not a file");
    }
    return canonical;
  } catch (error) {
    throw new VaultError(
      kind === "recipient" ? "UNSUPPORTED_RECIPIENT" : "UNSUPPORTED_IDENTITY",
      `The ${kind} must be an explicit readable file.`,
      { cause: error }
    );
  }
}

export class AgeCliAdapter implements KeyWrapAdapter {
  constructor(private readonly ageBinary = process.env.BELAY_AGE_BIN ?? "age") {}

  inspectRecipient(publicKeyPath: string): RecipientMetadata {
    const canonicalPath = requireReadableFile(publicKeyPath, "recipient");
    let publicKey: string;
    try {
      if (statSync(canonicalPath).size > 16 * 1024) {
        throw new Error("recipient too large");
      }
      publicKey = readFileSync(canonicalPath, "utf8").trim();
    } catch (error) {
      throw new VaultError("UNSUPPORTED_RECIPIENT", "The SSH recipient is invalid.", {
        cause: error
      });
    }
    const [type, encodedKey] = publicKey.split(/\s+/u);
    if ((type !== "ssh-ed25519" && type !== "ssh-rsa") || !encodedKey) {
      throw new VaultError(
        "UNSUPPORTED_RECIPIENT",
        "Only RSA and Ed25519 SSH recipient files are supported."
      );
    }
    let keyBytes: Buffer;
    try {
      keyBytes = Buffer.from(encodedKey, "base64");
      if (keyBytes.length < 32) {
        throw new Error("recipient key too short");
      }
    } catch (error) {
      throw new VaultError("UNSUPPORTED_RECIPIENT", "The SSH recipient is invalid.", {
        cause: error
      });
    }
    return {
      type,
      fingerprint: `sha256:${createHash("sha256").update(keyBytes).digest("hex")}`
    };
  }

  wrapDek(dek: Buffer, publicKeyPath: string): Buffer {
    if (dek.length !== 32) {
      throw new VaultError("VAULT_INVALID_INPUT", "The data-encryption key is invalid.");
    }
    const recipientPath = requireReadableFile(publicKeyPath, "recipient");
    return this.runAge(["--encrypt", "-R", recipientPath], dek, "KEY_WRAP_FAILED");
  }

  unwrapDek(wrappedDek: Buffer, identityPath: string): Buffer {
    if (/^(?:agent|ssh-agent):/iu.test(identityPath)) {
      throw new VaultError(
        "UNSUPPORTED_IDENTITY",
        "SSH-agent-only identities are not supported; provide an explicit identity file."
      );
    }
    const canonicalIdentity = requireReadableFile(identityPath, "identity");
    const dek = this.runAge(
      ["--decrypt", "-i", canonicalIdentity],
      wrappedDek,
      "KEY_UNWRAP_FAILED"
    );
    if (dek.length !== 32) {
      dek.fill(0);
      throw new VaultError("KEY_UNWRAP_FAILED", "The identity could not unlock this vault.");
    }
    return dek;
  }

  private runAge(
    args: string[],
    input: Buffer,
    failureCode: "KEY_WRAP_FAILED" | "KEY_UNWRAP_FAILED"
  ): Buffer {
    const result = spawnSync(this.ageBinary, args, {
      input,
      encoding: "buffer",
      windowsHide: true,
      shell: false,
      timeout: AGE_OPERATION_TIMEOUT_MS,
      maxBuffer: AGE_OUTPUT_LIMIT_BYTES
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultError(
        "AGE_UNAVAILABLE",
        "The configured age executable is unavailable."
      );
    }
    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
      throw new VaultError(
        failureCode,
        failureCode === "KEY_WRAP_FAILED"
          ? "The data-encryption key could not be wrapped."
          : "The identity could not unlock this vault."
      );
    }
    return Buffer.from(result.stdout);
  }
}
