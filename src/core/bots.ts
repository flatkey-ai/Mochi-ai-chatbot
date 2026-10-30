import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Platform } from "./types.ts";
import { PRESETS, type PresetId } from "./persona.ts";

export type BotMode = "companion" | "qa";
export type Tone = "playful" | "friendly" | "professional" | "sassy" | "calm";

export interface Persona {
  name: string;
  /** One emoji shown as the bot's avatar in the dashboard and web widget. */
  avatar: string;
  /** Accent color for the web widget. */
  color: string;
  /** Public one-liner: shown in the widget header and synced to Telegram/Discord bot profiles. */
  description: string;
  /** First message the web widget shows. */
  greeting: string;
  /** Extra words that make the bot reply in group chats (besides an @mention). */
  nicknames: string[];
  personality: string;
  tone: Tone;
  emoji: "none" | "some" | "lots";
  replyLength: "short" | "medium" | "long";
  /** "auto" = reply in the user's language, or a language name like "English". */
  language: string;
  backstory: string;
  /** Do's and don'ts, topics to avoid, how to hand off. */
  rules: string;
  /** Advanced: if set, replaces the generated persona prompt entirely. */
  customPrompt: string;
}

export interface BotSettings {
  id: string;
  createdAt: number;
  mode: BotMode;
  persona: Persona;
  knowledge: {
    enabled: boolean;
    /** QA bots: only answer from the knowledge base; otherwise reply with fallbackMessage. */
    strict: boolean;
    maxChunks: number;
    fallbackMessage: string;
  };
  models: { chat: string; vision: string; memory: string; search: string };
  features: { memory: boolean; search: boolean; vision: boolean };
  search: { mode: "messages" | "responses"; maxSearchesPerReply: number };
  triggers: {
    replyInDirectMessages: boolean;
    replyWhenMentioned: boolean;
    replyWhenNameSaid: boolean;
    randomReplyChance: number;
  };
  limits: {
    maxReplyTokens: number;
    historyMessages: number;
    memoryUpdateEvery: number;
    dailyTokenBudget: number;
    maxImagesPerMessage: number;
  };
  channels: Record<Exclude<Platform, "web">, { enabled: boolean }> & {
    web: { enabled: boolean; allowedOrigins: string[] };
  };
}

export const BASE_BOT: Omit<BotSettings, "id" | "createdAt"> = {
  mode: "companion",
  persona: {
    name: "Mochi",
    avatar: "🍡",
    color: "#ff6fae",
    description: "",
    greeting: "",
    nicknames: [],
    personality: "",
    tone: "friendly",
    emoji: "some",
    replyLength: "short",
    language: "auto",
    backstory: "",
    rules: "",
    customPrompt: "",
  },
  knowledge: {
    enabled: true,
    strict: false,
    maxChunks: 4,
    fallbackMessage: "I couldn't find that in my notes. Could you rephrase, or ask a human on the team?",
  },
  // Chat + memory default to DeepSeek V4.1 Flash. Vision needs a model that accepts images,
  // and search needs a model with the native web_search tool, so those keep their own defaults.
  models: { chat: "deepseek-v4-1-flash", vision: "gpt-5.4-mini", memory: "deepseek-v4-1-flash", search: "claude-sonnet-4-6" },
  features: { memory: true, search: true, vision: true },
  search: { mode: "messages", maxSearchesPerReply: 2 },
  triggers: { replyInDirectMessages: true, replyWhenMentioned: true, replyWhenNameSaid: true, randomReplyChance: 0 },
  limits: { maxReplyTokens: 600, historyMessages: 20, memoryUpdateEvery: 12, dailyTokenBudget: 0, maxImagesPerMessage: 2 },
  channels: {
    discord: { enabled: true },
    telegram: { enabled: true },
    slack: { enabled: true },
    web: { enabled: true, allowedOrigins: ["*"] },
  },
};

export type Pricing = Record<string, { inputPerM: number; outputPerM: number }>;

interface RegistryFile {
  version: 2;
  bots: BotSettings[];
  pricing: Pricing;
}

type Listener = (bot: BotSettings | null, id: string) => void;

/**
 * All bots on this server, persisted to DATA_DIR/bots.json.
 * Secrets (Flatkey key, channel tokens) live in SecretsStore, never here.
 */
export class BotRegistry {
  private data: RegistryFile;
  private listeners: Listener[] = [];
  private readonly file: string;

  constructor(private readonly dataDir: string) {
    this.file = path.join(dataDir, "bots.json");
    this.data = this.load();
    if (this.data.bots.length === 0) this.create("companion", { id: "mochi" });
  }

  list(): BotSettings[] {
    return this.data.bots;
  }

  get(id: string): BotSettings | undefined {
    return this.data.bots.find((b) => b.id === id);
  }

  /** The first bot: used by legacy .env channel tokens and widget calls without data-bot. */
  defaultBot(): BotSettings {
    return this.data.bots[0];
  }

  create(preset: PresetId, overrides: { id?: string; name?: string } = {}): BotSettings {
    const p = PRESETS[preset] ?? PRESETS.blank;
    const merged = deepMerge(structuredClone(BASE_BOT), structuredClone(p.settings)) as BotSettings;
    merged.id = overrides.id ?? newBotId();
    merged.createdAt = Date.now();
    if (overrides.name) merged.persona.name = overrides.name;
    const bot = sanitize(merged);
    this.data.bots.push(bot);
    this.save();
    this.emit(bot, bot.id);
    return bot;
  }

  update(id: string, patch: unknown): BotSettings {
    const i = this.data.bots.findIndex((b) => b.id === id);
    if (i < 0) throw new Error("bot not found");
    const merged = deepMerge(structuredClone(this.data.bots[i]), patch) as BotSettings;
    merged.id = id; // immutable
    merged.createdAt = this.data.bots[i].createdAt;
    this.data.bots[i] = sanitize(merged);
    this.save();
    this.emit(this.data.bots[i], id);
    return this.data.bots[i];
  }

  delete(id: string): void {
    if (this.data.bots.length <= 1) throw new Error("You need at least one bot.");
    this.data.bots = this.data.bots.filter((b) => b.id !== id);
    this.save();
    this.emit(null, id);
  }

  get pricing(): Pricing {
    return this.data.pricing;
  }

  setPricing(p: unknown): Pricing {
    const out: Pricing = {};
    for (const [m, v] of Object.entries(isObj(p) ? p : {})) {
      if (!isObj(v) || !m.trim()) continue;
      out[m.trim()] = { inputPerM: clamp(v.inputPerM, 0, 1e4, 0), outputPerM: clamp(v.outputPerM, 0, 1e4, 0) };
    }
    this.data.pricing = out;
    this.save();
    return out;
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  private emit(bot: BotSettings | null, id: string) {
    for (const l of this.listeners) l(bot, id);
  }

  private save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  private load(): RegistryFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const bots = (Array.isArray(raw.bots) ? raw.bots : []).map((b: unknown) =>
        sanitize(deepMerge(structuredClone(BASE_BOT), b) as BotSettings),
      );
      return { version: 2, bots, pricing: isObj(raw.pricing) ? (raw.pricing as Pricing) : {} };
    } catch {
      return this.migrateV1();
    }
  }

  /** v0.1 kept a single bot in settings.json. Turn it into bot "mochi". */
  private migrateV1(): RegistryFile {
    const legacy = path.join(this.dataDir, "settings.json");
    try {
      const old = JSON.parse(fs.readFileSync(legacy, "utf8"));
      const bot = deepMerge(structuredClone(BASE_BOT), structuredClone(PRESETS.companion.settings)) as BotSettings;
      bot.id = "mochi";
      bot.createdAt = Date.now();
      for (const k of ["models", "features", "search", "triggers", "limits"] as const) {
        if (isObj(old[k])) deepMerge(bot[k], old[k]);
      }
      if (isObj(old.persona)) {
        if (old.persona.name) bot.persona.name = String(old.persona.name);
        if (Array.isArray(old.persona.nicknames)) bot.persona.nicknames = old.persona.nicknames;
        if (typeof old.persona.systemPrompt === "string" && !old.persona.systemPrompt.startsWith("You are Mochi, a playful"))
          bot.persona.customPrompt = old.persona.systemPrompt;
      }
      if (isObj(old.platforms)) deepMerge(bot.channels, old.platforms);
      const data: RegistryFile = { version: 2, bots: [sanitize(bot)], pricing: isObj(old.pricing) ? old.pricing : {} };
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
      fs.renameSync(legacy, legacy + ".v1.bak");
      console.log("[mochi] migrated settings.json → bots.json (bot id: mochi)");
      return data;
    } catch {
      return { version: 2, bots: [], pricing: {} };
    }
  }
}

function newBotId(): string {
  return "b_" + crypto.randomBytes(4).toString("hex");
}

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge(target: unknown, patch: unknown): unknown {
  if (!isObj(target) || !isObj(patch)) return patch === undefined ? target : patch;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    (target as Record<string, unknown>)[k] = isObj(v) && isObj(target[k]) ? deepMerge(target[k], v) : v;
  }
  return target;
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
};
const str = (v: unknown, max: number, dflt = "") => (typeof v === "string" ? v : dflt).slice(0, max);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], dflt: T): T => (opts.includes(v as T) ? (v as T) : dflt);

export function sanitize(b: BotSettings): BotSettings {
  const d = BASE_BOT;
  const p = b.persona;
  b.mode = oneOf(b.mode, ["companion", "qa"] as const, "companion");
  p.name = str(p.name, 40).trim() || "Mochi";
  p.avatar = [...str(p.avatar, 16).trim()].slice(0, 2).join("") || "🤖";
  p.color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : d.persona.color;
  p.description = str(p.description, 300);
  p.greeting = str(p.greeting, 300);
  p.nicknames = (Array.isArray(p.nicknames) ? p.nicknames : [])
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  p.personality = str(p.personality, 1500);
  p.tone = oneOf(p.tone, ["playful", "friendly", "professional", "sassy", "calm"] as const, "friendly");
  p.emoji = oneOf(p.emoji, ["none", "some", "lots"] as const, "some");
  p.replyLength = oneOf(p.replyLength, ["short", "medium", "long"] as const, "short");
  p.language = str(p.language, 40).trim() || "auto";
  p.backstory = str(p.backstory, 2000);
  p.rules = str(p.rules, 3000);
  p.customPrompt = str(p.customPrompt, 8000);

  b.knowledge.enabled = Boolean(b.knowledge.enabled);
  b.knowledge.strict = Boolean(b.knowledge.strict);
  b.knowledge.maxChunks = clamp(b.knowledge.maxChunks, 1, 10, 4);
  b.knowledge.fallbackMessage = str(b.knowledge.fallbackMessage, 500) || d.knowledge.fallbackMessage;

  for (const k of Object.keys(d.models) as (keyof BotSettings["models"])[]) {
    b.models[k] = str(b.models[k], 120).trim() || d.models[k];
  }
  for (const k of Object.keys(d.features) as (keyof BotSettings["features"])[]) b.features[k] = Boolean(b.features[k]);
  b.search.mode = b.search.mode === "responses" ? "responses" : "messages";
  b.search.maxSearchesPerReply = clamp(b.search.maxSearchesPerReply, 1, 5, 2);
  b.triggers.replyInDirectMessages = Boolean(b.triggers.replyInDirectMessages);
  b.triggers.replyWhenMentioned = Boolean(b.triggers.replyWhenMentioned);
  b.triggers.replyWhenNameSaid = Boolean(b.triggers.replyWhenNameSaid);
  b.triggers.randomReplyChance = clamp(b.triggers.randomReplyChance, 0, 1, 0);
  b.limits.maxReplyTokens = clamp(b.limits.maxReplyTokens, 50, 8000, 600);
  b.limits.historyMessages = clamp(b.limits.historyMessages, 2, 100, 20);
  b.limits.memoryUpdateEvery = clamp(b.limits.memoryUpdateEvery, 3, 200, 12);
  b.limits.dailyTokenBudget = clamp(b.limits.dailyTokenBudget, 0, 1e10, 0);
  b.limits.maxImagesPerMessage = clamp(b.limits.maxImagesPerMessage, 1, 6, 2);
  for (const c of ["discord", "telegram", "slack", "web"] as const) b.channels[c].enabled = Boolean(b.channels[c].enabled);
  b.channels.web.allowedOrigins = (Array.isArray(b.channels.web.allowedOrigins) ? b.channels.web.allowedOrigins : ["*"])
    .map((o) => String(o).trim())
    .filter(Boolean);
  if (!b.channels.web.allowedOrigins.length) b.channels.web.allowedOrigins = ["*"];
  return b;
}
