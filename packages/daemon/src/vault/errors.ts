export type VaultErrorCode =
  | "VAULT_INVALID_INPUT"
  | "VAULT_FORMAT_INVALID"
  | "VAULT_IO_ERROR"
  | "AGE_UNAVAILABLE"
  | "UNSUPPORTED_RECIPIENT"
  | "UNSUPPORTED_IDENTITY"
  | "KEY_WRAP_FAILED"
  | "KEY_UNWRAP_FAILED"
  | "VAULT_AUTHENTICATION_FAILED"
  | "VAULT_LOCKED";

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VaultError";
    this.code = code;
  }
}
