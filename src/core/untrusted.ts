/**
 * Untrusted text handling.
 *
 * Everything the bot reads that it did not write itself is attacker-reachable: chat
 * messages, uploaded documents, imported web pages, search results, and the memory
 * profiles a model wrote from those messages. You cannot stop a model from *seeing*
 * an instruction in that text; you can stop the text from impersonating structure,
 * and you can stop the output from carrying anything it should not.
 */

/** Zero-width and bidi characters: the usual way to hide instructions from a human reviewer. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/g;

/** Control characters, except newline and tab. */
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Anything that looks like chat-template or role syntax. Models are trained to treat these
 * as structure, so a message containing them can impersonate a system turn.
 */
const ROLE_MARKERS =
  /<\|?\s*(?:im_start|im_end|endoftext|system|assistant|user|tool)\s*\|?>|\[\/?INST\]|<<\/?SYS>>|<\/?(?:sys|system|instructions?|prompt)>/gi;

/** Our own provenance tags: a document must not be able to close them and "escape" into instructions. */
const OUR_TAGS = /<\/?(?:passages?|memory|search_result|knowledge|data)>/gi;

/** Fake speaker lines at the start of a line: "SYSTEM: ...", "Assistant: ...". */
const SPEAKER_LINE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:system|assistant|user|developer|admin|instructions?)[ \t]*:[ \t]*/gim;

export interface NeutralizeOptions {
  /** Hard cap on characters handed to the model. */
  max?: number;
}

/**
 * Make a piece of untrusted text safe to *quote*. It stays readable — we're not censoring
 * meaning, only removing the ability to forge structure (roles, our delimiters, invisible
 * characters) that the model might mistake for a higher-priority instruction.
 */
export function neutralizeUntrusted(input: string, opts: NeutralizeOptions = {}): string {
  const max = opts.max ?? 4000;
  let out = String(input ?? "")
    .replace(INVISIBLE, "")
    .replace(CONTROLS, " ")
    .replace(OUR_TAGS, (m) => m.replace(/[<>/]/g, ""))
    .replace(ROLE_MARKERS, (m) => m.replace(/[<>=|[\]]/g, ""))
    .replace(SPEAKER_LINE, "");
  if (out.length > max) out = out.slice(0, max) + "…";
  return out;
}

/**
 * A per-process random string placed in the system prompt and nowhere else. If it ever
 * appears in a reply, the model has dumped its instructions — that reply is dropped
 * regardless of how convincing it looks.
 */
export const PROMPT_CANARY = `mochi-canary-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const SECRET_SHAPES: [RegExp, string][] = [
  [/sk-[A-Za-z0-9_\-]{16,}/g, "sk-[redacted]"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/xox[abprs]-[A-Za-z0-9\-]{10,}/g, "[redacted]"],
  [/AKIA[0-9A-Z]{16}/g, "[redacted]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]"],
];

export interface OutputGuardResult {
  text: string;
  /** Why the reply was dropped, when it was. */
  blocked?: "canary" | "instructions" | "empty";
}

/**
 * Last gate before a reply leaves the process. Deterministic — it does not rely on the
 * model behaving. Blocks instruction/canary leakage, scrubs credential-shaped strings,
 * and trims empty output.
 */
export function guardOutput(raw: string, promptFingerprint?: string): OutputGuardResult {
  let text = String(raw ?? "");
  if (text.includes(PROMPT_CANARY)) return { text: "", blocked: "canary" };
  if (promptFingerprint && promptFingerprint.length >= 40 && text.includes(promptFingerprint.slice(0, 40)))
    return { text: "", blocked: "instructions" };
  for (const [re, replacement] of SECRET_SHAPES) text = text.replace(re, replacement);
  text = text.trim();
  if (!text) return { text: "", blocked: "empty" };
  return { text };
}

/**
 * Search queries are written by the model, so an injection can steer what leaves the
 * process. Keep them short and free of anything that looks like data someone handed it:
 * URLs, e-mail addresses, long tokens.
 */
export function sanitizeSearchQuery(query: string, max = 160): string {
  return String(query ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
