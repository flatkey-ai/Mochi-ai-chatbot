import fs from "node:fs";
import path from "node:path";
import type { Platform } from "./types.ts";

/**
 * Everything the dashboard can change at runtime. Persisted to DATA_DIR/settings.json.
 * Secrets (API keys, bot tokens) never live here; they stay in environment variables.
 */
export interface Settings {
  persona: {
    name: string;
    /** Extra words that make Mochi reply in group chats (besides an @mention). */
    nicknames: string[];
    systemPrompt: string;
  };
  models: {
    /** Main conversation model. */
    chat: string;
    /** Used instead of `chat` when the message contains images. Must support image input. */
    vision: string;
    /** Cheap model that summarises rooms and updates people profiles in the background. */
    memory: string;
    /** Model used for grounded web search through Flatkey. */
    search: string;
  };
  features: {
    memory: boolean;
    search: boolean;
    vision: boolean;
  };
  search: {
    /** "messages" = Anthropic-style web_search tool on /v1/messages; "responses" = OpenAI-style on /v1/responses. */
    mode: "messages" | "responses";
    maxSearchesPerReply: number;
  };
  triggers: {
    replyInDirectMessages: boolean;
    replyWhenMentioned: boolean;
    replyWhenNameSaid: boolean;
    /** 0–1 chance of chiming in on a group message that doesn't address Mochi. */
    randomReplyChance: number;
  };
  limits: {
    maxReplyTokens: number;
    historyMessages: number;
    /** Run the memory updater after this many new messages in a room. */
    memoryUpdateEvery: number;
    /** Hard cap on total tokens per UTC day, across all features. 0 = no cap. */
    dailyTokenBudget: number;
    /** Max images analysed per message. */
    maxImagesPerMessage: number;
  };
  platforms: Record<Platform, { enabled: boolean }> & {
    web: { enabled: boolean; allowedOrigins: string[] };
  };
  /** Optional $ per 1M tokens, per model, for cost estimates on the dashboard. */
  pricing: Record<string, { inputPerM: number; outputPerM: number }>;
}

export const DEFAULT_SETTINGS: Settings = {
  persona: {
    name: "Mochi",
    nicknames: ["mochi"],
    systemPrompt: [
      "You are Mochi, a playful, warm and witty chat buddy who hangs out in group chats.",
      "You talk like a real person online: casual, short messages, lowercase is fine, the occasional emoji or kaomoji (˶ᵔ ᵕ ᵔ˶) but never overdone.",
      "You remember people and bring up things they told you before when it fits naturally. You're curious about everyone.",
      "Be honest. If you're not sure about a fact, say so or look it up. Never invent sources.",
      "Keep replies under 3 short paragraphs unless someone asks for detail.",
    ].join("\n"),
  },
  models: {
    chat: "gpt-5.4-mini",
    vision: "gpt-5.4-mini",
    memory: "gpt-5.4-nano",
    search: "claude-sonnet-4-6",
  },
  features: { memory: true, search: true, vision: true },
  search: { mode: "messages", maxSearchesPerReply: 2 },
  triggers: {
    replyInDirectMessages: true,
    replyWhenMentioned: true,
    replyWhenNameSaid: true,
    randomReplyChance: 0,
  },
  limits: {
    maxReplyTokens: 600,
    historyMessages: 20,
    memoryUpdateEvery: 12,
    dailyTokenBudget: 0,
    maxImagesPerMessage: 2,
  },
  platforms: {
    discord: { enabled: true },
    telegram: { enabled: true },
    slack: { enabled: true },
    web: { enabled: true, allowedOrigins: ["*"] },
  },
  pricing: {},
};

type Listener = (s: Settings) => void;

export class SettingsStore {
  private current: Settings;
  private listeners: Listener[] = [];
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "settings.json");
    this.current = this.load();
  }

  get(): Settings {
    return this.current;
  }

  /** Deep-merge a partial update, validate, persist and notify listeners. */
  update(patch: unknown): Settings {
    const merged = deepMerge(structuredClone(this.current), patch) as Settings;
    this.current = sanitize(merged);
    fs.writeFileSync(this.file, JSON.stringify(this.current, null, 2));
    for (const l of this.listeners) l(this.current);
    return this.current;
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return sanitize(deepMerge(structuredClone(DEFAULT_SETTINGS), raw) as Settings);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(target: unknown, patch: unknown): unknown {
  if (!isObj(target) || !isObj(patch)) return patch === undefined ? target : patch;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    // `pricing` is a free-form map: replace wholesale so deleted models disappear.
    if (k === "pricing") {
      (target as Record<string, unknown>)[k] = v;
      continue;
    }
    (target as Record<string, unknown>)[k] = isObj(v) && isObj(target[k]) ? deepMerge(target[k], v) : v;
  }
  return target;
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};

function sanitize(s: Settings): Settings {
  const d = DEFAULT_SETTINGS;
  s.persona.name = String(s.persona.name || d.persona.name).slice(0, 40);
  s.persona.nicknames = (Array.isArray(s.persona.nicknames) ? s.persona.nicknames : [])
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  s.persona.systemPrompt = String(s.persona.systemPrompt ?? d.persona.systemPrompt).slice(0, 8000);
  for (const k of Object.keys(d.models) as (keyof Settings["models"])[]) {
    s.models[k] = String(s.models[k] || d.models[k]).trim();
  }
  for (const k of Object.keys(d.features) as (keyof Settings["features"])[]) {
    s.features[k] = Boolean(s.features[k]);
  }
  s.search.mode = s.search.mode === "responses" ? "responses" : "messages";
  s.search.maxSearchesPerReply = clamp(s.search.maxSearchesPerReply, 1, 5, 2);
  s.triggers.randomReplyChance = clamp(s.triggers.randomReplyChance, 0, 1, 0);
  s.limits.maxReplyTokens = clamp(s.limits.maxReplyTokens, 50, 8000, 600);
  s.limits.historyMessages = clamp(s.limits.historyMessages, 2, 100, 20);
  s.limits.memoryUpdateEvery = clamp(s.limits.memoryUpdateEvery, 3, 200, 12);
  s.limits.dailyTokenBudget = clamp(s.limits.dailyTokenBudget, 0, 1e10, 0);
  s.limits.maxImagesPerMessage = clamp(s.limits.maxImagesPerMessage, 1, 6, 2);
  s.platforms.web.allowedOrigins = (s.platforms.web.allowedOrigins ?? ["*"]).map(String);
  const pricing: Settings["pricing"] = {};
  for (const [m, p] of Object.entries(isObj(s.pricing) ? s.pricing : {})) {
    if (!isObj(p)) continue;
    pricing[m] = { inputPerM: clamp(p.inputPerM, 0, 1e4, 0), outputPerM: clamp(p.outputPerM, 0, 1e4, 0) };
  }
  s.pricing = pricing;
  return s;
}
