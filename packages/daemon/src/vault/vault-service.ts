import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  EnvironmentSchemaV1,
  VaultEnvelopeV1,
  VaultStatus
} from "@agentmesh/contracts";
import {
  EnvironmentSchemaV1Schema,
  VaultEnvelopeV1Schema
} from "@agentmesh/contracts";
import { canonicalJson } from "../indexer/canonical-json.js";
import type { KeyWrapAdapter } from "./age-cli-adapter.js";
import { VaultError } from "./errors.js";
import { writeRestrictedFileAtomically } from "./atomic-file.js";

const VAULT_FILE_LIMIT_BYTES = 3 * 1024 * 1024;
const SCHEMA_FILE_LIMIT_BYTES = 256 * 1024;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

interface VaultAadV1 {
  format: "agentmesh-vault";
  version: 1;
  cipher: "aes-256-gcm";
  keyWrap: "age-ssh";
  recipientFingerprint: string;
  schemaHash: string;
  createdAt: string;
}

export interface CreateVaultInput {
  vaultPath: string;
  schemaPath: string;
  recipientPublicKeyPath: string;
  schema: EnvironmentSchemaV1;
  values: Record<string, string>;
}

export interface UnlockVaultInput {
  vaultPath: string;
  schemaPath: string;
  identityPath: string;
  inactivityTimeoutMilliseconds?: number;
}

export interface VaultServiceOptions {
  now?: () => Date;
  inactivityTimeoutMilliseconds?: number;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildAad(
  envelope: Pick<
    VaultEnvelopeV1,
    "format" | "version" | "cipher" | "keyWrap" | "recipientFingerprint" | "createdAt"
  >,
  schema: EnvironmentSchemaV1
): Buffer {
  const header: VaultAadV1 = {
    format: envelope.format,
    version: envelope.version,
    cipher: envelope.cipher,
    keyWrap: envelope.keyWrap,
    recipientFingerprint: envelope.recipientFingerprint,
    schemaHash: sha256(canonicalJson(schema)),
    createdAt: envelope.createdAt
  };
  return Buffer.from(canonicalJson(header), "utf8");
}

function parseSchema(value: unknown): EnvironmentSchemaV1 {
  const result = EnvironmentSchemaV1Schema.safeParse(value);
  if (!result.success) {
    throw new VaultError("VAULT_FORMAT_INVALID", "The environment schema is invalid.");
  }
  return result.data;
}

function parseEnvelope(value: unknown): VaultEnvelopeV1 {
  const result = VaultEnvelopeV1Schema.safeParse(value);
  if (!result.success) {
    throw new VaultError("VAULT_FORMAT_INVALID", "The vault envelope is invalid or unsupported.");
  }
  return result.data;
}

function readBoundedJson(filePath: string, limitBytes: number): unknown {
  try {
    const absolutePath = resolve(filePath);
    if (statSync(absolutePath).size > limitBytes) {
      throw new Error("file exceeds limit");
    }
    return JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  } catch (error) {
    throw new VaultError("VAULT_IO_ERROR", "The vault artifact is missing or unreadable.", {
      cause: error
    });
  }
}

function validateSecretValues(
  schema: EnvironmentSchemaV1,
  values: Record<string, string>,
  authenticationFailure = false
): Record<string, string> {
  const invalidCode = authenticationFailure
    ? "VAULT_AUTHENTICATION_FAILED"
    : "VAULT_INVALID_INPUT";
  const invalidMessage = authenticationFailure
    ? "Vault authentication failed."
    : "Secret values violate the environment schema.";
  const definitions = new Map(schema.variables.map((variable) => [variable.name, variable]));
  for (const name of Object.keys(values)) {
    if (!definitions.has(name)) {
      throw new VaultError(invalidCode, invalidMessage);
    }
  }

  const validated: Record<string, string> = {};
  for (const variable of schema.variables) {
    const value = values[variable.name];
    if (value === undefined) {
      if (variable.required) {
        throw new VaultError(invalidCode, invalidMessage);
      }
      continue;
    }
    if (typeof value !== "string") {
      throw new VaultError(invalidCode, invalidMessage);
    }
    if (value.length === 0 || value.length > 65_536) {
      throw new VaultError(invalidCode, invalidMessage);
    }
    const minimum = variable.validation?.minimumLength;
    const maximum = variable.validation?.maximumLength;
    if ((minimum !== undefined && value.length < minimum) || (maximum !== undefined && value.length > maximum)) {
      throw new VaultError(invalidCode, invalidMessage);
    }
    if (variable.validation?.pattern) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(variable.validation.pattern, "u");
      } catch (error) {
        throw new VaultError(invalidCode, invalidMessage, {
          cause: error
        });
      }
      if (!pattern.test(value)) {
        throw new VaultError(invalidCode, invalidMessage);
      }
    }
    validated[variable.name] = value;
  }
  return validated;
}

function decodeFixedBase64(value: string, expectedBytes: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes) {
    decoded.fill(0);
    throw new VaultError("VAULT_FORMAT_INVALID", "The vault envelope has invalid field sizes.");
  }
  return decoded;
}

export class VaultService {
  private readonly now: () => Date;
  private readonly defaultInactivityTimeoutMilliseconds: number;
  private secrets: Map<string, Buffer> | undefined;
  private profile: string | null = null;
  private recipientFingerprint: string | null = null;
  private variableNames: string[] = [];
  private unlockedAt: string | null = null;
  private expiresAt: string | null = null;
  private inactivityTimeoutMilliseconds = DEFAULT_INACTIVITY_TIMEOUT_MS;
  private expiryTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly keyWrap: KeyWrapAdapter,
    options: VaultServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.defaultInactivityTimeoutMilliseconds =
      options.inactivityTimeoutMilliseconds ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
  }

  createVault(input: CreateVaultInput): VaultStatus {
    if (existsSync(resolve(input.vaultPath)) || existsSync(resolve(input.schemaPath))) {
      throw new VaultError(
        "VAULT_IO_ERROR",
        "Refusing to overwrite an existing vault artifact."
      );
    }
    const schema = parseSchema(input.schema);
    const values = validateSecretValues(schema, input.values);
    const recipient = this.keyWrap.inspectRecipient(input.recipientPublicKeyPath);
    const createdAt = this.now().toISOString();
    const envelopeHeader = {
      format: "agentmesh-vault" as const,
      version: 1 as const,
      cipher: "aes-256-gcm" as const,
      keyWrap: "age-ssh" as const,
      recipientFingerprint: recipient.fingerprint,
      createdAt
    };
    const aad = buildAad(envelopeHeader, schema);
    const dek = randomBytes(32);
    const nonce = randomBytes(12);
    let plaintext: Buffer | undefined;
    let wrappedDek: Buffer | undefined;
    let ciphertext: Buffer | undefined;

    try {
      plaintext = Buffer.from(canonicalJson(values), "utf8");
      const cipher = createCipheriv("aes-256-gcm", dek, nonce);
      cipher.setAAD(aad);
      ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();
      wrappedDek = this.keyWrap.wrapDek(dek, input.recipientPublicKeyPath);

      const envelope = parseEnvelope({
        ...envelopeHeader,
        wrappedDek: wrappedDek.toString("base64"),
        nonce: nonce.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        authTag: authTag.toString("base64"),
        aadHash: sha256(aad)
      });
      const schemaBytes = Buffer.from(canonicalJson(schema), "utf8");
      const envelopeBytes = Buffer.from(canonicalJson(envelope), "utf8");
      try {
        writeRestrictedFileAtomically(input.schemaPath, schemaBytes);
        writeRestrictedFileAtomically(input.vaultPath, envelopeBytes);
      } finally {
        schemaBytes.fill(0);
        envelopeBytes.fill(0);
        authTag.fill(0);
      }

      this.lock();
      this.profile = schema.profile;
      this.recipientFingerprint = envelope.recipientFingerprint;
      this.variableNames = schema.variables.map((variable) => variable.name).sort();
      return this.status();
    } finally {
      plaintext?.fill(0);
      wrappedDek?.fill(0);
      ciphertext?.fill(0);
      nonce.fill(0);
      dek.fill(0);
    }
  }

  unlockVault(input: UnlockVaultInput): VaultStatus {
    const schema = parseSchema(readBoundedJson(input.schemaPath, SCHEMA_FILE_LIMIT_BYTES));
    const envelope = parseEnvelope(readBoundedJson(input.vaultPath, VAULT_FILE_LIMIT_BYTES));
    const aad = buildAad(envelope, schema);
    const expectedAadHash = Buffer.from(envelope.aadHash, "hex");
    const actualAadHash = createHash("sha256").update(aad).digest();
    if (
      expectedAadHash.length !== actualAadHash.length ||
      !timingSafeEqual(expectedAadHash, actualAadHash)
    ) {
      throw new VaultError(
        "VAULT_AUTHENTICATION_FAILED",
        "Vault authentication failed."
      );
    }

    const wrappedDek = Buffer.from(envelope.wrappedDek, "base64");
    const nonce = decodeFixedBase64(envelope.nonce, 12);
    const authTag = decodeFixedBase64(envelope.authTag, 16);
    let dek: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      dek = this.keyWrap.unwrapDek(wrappedDek, input.identityPath);
      if (dek.length !== 32) {
        throw new VaultError("KEY_UNWRAP_FAILED", "The identity could not unlock this vault.");
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", dek, nonce);
        decipher.setAAD(aad);
        decipher.setAuthTag(authTag);
        plaintext = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, "base64")),
          decipher.final()
        ]);
      } catch (error) {
        throw new VaultError(
          "VAULT_AUTHENTICATION_FAILED",
          "Vault authentication failed.",
          { cause: error }
        );
      }

      let parsedValues: unknown;
      try {
        parsedValues = JSON.parse(plaintext.toString("utf8")) as unknown;
      } catch (error) {
        throw new VaultError(
          "VAULT_AUTHENTICATION_FAILED",
          "Vault authentication failed.",
          { cause: error }
        );
      }
      if (parsedValues === null || typeof parsedValues !== "object" || Array.isArray(parsedValues)) {
        throw new VaultError("VAULT_AUTHENTICATION_FAILED", "Vault authentication failed.");
      }
      const values = validateSecretValues(
        schema,
        parsedValues as Record<string, string>,
        true
      );

      this.lock();
      this.secrets = new Map(
        Object.entries(values).map(([name, value]) => [name, Buffer.from(value, "utf8")])
      );
      this.profile = schema.profile;
      this.recipientFingerprint = envelope.recipientFingerprint;
      this.variableNames = schema.variables.map((variable) => variable.name).sort();
      this.inactivityTimeoutMilliseconds =
        input.inactivityTimeoutMilliseconds ?? this.defaultInactivityTimeoutMilliseconds;
      if (
        !Number.isInteger(this.inactivityTimeoutMilliseconds) ||
        this.inactivityTimeoutMilliseconds < 25 ||
        this.inactivityTimeoutMilliseconds > 24 * 60 * 60 * 1000
      ) {
        this.lock();
        throw new VaultError("VAULT_INVALID_INPUT", "The inactivity timeout is invalid.");
      }
      this.unlockedAt = this.now().toISOString();
      this.touch();
      return this.status();
    } finally {
      expectedAadHash.fill(0);
      actualAadHash.fill(0);
      wrappedDek.fill(0);
      nonce.fill(0);
      authTag.fill(0);
      dek?.fill(0);
      plaintext?.fill(0);
    }
  }

  status(): VaultStatus {
    this.expireIfNecessary();
    return {
      state: this.secrets ? "unlocked" : this.profile ? "locked" : "unconfigured",
      profile: this.profile,
      recipientFingerprint: this.recipientFingerprint,
      variableNames: [...this.variableNames],
      unlockedAt: this.unlockedAt,
      expiresAt: this.expiresAt
    };
  }

  async withUnlockedEnvironment<T>(
    variableNames: readonly string[],
    callback: (environment: Readonly<Record<string, string>>) => T | Promise<T>
  ): Promise<T> {
    this.expireIfNecessary();
    if (!this.secrets) {
      throw new VaultError("VAULT_LOCKED", "The vault is locked.");
    }
    const environment: Record<string, string> = {};
    for (const name of [...new Set(variableNames)].sort()) {
      const value = this.secrets.get(name);
      if (!value) {
        throw new VaultError("VAULT_INVALID_INPUT", "The requested environment variable is unavailable.");
      }
      environment[name] = value.toString("utf8");
    }
    this.touch();
    try {
      return await callback(environment);
    } finally {
      for (const name of Object.keys(environment)) {
        environment[name] = "";
        delete environment[name];
      }
    }
  }

  lock(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
    if (this.secrets) {
      for (const value of this.secrets.values()) {
        value.fill(0);
      }
      this.secrets.clear();
      this.secrets = undefined;
    }
    this.unlockedAt = null;
    this.expiresAt = null;
  }

  close(): void {
    this.lock();
  }

  private touch(): void {
    if (!this.secrets) {
      return;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
    }
    const expiry = new Date(this.now().getTime() + this.inactivityTimeoutMilliseconds);
    this.expiresAt = expiry.toISOString();
    this.expiryTimer = setTimeout(() => this.lock(), this.inactivityTimeoutMilliseconds);
    this.expiryTimer.unref();
  }

  private expireIfNecessary(): void {
    if (this.secrets && this.expiresAt && this.now().getTime() >= Date.parse(this.expiresAt)) {
      this.lock();
    }
  }
}
