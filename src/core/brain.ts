import type { ChatContentPart, ChatMessage, FlatkeyClient, ToolDef } from "../flatkey/client.ts";
import type { MemoryStore, Person, StoredMessage } from "../memory/store.ts";
import type { MemoryUpdater } from "../memory/updater.ts";
import type { SearchAbility } from "../abilities/search.ts";
import type { Settings } from "./settings.ts";
import type { BotReply, IncomingMessage } from "./types.ts";

const SEARCH_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for facts you are not sure about: news, prices, dates, recent events, " +
      "who/what/where questions, or anything after your training data. Returns a short grounded answer with sources.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A focused search query" } },
      required: ["query"],
    },
  },
};

const FORGET_ME = /\b(forget me|forget about me|delete my (data|memory))\b/i;

export interface BrainDeps {
  flatkey: FlatkeyClient;
  store: MemoryStore;
  updater: MemoryUpdater;
  search: SearchAbility;
  getSettings: () => Settings;
  /** Overridable for tests. */
  random?: () => number;
}

/**
 * The platform-agnostic core: decides whether to reply, assembles memory into context,
 * runs chat / vision / search through Flatkey, records usage, and feeds the memory updater.
 */
export class Brain {
  constructor(private readonly d: BrainDeps) {}

  async handle(msg: IncomingMessage): Promise<BotReply | null> {
    const s = this.d.getSettings();
    const { store } = this.d;
    const ts = msg.timestamp ?? Date.now();

    // History is read BEFORE storing the new message so it isn't duplicated in the prompt.
    const history = store.recentMessages(msg.platform, msg.roomId, s.limits.historyMessages);

    store.touchPerson(msg.platform, msg.userId, msg.userName, ts);
    store.addMessage({
      platform: msg.platform,
      roomId: msg.roomId,
      userId: msg.userId,
      userName: msg.userName,
      text: msg.text,
      hasImage: msg.images.length > 0,
      isBot: false,
      ts,
    });
    const due = store.bumpRoom(msg.platform, msg.roomId, msg.roomName);

    const reply = await this.respond(msg, history, s).catch((err) => {
      console.error(`[brain] reply failed:`, err?.message ?? err);
      return msg.isDirect || msg.mentionsBot
        ? { text: "oops, my brain glitched for a sec (╥﹏╥) try again?", usedSearch: false, usedVision: false }
        : null;
    });

    if (reply) {
      store.addMessage({
        platform: msg.platform,
        roomId: msg.roomId,
        userId: "bot",
        userName: s.persona.name,
        text: reply.text,
        hasImage: false,
        isBot: true,
        ts: Date.now(),
      });
    }
    this.d.updater.maybeUpdate(msg.platform, msg.roomId, due);
    return reply;
  }

  shouldReply(msg: IncomingMessage, s: Settings): boolean {
    const t = s.triggers;
    if (msg.isDirect) return t.replyInDirectMessages;
    if (msg.mentionsBot && t.replyWhenMentioned) return true;
    if (t.replyWhenNameSaid) {
      const names = [s.persona.name.toLowerCase(), ...s.persona.nicknames];
      const lower = msg.text.toLowerCase();
      if (names.some((n) => n && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}([^\\p{L}\\p{N}]|$)`, "u").test(lower)))
        return true;
    }
    return t.randomReplyChance > 0 && (this.d.random ?? Math.random)() < t.randomReplyChance;
  }

  private async respond(msg: IncomingMessage, history: StoredMessage[], s: Settings): Promise<BotReply | null> {
    if (!this.shouldReply(msg, s)) return null;

    if (FORGET_ME.test(msg.text)) {
      this.d.store.forgetPerson(msg.platform, msg.userId);
      return { text: `done — i've forgotten everything i knew about you, ${msg.userName}. fresh start ✨`, usedSearch: false, usedVision: false };
    }

    if (!this.d.flatkey.hasKey()) {
      return msg.isDirect || msg.mentionsBot
        ? { text: "i'm not awake yet (˘ω˘) my admin needs to bind a Flatkey API key in my dashboard first!", usedSearch: false, usedVision: false }
        : null;
    }

    if (s.limits.dailyTokenBudget > 0 && this.d.store.tokensToday() >= s.limits.dailyTokenBudget) {
      return msg.isDirect || msg.mentionsBot
        ? { text: "i'm all out of energy for today (daily budget reached) — catch you tomorrow! 💤", usedSearch: false, usedVision: false }
        : null;
    }

    const useVision = s.features.vision && msg.images.length > 0;
    const model = useVision ? s.models.vision : s.models.chat;
    const feature = useVision ? "vision" : "chat";

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt(msg, history, s) },
      ...history.map(toChatMessage),
      { role: "user", content: this.currentContent(msg, s, useVision) },
    ];

    const tools = s.features.search ? [SEARCH_TOOL] : undefined;
    let usedSearch = false;
    let searches = 0;
    const sources: { title: string; url: string }[] = [];

    for (let round = 0; round <= s.search.maxSearchesPerReply; round++) {
      const allowTools = tools && searches < s.search.maxSearchesPerReply;
      const { message, usage } = await this.d.flatkey.chat({
        model,
        messages,
        maxTokens: s.limits.maxReplyTokens,
        tools: allowTools ? tools : undefined,
      });
      this.d.store.recordUsage(feature, model, usage.promptTokens, usage.completionTokens);

      const calls = message.tool_calls ?? [];
      if (!calls.length || !allowTools) {
        let text = contentToText(message.content);
        text = stripSpeakerPrefix(text, s.persona.name);
        if (!text) return null;
        if (sources.length) text += "\n\n" + sources.slice(0, 3).map((x) => `🔗 ${x.url}`).join("\n");
        return { text, usedSearch, usedVision: useVision };
      }

      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        let output: string;
        if (call.function?.name !== "web_search" || searches >= s.search.maxSearchesPerReply) {
          output = "Tool unavailable. Answer with what you know and say if you're unsure.";
        } else {
          searches++;
          usedSearch = true;
          const query = safeQuery(call.function.arguments) || msg.text;
          try {
            const r = await this.d.search.search(query);
            this.d.store.recordUsage("search", r.model, r.promptTokens, r.completionTokens);
            sources.push(...r.sources);
            output = JSON.stringify({ answer: r.answer, sources: r.sources.slice(0, 4) });
          } catch (err) {
            output = `Search failed (${(err as Error).message}). Answer with what you know and say you couldn't verify it.`;
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
    return null;
  }

  private systemPrompt(msg: IncomingMessage, history: StoredMessage[], s: Settings): string {
    const parts: string[] = [s.persona.systemPrompt.trim()];
    const where = msg.isDirect
      ? `a private chat on ${msg.platform} with ${msg.userName}`
      : `the group chat "${msg.roomName || msg.roomId}" on ${msg.platform}`;
    parts.push(`## Right now\nYou are in ${where}. Current time: ${new Date().toUTCString()}.`);

    if (s.features.memory) {
      const room = this.d.store.getRoom(msg.platform, msg.roomId);
      if (room && (room.summary || room.recentTopics.length)) {
        parts.push(
          `## What this chat has been about\n${room.summary}` +
            (room.recentTopics.length ? `\nRecent topics: ${room.recentTopics.join(", ")}` : ""),
        );
      }
      const ids = [msg.userId, ...history.filter((h) => !h.isBot).map((h) => h.userId)];
      const people = this.d.store.getPeople(msg.platform, [...new Set(ids)]).filter(hasProfile);
      if (people.length) parts.push(`## People you know here\n${people.map(describePerson).join("\n")}`);
    }

    const rules = [
      `Messages from others are shown as "Name: text". Reply as ${s.persona.name} with just your message — no name prefix.`,
      `You are replying to ${msg.userName}.`,
      "Use what you remember about people naturally; don't recite their profile back at them.",
      "Write plain chat text. Light markdown is fine; no headings.",
    ];
    if (s.features.search) rules.push("When a question needs current or factual info you're unsure about, call web_search instead of guessing.");
    else rules.push("You can't browse the web right now; if asked for live info, say you can't check.");
    if (!s.features.vision) rules.push("You can't see images right now; if someone sends one, say so kindly.");
    parts.push(`## How to reply\n- ${rules.join("\n- ")}`);
    return parts.join("\n\n");
  }

  private currentContent(msg: IncomingMessage, s: Settings, useVision: boolean): string | ChatContentPart[] {
    const label = `${msg.userName}: ${msg.text || ""}`.trim();
    if (!msg.images.length) return label;
    if (!useVision) return `${label} [sent ${msg.images.length} image(s) — you can't see images right now]`;
    const imgs = msg.images.slice(0, s.limits.maxImagesPerMessage);
    return [
      { type: "text", text: msg.text ? label : `${msg.userName} sent an image.` },
      ...imgs.map((i) => ({ type: "image_url" as const, image_url: { url: i.url } })),
    ];
  }
}

function toChatMessage(m: StoredMessage): ChatMessage {
  if (m.isBot) return { role: "assistant", content: m.text };
  return { role: "user", content: `${m.userName}: ${m.text}${m.hasImage ? " [image]" : ""}` };
}

function hasProfile(p: Person): boolean {
  return Boolean(p.personality || p.facts.length || p.interests.length);
}

function describePerson(p: Person): string {
  const bits = [`- **${p.displayName}**`];
  if (p.personality) bits.push(`personality: ${p.personality}`);
  if (p.facts.length) bits.push(`facts: ${p.facts.join("; ")}`);
  if (p.interests.length) bits.push(`into: ${p.interests.join(", ")}`);
  return bits.join(" — ");
}

function contentToText(c: ChatMessage["content"]): string {
  if (!c) return "";
  if (typeof c === "string") return c.trim();
  return c
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

function stripSpeakerPrefix(text: string, name: string): string {
  return text.replace(new RegExp(`^\\s*${escapeRe(name)}\\s*:\\s*`, "i"), "").trim();
}

function safeQuery(args: string): string {
  try {
    return String(JSON.parse(args)?.query ?? "").slice(0, 300);
  } catch {
    return "";
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
