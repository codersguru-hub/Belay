import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { EnvironmentSchemaV1, VaultEnvelopeV1 } from "@belay/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgeCliAdapter,
  type KeyWrapAdapter,
  type RecipientMetadata
} from "../packages/daemon/src/vault/age-cli-adapter.js";
import { VaultError } from "../packages/daemon/src/vault/errors.js";
import { VaultService } from "../packages/daemon/src/vault/vault-service.js";

const CANARY = "BELAY_VAULT_CANARY_9c17e45b2a";
const cleanupDirectories: string[] = [];
const cleanupServices: VaultService[] = [];
const workspaceAgeBinary = resolve(
  join(".tools", process.platform === "win32" ? "age.exe" : "age")
);
const localAgeBinary =
  process.env.BELAY_AGE_BIN ??
  (existsSync(workspaceAgeBinary) ? workspaceAgeBinary : "age");
const ageAvailable = spawnSync(localAgeBinary, ["--version"], {
  windowsHide: true,
  encoding: "utf8"
}).status === 0;
const sshKeygenAvailable = spawnSync("ssh-keygen", ["-?"], {
  windowsHide: true,
  encoding: "utf8"
}).error === undefined;
const realAgeTest = ageAvailable && sshKeygenAvailable ? it : it.skip;

const schema: EnvironmentSchemaV1 = {
  format: "belay-env-schema",
  version: 1,
  profile: "test",
  variables: [
    {
      name: "DB_PASSWORD",
      description: "Database password used by the test command.",
      required: true,
      validation: { minimumLength: 16 }
    },
    {
      name: "OPTIONAL_TOKEN",
      description: "Optional integration token.",
      required: false
    }
  ]
};

class TestKeyWrapAdapter implements KeyWrapAdapter {
  private readonly wrappingKey = createHash("sha256").update("belay-test-wrap").digest();

  inspectRecipient(): RecipientMetadata {
    return {
      type: "ssh-ed25519",
      fingerprint: `sha256:${createHash("sha256").update("test-recipient").digest("hex")}`
    };
  }

  wrapDek(dek: Buffer): Buffer {
    return Buffer.from(dek.map((byte, index) => byte ^ (this.wrappingKey[index] ?? 0)));
  }

  unwrapDek(wrappedDek: Buffer, identityPath: string): Buffer {
    if (!identityPath.endsWith("test-identity")) {
      throw new VaultError("KEY_UNWRAP_FAILED", "The identity could not unlock this vault.");
    }
    return Buffer.from(
      wrappedDek.map((byte, index) => byte ^ (this.wrappingKey[index] ?? 0))
    );
  }
}

function createPaths(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirectories.push(directory);
  return {
    directory,
    vaultPath: join(directory, ".env.vault"),
    schemaPath: join(directory, ".env.schema.json")
  };
}

function track(service: VaultService): VaultService {
  cleanupServices.push(service);
  return service;
}

function flipBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  const modified = bytes.toString("base64");
  bytes.fill(0);
  return modified;
}

function writeEnvelope(path: string, envelope: VaultEnvelopeV1): void {
  writeFileSync(path, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
}

function generateSshKey(directory: string, name: string): string {
  const identityPath = join(directory, name);
  const result = spawnSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-C", "belay-vault-test", "-f", identityPath],
    { windowsHide: true, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error("Could not generate the SSH test identity.");
  }
  return identityPath;
}

afterEach(() => {
  for (const service of cleanupServices.splice(0)) {
    service.close();
  }
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("age-wrapped AES-GCM vault", () => {
  realAgeTest("round-trips through a real Ed25519 SSH identity without writing plaintext", async () => {
    const paths = createPaths("belay-vault-age-");
    const identityPath = generateSshKey(paths.directory, "authorized_ed25519");
    const wrongIdentityPath = generateSshKey(paths.directory, "wrong_ed25519");
    const service = track(new VaultService(new AgeCliAdapter(localAgeBinary)));

    const created = service.createVault({
      ...paths,
      recipientPublicKeyPath: `${identityPath}.pub`,
      schema,
      values: { DB_PASSWORD: CANARY }
    });
    expect(created).toEqual(
      expect.objectContaining({
        state: "locked",
        profile: "test",
        variableNames: ["DB_PASSWORD", "OPTIONAL_TOKEN"]
      })
    );
    const envelopeText = readFileSync(paths.vaultPath, "utf8");
    const schemaText = readFileSync(paths.schemaPath, "utf8");
    expect(envelopeText).not.toContain(CANARY);
    expect(envelopeText).not.toContain(identityPath);
    expect(schemaText).not.toContain(CANARY);
    expect(readdirSync(paths.directory)).not.toContain(".env");

    expect(() =>
      service.unlockVault({
        vaultPath: paths.vaultPath,
        schemaPath: paths.schemaPath,
        identityPath: wrongIdentityPath
      })
    ).toThrowError(expect.objectContaining({ code: "KEY_UNWRAP_FAILED" }));

    const unlocked = service.unlockVault({
      vaultPath: paths.vaultPath,
      schemaPath: paths.schemaPath,
      identityPath
    });
    expect(unlocked.state).toBe("unlocked");
    await service.withUnlockedEnvironment(["DB_PASSWORD"], (environment) => {
      expect(environment.DB_PASSWORD).toBe(CANARY);
      expect(environment.OPTIONAL_TOKEN).toBeUndefined();
    });
    service.lock();
    await expect(
      service.withUnlockedEnvironment(["DB_PASSWORD"], async () => undefined)
    ).rejects.toMatchObject({ code: "VAULT_LOCKED" });

    for (const fileName of readdirSync(paths.directory)) {
      const filePath = join(paths.directory, fileName);
      if (statSync(filePath).isFile()) {
        expect(readFileSync(filePath).includes(Buffer.from(CANARY))).toBe(false);
      }
    }
    if (process.platform !== "win32") {
      expect(statSync(paths.vaultPath).mode & 0o777).toBe(0o600);
      expect(statSync(paths.schemaPath).mode & 0o777).toBe(0o600);
    }
  });

  it("fails closed for tampered header, ciphertext, tag, wrapped key, and schema", () => {
    const paths = createPaths("belay-vault-tamper-");
    const service = track(new VaultService(new TestKeyWrapAdapter()));
    service.createVault({
      ...paths,
      recipientPublicKeyPath: resolve(paths.directory, "test-recipient.pub"),
      schema,
      values: { DB_PASSWORD: CANARY }
    });
    const original = JSON.parse(readFileSync(paths.vaultPath, "utf8")) as VaultEnvelopeV1;
    const attempts: Array<{ name: string; envelope: VaultEnvelopeV1; code: string }> = [
      {
        name: "header",
        envelope: { ...original, createdAt: "2026-08-16T00:00:00.000Z" },
        code: "VAULT_AUTHENTICATION_FAILED"
      },
      {
        name: "ciphertext",
        envelope: { ...original, ciphertext: flipBase64(original.ciphertext) },
        code: "VAULT_AUTHENTICATION_FAILED"
      },
      {
        name: "tag",
        envelope: { ...original, authTag: flipBase64(original.authTag) },
        code: "VAULT_AUTHENTICATION_FAILED"
      },
      {
        name: "wrapped",
        envelope: { ...original, wrappedDek: flipBase64(original.wrappedDek) },
        code: "VAULT_AUTHENTICATION_FAILED"
      }
    ];
    for (const attempt of attempts) {
      const tamperedPath = join(paths.directory, `${attempt.name}.vault`);
      writeEnvelope(tamperedPath, attempt.envelope);
      expect(() =>
        service.unlockVault({
          vaultPath: tamperedPath,
          schemaPath: paths.schemaPath,
          identityPath: resolve(paths.directory, "test-identity")
        })
      ).toThrowError(expect.objectContaining({ code: attempt.code }));
    }

    const modifiedSchemaPath = join(paths.directory, "modified.schema.json");
    writeFileSync(
      modifiedSchemaPath,
      JSON.stringify({ ...schema, profile: "modified-profile" })
    );
    expect(() =>
      service.unlockVault({
        vaultPath: paths.vaultPath,
        schemaPath: modifiedSchemaPath,
        identityPath: resolve(paths.directory, "test-identity")
      })
    ).toThrowError(expect.objectContaining({ code: "VAULT_AUTHENTICATION_FAILED" }));

    const unsupportedVersionPath = join(paths.directory, "unsupported-version.vault");
    writeFileSync(
      unsupportedVersionPath,
      JSON.stringify({ ...original, version: 2 })
    );
    expect(() =>
      service.unlockVault({
        vaultPath: unsupportedVersionPath,
        schemaPath: paths.schemaPath,
        identityPath: resolve(paths.directory, "test-identity")
      })
    ).toThrowError(expect.objectContaining({ code: "VAULT_FORMAT_INVALID" }));
  });

  it("locks after inactivity and documents the SSH-agent-only limitation", async () => {
    const paths = createPaths("belay-vault-timeout-");
    const service = track(new VaultService(new TestKeyWrapAdapter()));
    service.createVault({
      ...paths,
      recipientPublicKeyPath: resolve(paths.directory, "test-recipient.pub"),
      schema,
      values: { DB_PASSWORD: CANARY }
    });
    service.unlockVault({
      vaultPath: paths.vaultPath,
      schemaPath: paths.schemaPath,
      identityPath: resolve(paths.directory, "test-identity"),
      inactivityTimeoutMilliseconds: 30
    });
    expect(service.status().state).toBe("unlocked");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
    expect(service.status()).toEqual(
      expect.objectContaining({ state: "locked", unlockedAt: null, expiresAt: null })
    );

    const age = new AgeCliAdapter(localAgeBinary);
    expect(() => age.unwrapDek(Buffer.alloc(32), "ssh-agent:default")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_IDENTITY" })
    );
  });

  it("rejects overwrite attempts without changing existing artifacts", () => {
    const paths = createPaths("belay-vault-overwrite-");
    const service = track(new VaultService(new TestKeyWrapAdapter()));
    const input = {
      ...paths,
      recipientPublicKeyPath: resolve(paths.directory, "test-recipient.pub"),
      schema,
      values: { DB_PASSWORD: CANARY }
    };
    service.createVault(input);
    const originalVault = readFileSync(paths.vaultPath);
    expect(() => service.createVault(input)).toThrowError(
      expect.objectContaining({ code: "VAULT_IO_ERROR" })
    );
    expect(readFileSync(paths.vaultPath)).toEqual(originalVault);
    expect(existsSync(join(paths.directory, ".env"))).toBe(false);
  });
});
