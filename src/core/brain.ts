import type { ChatContentPart, ChatMessage, FlatkeyClient, ToolDef } from "../flatkey/client.ts";
import type { MemoryStore, Person, StoredMessage } from "../memory/store.ts";
import type { MemoryUpdater } from "../memory/updater.ts";
import type { SearchAbility } from "../abilities/search.ts";
import type { KnowledgeHit, KnowledgeStore } from "../knowledge/store.ts";
import type { BotRegistry, BotSettings } from "./bots.ts";
import { buildPersonaPrompt } from "./persona.ts";
import { FORGET_ME, builtinReply } from "./i18n.ts";
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

const KNOWLEDGE_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "search_knowledge",
    description:
      "Search your own knowledge base (the documents your owner uploaded: docs, FAQs, policies). " +
      "Use different keywords or another language if the excerpts you have don't answer the question.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Keywords to look up" } },
      required: ["query"],
    },
  },
};

const MAX_TOOL_ROUNDS = 4;

export interface BrainDeps {
  flatkey: FlatkeyClient;
  store: MemoryStore;
  knowledge: KnowledgeStore;
  updater: MemoryUpdater;
  search: SearchAbility;
  bots: BotRegistry;
  /** Overridable for tests. */
  random?: () => number;
}

/**
 * The platform-agnostic core, shared by every bot: decides whether to reply, assembles
 * persona + memory + knowledge into context, runs chat / vision / search through Flatkey,
 * records usage, and feeds the memory updater.
 */
export class Brain {
  constructor(private readonly d: BrainDeps) {}

  async handle(msg: IncomingMessage): Promise<BotReply | null> {
    const bot = this.d.bots.get(msg.botId);
    if (!bot) return null;
    const { store } = this.d;
    const ts = msg.timestamp ?? Date.now();

    // History is read BEFORE storing the new message so it isn't duplicated in the prompt.
    const history = store.recentMessages(bot.id, msg.platform, msg.roomId, bot.limits.historyMessages);

    store.touchPerson(bot.id, msg.platform, msg.userId, msg.userName, ts);
    store.addMessage({
      botId: bot.id,
      platform: msg.platform,
      roomId: msg.roomId,
      userId: msg.userId,
      userName: msg.userName,
      text: msg.text,
      hasImage: msg.images.length > 0,
      isBot: false,
      ts,
    });
    const due = store.bumpRoom(bot.id, msg.platform, msg.roomId, msg.roomName);

    const reply = await this.respond(bot, msg, history).catch((err) => {
      console.error(`[brain:${bot.id}] reply failed:`, err?.message ?? err);
      return msg.isDirect || msg.mentionsBot
        ? { text: builtinReply("glitch", msg.text), usedSearch: false, usedVision: false }
        : null;
    });

    if (reply) {
      store.addMessage({
        botId: bot.id,
        platform: msg.platform,
        roomId: msg.roomId,
        userId: "bot",
        userName: bot.persona.name,
        text: reply.text,
        hasImage: false,
        isBot: true,
        ts: Date.now(),
      });
    }
    this.d.updater.maybeUpdate(bot.id, msg.platform, msg.roomId, due);
    return reply;
  }

  shouldReply(bot: BotSettings, msg: IncomingMessage): boolean {
    const t = bot.triggers;
    if (msg.isDirect) return t.replyInDirectMessages;
    if (msg.mentionsBot && t.replyWhenMentioned) return true;
    if (t.replyWhenNameSaid) {
      const names = [bot.persona.name.toLowerCase(), ...bot.persona.nicknames];
      const lower = msg.text.toLowerCase();
      if (names.some((n) => n && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}([^\\p{L}\\p{N}]|$)`, "u").test(lower)))
        return true;
    }
    return t.randomReplyChance > 0 && (this.d.random ?? Math.random)() < t.randomReplyChance;
  }

  private async respond(bot: BotSettings, msg: IncomingMessage, history: StoredMessage[]): Promise<BotReply | null> {
    if (!this.shouldReply(bot, msg)) return null;
    const plain = (text: string): BotReply => ({ text, usedSearch: false, usedVision: false });

    if (FORGET_ME.test(msg.text)) {
      this.d.store.forgetPerson(bot.id, msg.platform, msg.userId);
      return plain(builtinReply("forgot", msg.text, { name: msg.userName }));
    }
    if (!this.d.flatkey.hasKey()) {
      return msg.isDirect || msg.mentionsBot
        ? plain(builtinReply("asleep", msg.text))
        : null;
    }
    if (bot.limits.dailyTokenBudget > 0 && this.d.store.tokensToday(bot.id) >= bot.limits.dailyTokenBudget) {
      return msg.isDirect || msg.mentionsBot ? plain(builtinReply("budget", msg.text)) : null;
    }

    // ── knowledge base ──
    const kbDocs = bot.knowledge.enabled ? this.d.knowledge.count(bot.id) : 0;
    const strict = bot.knowledge.enabled && bot.knowledge.strict;
    if (strict && kbDocs === 0) return plain(bot.knowledge.fallbackMessage);
    const kbHits = kbDocs && msg.text ? this.d.knowledge.search(bot.id, msg.text, bot.knowledge.maxChunks) : [];
    const usedDocs = new Map<number, string>();
    for (const h of kbHits) usedDocs.set(h.docId, h.title);

    const useVision = bot.features.vision && msg.images.length > 0;
    const model = useVision ? bot.models.vision : bot.models.chat;
    const feature = useVision ? "vision" : "chat";

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt(bot, msg, history, kbDocs, kbHits) },
      ...history.map(toChatMessage),
      { role: "user", content: this.currentContent(bot, msg, useVision) },
    ];

    // In strict Q&A mode the bot answers from the knowledge base only, so no web search.
    const allowWeb = bot.features.search && !strict;
    const tools: ToolDef[] = [...(kbDocs ? [KNOWLEDGE_TOOL] : []), ...(allowWeb ? [SEARCH_TOOL] : [])];
    let usedSearch = false;
    let webSearches = 0;
    let kbSearches = 0;
    const sources: { title: string; url: string }[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const offerTools = tools.length > 0 && round < MAX_TOOL_ROUNDS;
      const { message, usage } = await this.d.flatkey.chat({
        model,
        messages,
        maxTokens: bot.limits.maxReplyTokens,
        tools: offerTools ? tools : undefined,
      });
      this.d.store.recordUsage(bot.id, feature, model, usage.promptTokens, usage.completionTokens);

      const calls = message.tool_calls ?? [];
      if (!calls.length || !offerTools) {
        let text = stripSpeakerPrefix(contentToText(message.content), bot.persona.name);
        if (!text) return null;
        if (sources.length) text += "\n\n" + sources.slice(0, 3).map((x) => `🔗 ${x.url}`).join("\n");
        return {
          text,
          usedSearch,
          usedVision: useVision,
          usedKnowledge: [...usedDocs].map(([docId, title]) => ({ docId, title })),
        };
      }

      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const query = safeQuery(call.function?.arguments ?? "") || msg.text;
        let output: string;
        if (call.function?.name === "search_knowledge" && kbDocs && kbSearches < 3) {
          kbSearches++;
          const hits = this.d.knowledge.search(bot.id, query, bot.knowledge.maxChunks);
          for (const h of hits) usedDocs.set(h.docId, h.title);
          output = hits.length ? formatHits(hits) : "No matching passages in the knowledge base.";
        } else if (call.function?.name === "web_search" && allowWeb && webSearches < bot.search.maxSearchesPerReply) {
          webSearches++;
          usedSearch = true;
          try {
            const r = await this.d.search.search(query, bot);
            this.d.store.recordUsage(bot.id, "search", r.model, r.promptTokens, r.completionTokens);
            sources.push(...r.sources);
            output = JSON.stringify({ answer: r.answer, sources: r.sources.slice(0, 4) });
          } catch (err) {
            output = `Search failed (${(err as Error).message}). Answer with what you know and say you couldn't verify it.`;
          }
        } else {
          output = "Tool unavailable or limit reached. Answer now with what you have.";
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
    return null;
  }

  private systemPrompt(bot: BotSettings, msg: IncomingMessage, history: StoredMessage[], kbDocs: number, kbHits: KnowledgeHit[]): string {
    const parts: string[] = [buildPersonaPrompt(bot.persona)];
    const where = msg.isDirect
      ? `a private chat on ${msg.platform} with ${msg.userName}`
      : `the group chat "${msg.roomName || msg.roomId}" on ${msg.platform}`;
    parts.push(`## Right now\nYou are in ${where}. Current time: ${new Date().toUTCString()}.`);

    if (bot.features.memory) {
      const room = this.d.store.getRoom(bot.id, msg.platform, msg.roomId);
      if (room && (room.summary || room.recentTopics.length)) {
        parts.push(
          `## What this chat has been about\n${room.summary}` +
            (room.recentTopics.length ? `\nRecent topics: ${room.recentTopics.join(", ")}` : ""),
        );
      }
      const ids = [msg.userId, ...history.filter((h) => !h.isBot).map((h) => h.userId)];
      const people = this.d.store.getPeople(bot.id, msg.platform, [...new Set(ids)]).filter(hasProfile);
      if (people.length) parts.push(`## People you know here\n${people.map(describePerson).join("\n")}`);
    }

    if (kbDocs) {
      parts.push(
        `## Knowledge base\nYour owner gave you ${kbDocs} document(s). ` +
          (kbHits.length
            ? `Passages that may answer the latest message:\n\n${formatHits(kbHits)}`
            : "No passage matched the latest message yet; call search_knowledge with other keywords if it's a question."),
      );
    }

    const rules = [
      `Messages from others are shown as "Name: text". Reply as ${bot.persona.name} with just your message — no name prefix.`,
      `You are replying to ${msg.userName}.`,
    ];
    if (bot.features.memory) rules.push("Use what you remember about people naturally; don't recite their profile back at them.");
    rules.push("Write plain chat text. Light markdown is fine; no headings.");
    if (kbDocs) {
      rules.push(
        bot.knowledge.strict
          ? `Answer ONLY from the knowledge base passages (search_knowledge can find more). If they don't contain the answer, reply with this message (translated to the user's language if needed): "${bot.knowledge.fallbackMessage}". Never guess.`
          : "When the knowledge base covers the question, base your answer on it over general knowledge.",
      );
      rules.push("Don't mention passage numbers or say 'according to the knowledge base'; just answer.");
    }
    if (bot.features.search && !(kbDocs && bot.knowledge.strict))
      rules.push("When a question needs current or factual info you're unsure about, call web_search instead of guessing.");
    else if (!bot.knowledge.strict) rules.push("You can't browse the web right now; if asked for live info, say you can't check.");
    if (!bot.features.vision) rules.push("You can't see images right now; if someone sends one, say so kindly.");
    parts.push(`## How to reply\n- ${rules.join("\n- ")}`);
    return parts.join("\n\n");
  }

  private currentContent(bot: BotSettings, msg: IncomingMessage, useVision: boolean): string | ChatContentPart[] {
    const label = `${msg.userName}: ${msg.text || ""}`.trim();
    if (!msg.images.length) return label;
    if (!useVision) return `${label} [sent ${msg.images.length} image(s) — you can't see images right now]`;
    const imgs = msg.images.slice(0, bot.limits.maxImagesPerMessage);
    return [
      { type: "text", text: msg.text ? label : `${msg.userName} sent an image.` },
      ...imgs.map((i) => ({ type: "image_url" as const, image_url: { url: i.url } })),
    ];
  }
}

function formatHits(hits: KnowledgeHit[]): string {
  return hits.map((h, i) => `[${i + 1}] (from "${h.title}")\n${h.text}`).join("\n\n");
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
