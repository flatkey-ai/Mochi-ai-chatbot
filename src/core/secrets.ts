import fs from "node:fs";
import path from "node:path";

/**
 * Secrets bound from the dashboard (currently the Flatkey API key).
 * Stored in DATA_DIR/secrets.json with 0600 permissions, never in settings.json,
 * and never returned to the browser (only a masked preview).
 */
export class SecretsStore {
  private readonly file: string;
  private data: { flatkeyApiKey?: string } = {};

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "secrets.json");
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  get flatkeyApiKey(): string | undefined {
    return this.data.flatkeyApiKey || undefined;
  }

  setFlatkeyApiKey(key: string | undefined): void {
    if (key) this.data.flatkeyApiKey = key;
    else delete this.data.flatkeyApiKey;
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* best effort on filesystems without chmod */
    }
  }
}

export function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}
