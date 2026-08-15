import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { VaultError } from "./errors.js";

export function writeRestrictedFileAtomically(
  targetPath: string,
  contents: Buffer,
  mode = 0o600
): void {
  const absoluteTarget = resolve(targetPath);
  const parent = dirname(absoluteTarget);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(absoluteTarget)) {
    throw new VaultError(
      "VAULT_IO_ERROR",
      "Refusing to overwrite an existing vault artifact."
    );
  }

  const temporaryPath = `${absoluteTarget}.tmp-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", mode);
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, mode);
    renameSync(temporaryPath, absoluteTarget);
    chmodSync(absoluteTarget, mode);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort descriptor cleanup.
      }
    }
    rmSync(temporaryPath, { force: true });
    if (error instanceof VaultError) {
      throw error;
    }
    throw new VaultError("VAULT_IO_ERROR", "Could not write the vault artifact safely.", {
      cause: error
    });
  }
}
