import { StringDecoder } from "node:string_decoder";

export const REDACTION_MARKER = "[REDACTED]";
const MINIMUM_SECRET_LENGTH = 8;

function encodedVariants(secret: string): string[] {
  const utf8 = Buffer.from(secret, "utf8");
  const standardBase64 = utf8.toString("base64");
  const base64Url = utf8.toString("base64url");
  const variants = [
    secret,
    standardBase64,
    base64Url,
    encodeURIComponent(secret),
    utf8.toString("hex")
  ];
  utf8.fill(0);
  return variants;
}

export class SecretRedactor {
  readonly maximumPatternLength: number;
  private readonly patterns: string[];

  constructor(secrets: readonly string[]) {
    if (secrets.some((secret) => secret.length < MINIMUM_SECRET_LENGTH)) {
      throw new Error("Secrets shorter than eight characters cannot be executed safely.");
    }
    this.patterns = [...new Set(secrets.flatMap(encodedVariants))]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length || left.localeCompare(right));
    this.maximumPatternLength = Math.max(1, ...this.patterns.map((pattern) => pattern.length));
  }

  redactText(value: string): string {
    let sanitized = value;
    for (const pattern of this.patterns) {
      sanitized = sanitized.split(pattern).join(REDACTION_MARKER);
    }
    return sanitized;
  }

  createStream(): StreamingSecretRedactor {
    return new StreamingSecretRedactor(this);
  }

  crossesBoundary(value: string, cutoff: number): number | undefined {
    let earliest: number | undefined;
    for (const pattern of this.patterns) {
      let start = value.indexOf(pattern);
      while (start >= 0) {
        const end = start + pattern.length;
        if (start < cutoff && end > cutoff) {
          earliest = earliest === undefined ? start : Math.min(earliest, start);
        }
        start = value.indexOf(pattern, start + 1);
      }
    }
    return earliest;
  }
}

export class StreamingSecretRedactor {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";

  constructor(private readonly redactor: SecretRedactor) {}

  write(chunk: Buffer): string {
    this.pending += this.decoder.write(chunk);
    return this.drain(false);
  }

  end(): string {
    this.pending += this.decoder.end();
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let cutoff = final
      ? this.pending.length
      : Math.max(0, this.pending.length - (this.redactor.maximumPatternLength - 1));
    if (!final) {
      const crossingStart = this.redactor.crossesBoundary(this.pending, cutoff);
      if (crossingStart !== undefined) {
        cutoff = crossingStart;
      }
    }
    const ready = this.pending.slice(0, cutoff);
    this.pending = this.pending.slice(cutoff);
    return this.redactor.redactText(ready);
  }
}
