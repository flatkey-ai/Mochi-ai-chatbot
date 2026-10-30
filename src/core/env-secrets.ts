/**
 * Secrets that arrive through the environment.
 *
 * Anything in process.env is inherited by every child process, visible to other
 * administrators of the machine, and lands in crash dumps and `process.env` dumps.
 * The dashboard (data/secrets.json) is the safer place for provider keys. This module
 * reads the env copy once, remembers the values so they can be redacted from anything the
 * bot says, and then removes them from process.env so they stop travelling.
 *
 * Set MOCHI_KEEP_ENV_SECRETS=1 to keep them in the environment (e.g. when a supervisor
 * re-reads them).
 */

/** Names Mochi itself reads. Kept in sync with .env.example. */
export const SECRET_ENV_NAMES = [
  "FLATKEY_API_KEY",
  "DISCORD_BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "QQ_APP_SECRET",
] as const;

const known = new Set<string>();

function remember(value: string | undefined): void {
  if (typeof value === "string" && value.trim().length >= 8) known.add(value.trim());
}

/**
 * Move provider secrets out of process.env into an in-memory registry.
 * Returns the names that were found, so the caller can warn about them.
 */
export function takeEnvSecrets(names: readonly string[] = SECRET_ENV_NAMES, scrub = process.env.MOCHI_KEEP_ENV_SECRETS !== "1"): string[] {
  const found: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (!value || !value.trim()) continue;
    remember(value);
    found.push(name);
    if (scrub) delete process.env[name];
  }
  return found;
}

/** Register a value the process knows (e.g. one just bound in the dashboard). */
export function addKnownSecret(value: string | undefined): void {
  remember(value);
}

/** Every secret value this process knows about, for output redaction. */
export function knownSecrets(): string[] {
  return [...known];
}

/** Tests only. */
export function resetEnvSecrets(): void {
  known.clear();
}
