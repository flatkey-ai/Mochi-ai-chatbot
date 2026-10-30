import express, { type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import path from "node:path";
import type { Brain } from "../core/brain.ts";
import type { BotRegistry, BotSettings } from "../core/bots.ts";
import { deepMerge, sanitize } from "../core/bots.ts";
import { PRESETS, buildPersonaPrompt, type PresetId } from "../core/persona.ts";
import { maskKey, type ChannelPlatform, type SecretsStore } from "../core/secrets.ts";
import type { Platform } from "../core/types.ts";
import type { ChannelManager } from "../channels/manager.ts";
import { CHANNEL_PLATFORMS } from "../channels/manager.ts";
import type { FlatkeyClient, FlatkeyModel } from "../flatkey/client.ts";
import type { MemoryStore } from "../memory/store.ts";
import type { KnowledgeStore } from "../knowledge/store.ts";
import { extractFileText, fetchUrlText, SUPPORTED_FILE_TYPES } from "../knowledge/ingest.ts";
import { WHY_FLATKEY, flatkeyUrl } from "../flatkey/why.ts";

export interface ServerDeps {
  brain: Brain;
  bots: BotRegistry;
  channels: ChannelManager;
  secrets: SecretsStore;
  envFlatkeyKey?: string;
  store: MemoryStore;
  knowledge: KnowledgeStore;
  flatkey: FlatkeyClient;
  adminToken: string;
  publicUrl: string;
  publicDir: string;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * "fetch failed" alone sends people looking at the wrong platform. When the failure is
 * network/DNS/TLS rather than an API answer, say so and name the host that failed.
 */
function networkHint(err: unknown): string {
  const e = err as Error & { cause?: { code?: string } };
  const msg = e?.message ?? String(err);
  if (/Couldn't reach QQ|Couldn't verify|Flatkey rejected/.test(msg)) return msg;
  const code = e?.cause?.code;
  const networkish =
    err instanceof TypeError ||
    /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|certificate|TLS|aborted|timeout/i.test(msg);
  if (!networkish) return msg;
  return (
    `${msg}${code ? ` (${code})` : ""} — this server can't reach flatkey.ai. ` +
    `Check outbound network / TLS / proxy: Mochi needs router.flatkey.ai and console.flatkey.ai.`
  );
}

export function createServer(d: ServerDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "25mb" }));

  app.get("/", (_req, res) => res.redirect("/dashboard/"));
  app.use("/dashboard", express.static(path.join(d.publicDir, "dashboard")));
  app.use("/widget", express.static(path.join(d.publicDir, "widget"), { setHeaders: (r) => r.setHeader("access-control-allow-origin", "*") }));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  const widgetSnippet = (bot: BotSettings) =>
    `<script src="${d.publicUrl}/widget/widget.js" data-server="${d.publicUrl}" data-bot="${bot.id}" defer></script>`;

  // ── public: web chat widget ─────────────────────────────────────
  const hits = new Map<string, { n: number; reset: number }>();
  const widgetBot = (req: Request): BotSettings | undefined => {
    const id = req.params.botId ? String(req.params.botId) : "";
    return !id || id === "default" ? d.bots.defaultBot() : d.bots.get(id);
  };

  const widgetCors = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const bot = widgetBot(req);
    const allowed = bot?.channels.web.allowedOrigins ?? [];
    if (origin && (allowed.includes("*") || allowed.includes(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };

  const widgetConfig = (req: Request, res: Response) => {
    const bot = widgetBot(req);
    if (!bot) return res.status(404).json({ error: "bot not found" });
    const p = bot.persona;
    res.json({ enabled: bot.channels.web.enabled, name: p.name, avatar: p.avatar, color: p.color, description: p.description, greeting: p.greeting });
  };

  const widgetChat = async (req: Request, res: Response) => {
    const bot = widgetBot(req);
    if (!bot) return res.status(404).json({ error: "bot not found" });
    if (!bot.channels.web.enabled) return res.status(403).json({ error: "web chat is turned off" });
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > 20) return res.status(429).json({ error: "slow down a little ~" });

    const sessionId = String(req.body?.sessionId ?? "").replace(/[^\w-]/g, "").slice(0, 64);
    const text = String(req.body?.text ?? "").slice(0, 4000);
    const image = typeof req.body?.image === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(req.body.image) ? req.body.image : null;
    if (!sessionId || (!text && !image)) return res.status(400).json({ error: "sessionId and text or image are required" });

    const reply = await d.brain.handle({
      botId: bot.id,
      platform: "web",
      roomId: sessionId,
      roomName: "website chat",
      userId: sessionId,
      userName: String(req.body?.name ?? "visitor").slice(0, 40) || "visitor",
      text,
      images: image ? [{ url: image }] : [],
      isDirect: true,
      mentionsBot: true,
    });
    res.json({ reply: reply?.text ?? "", name: bot.persona.name });
  };

  app.options(["/api/widget/chat", "/api/widget/:botId/chat", "/api/widget/:botId/config"], widgetCors);
  app.get("/api/widget/:botId/config", widgetCors, widgetConfig);
  app.post("/api/widget/:botId/chat", widgetCors, widgetChat);
  app.post("/api/widget/chat", widgetCors, widgetChat); // v0.1 snippets without data-bot → first bot

  // ── admin API (dashboard) ───────────────────────────────────────
  const admin = express.Router();
  admin.use((req, res, next) => {
    const got = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(d.adminToken);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: "unauthorized" });
    next();
  });
  const wrap =
    (fn: (req: Request, res: Response) => unknown) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (!res.headersSent) res.status(400).json({ error: networkHint(err) });
      }
    };
  const botOr404 = (req: Request, res: Response): BotSettings | undefined => {
    const bot = d.bots.get(String(req.params.id));
    if (!bot) res.status(404).json({ error: "bot not found" });
    return bot;
  };

  // Flatkey key
  let modelCache: { at: number; models: FlatkeyModel[] } | null = null;
  const flatkeyStatus = () => {
    const dash = d.secrets.flatkeyApiKey;
    const key = dash ?? d.envFlatkeyKey;
    return {
      bound: d.flatkey.hasKey(),
      source: dash ? "dashboard" : d.envFlatkeyKey ? "env" : null,
      masked: maskKey(key),
      keysUrl: flatkeyUrl("keys", "local_deploy", "dashboard_api_key"),
    };
  };
  admin.get("/flatkey", (_req, res) => res.json(flatkeyStatus()));
  admin.put("/flatkey", async (req, res) => {
    const key = String(req.body?.apiKey ?? "").trim();
    if (!key || key.length < 10 || /\s/.test(key)) return res.status(400).json({ error: "That doesn't look like an API key." });
    try {
      const models = await d.flatkey.listModels(key);
      d.secrets.setFlatkeyApiKey(key);
      d.flatkey.setApiKey(key);
      modelCache = { at: Date.now(), models };
      res.json({ ...flatkeyStatus(), models: models.length });
    } catch (err) {
      const status = (err as { status?: number }).status;
      res.status(400).json({
        error:
          status === 401 || status === 403
            ? "Flatkey rejected this key. Check that you copied the whole key and that it's active."
            : `Couldn't verify the key: ${networkHint(err)}`,
      });
    }
  });
  admin.delete("/flatkey", (_req, res) => {
    d.secrets.setFlatkeyApiKey(undefined);
    d.flatkey.setApiKey(d.envFlatkeyKey);
    modelCache = null;
    res.json(flatkeyStatus());
  });

  admin.get("/models", async (_req, res) => {
    try {
      if (!modelCache || Date.now() - modelCache.at > 5 * 60_000) modelCache = { at: Date.now(), models: await d.flatkey.listModels() };
      res.json({ models: modelCache.models });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message, models: [] });
    }
  });

  // Overview: all bots
  const botSummary = (b: BotSettings) => ({
    id: b.id,
    mode: b.mode,
    persona: { name: b.persona.name, avatar: b.persona.avatar, color: b.persona.color, description: b.persona.description },
    features: b.features,
    knowledge: { enabled: b.knowledge.enabled, strict: b.knowledge.strict, docs: d.knowledge.count(b.id) },
    channels: [
      ...d.channels.status(b.id).map((c) => ({ platform: c.platform, bound: c.bound, running: c.running })),
      { platform: "web", bound: true, running: b.channels.web.enabled },
    ],
    tokensToday: d.store.tokensToday(b.id),
    budget: b.limits.dailyTokenBudget,
    ...d.store.counts(b.id),
  });

  admin.get("/overview", (_req, res) => {
    res.json({
      flatkey: flatkeyStatus(),
      whyFlatkey: {
        ...WHY_FLATKEY,
        keysUrl: flatkeyUrl("keys", "dashboard", "why_card"),
        homeUrl: flatkeyUrl("home", "dashboard", "why_card"),
        badgeUrl: flatkeyUrl("home", "dashboard", "sidebar_badge"),
      },
      publicUrl: d.publicUrl,
      tokensToday: d.store.tokensToday(),
      presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, blurb: p.blurb, avatar: p.settings.persona?.avatar })),
      supportedFileTypes: SUPPORTED_FILE_TYPES,
      bots: d.bots.list().map(botSummary),
    });
  });

  admin.get("/pricing", (_req, res) => res.json({ pricing: d.bots.pricing }));
  admin.put("/pricing", (req, res) => res.json({ pricing: d.bots.setPricing(req.body?.pricing) }));

  admin.get("/usage", (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = daysAgo(days - 1);
    const botId = req.query.bot ? String(req.query.bot) : undefined;
    const pricing = d.bots.pricing;
    const rows = d.store.usageSince(since, botId).map((r) => {
      const p = pricing[r.model];
      return { ...r, estCost: p ? (r.promptTokens * p.inputPerM + r.completionTokens * p.outputPerM) / 1e6 : null };
    });
    res.json({ since, rows, byDay: d.store.usageByDay(since, botId) });
  });

  // Bots CRUD
  admin.post(
    "/bots",
    wrap((req, res) => {
      const preset = (String(req.body?.preset ?? "blank") in PRESETS ? req.body.preset : "blank") as PresetId;
      const name = req.body?.name ? String(req.body.name).slice(0, 40) : undefined;
      if (d.bots.list().length >= 50) throw new Error("That's a lot of bots! The limit is 50 per server.");
      res.json({ bot: d.bots.create(preset, { name }) });
    }),
  );

  admin.get("/bots/:id", (req, res) => {
    const bot = botOr404(req, res);
    if (!bot) return;
    res.json({
      bot,
      summary: botSummary(bot),
      channels: d.channels.status(bot.id),
      widgetSnippet: widgetSnippet(bot),
      personaPrompt: buildPersonaPrompt(bot.persona),
    });
  });

  admin.put(
    "/bots/:id",
    wrap(async (req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      const before = bot.persona.description;
      const updated = d.bots.update(bot.id, req.body ?? {});
      if (updated.persona.description !== before) void d.channels.syncProfile(updated).catch(() => {});
      res.json({ bot: updated, personaPrompt: buildPersonaPrompt(updated.persona) });
    }),
  );

  admin.delete(
    "/bots/:id",
    wrap(async (req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      d.bots.delete(bot.id); // throws if it's the last one
      await d.channels.stopBot(bot.id);
      d.secrets.deleteBot(bot.id);
      d.store.forgetBot(bot.id);
      d.knowledge.deleteBot(bot.id);
      res.json({ ok: true });
    }),
  );

  /** Preview the persona prompt for unsaved edits. */
  admin.post("/bots/:id/persona-preview", (req, res) => {
    const bot = botOr404(req, res);
    if (!bot) return;
    const draft = sanitize(deepMerge(structuredClone(bot), { persona: req.body?.persona ?? {} }) as BotSettings);
    res.json({ prompt: buildPersonaPrompt(draft.persona) });
  });

  // Channels
  const isChannel = (p: string): p is ChannelPlatform => (CHANNEL_PLATFORMS as string[]).includes(p);
  admin.put(
    "/bots/:id/channels/:platform",
    wrap(async (req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      const p = String(req.params.platform);
      if (!isChannel(p)) throw new Error("unknown platform");
      res.json({ channel: await d.channels.bind(bot.id, p, req.body ?? {}) });
    }),
  );
  admin.delete(
    "/bots/:id/channels/:platform",
    wrap(async (req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      const p = String(req.params.platform);
      if (!isChannel(p)) throw new Error("unknown platform");
      res.json({ channel: await d.channels.unbind(bot.id, p) });
    }),
  );

  // Knowledge base
  admin.get("/bots/:id/knowledge", (req, res) => {
    const bot = botOr404(req, res);
    if (bot) res.json({ docs: d.knowledge.listDocs(bot.id) });
  });
  admin.get("/bots/:id/knowledge/:docId", (req, res) => {
    const bot = botOr404(req, res);
    if (!bot) return;
    const doc = d.knowledge.getDoc(bot.id, Number(req.params.docId));
    if (!doc) return res.status(404).json({ error: "document not found" });
    res.json({ doc, text: d.knowledge.docText(bot.id, doc.id).slice(0, 20_000) });
  });
  admin.post(
    "/bots/:id/knowledge/text",
    wrap((req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      const text = String(req.body?.text ?? "");
      const title = String(req.body?.title ?? "").trim() || text.trim().split("\n")[0].slice(0, 60) || "Note";
      res.json({ doc: d.knowledge.addDocument(bot.id, title, "text", "", text) });
    }),
  );
  admin.post(
    "/bots/:id/knowledge/file",
    wrap(async (req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      const filename = String(req.body?.filename ?? "").slice(0, 200);
      const b64 = String(req.body?.data ?? "").replace(/^data:[^,]*,/, "");
      if (!filename || !b64) throw new Error("filename and data are required");
      const text = await extractFileText(filename, Buffer.from(b64, "base64"));
      res.json({ doc: d.knowledge.addDocument(bot.id, filename.replace(/\.[a-z0-9]+$/i, ""), "file", filename, text) });
    }),
  );
  admin.post(
    "/bots/:id/knowledge/url",
    wrap(async (req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      const page = await fetchUrlText(String(req.body?.url ?? ""));
      res.json({ doc: d.knowledge.addDocument(bot.id, page.title, "url", page.url, page.text) });
    }),
  );
  admin.delete("/bots/:id/knowledge/:docId", (req, res) => {
    const bot = botOr404(req, res);
    if (!bot) return;
    d.knowledge.deleteDoc(bot.id, Number(req.params.docId));
    res.json({ ok: true });
  });
  /** Try retrieval without spending tokens. */
  admin.post("/bots/:id/knowledge/test", (req, res) => {
    const bot = botOr404(req, res);
    if (!bot) return;
    res.json({ hits: d.knowledge.search(bot.id, String(req.body?.question ?? ""), bot.knowledge.maxChunks) });
  });

  // Memory
  admin.get("/bots/:id/memory", (req, res) => {
    const bot = botOr404(req, res);
    if (bot) res.json({ people: d.store.listPeople(bot.id), rooms: d.store.listRooms(bot.id) });
  });
  admin.delete("/bots/:id/memory/people/:platform/:userId", (req, res) => {
    const bot = botOr404(req, res);
    if (!bot) return;
    d.store.forgetPerson(bot.id, req.params.platform as Platform, String(req.params.userId));
    res.json({ ok: true });
  });
  admin.delete("/bots/:id/memory/rooms/:platform/:roomId", (req, res) => {
    const bot = botOr404(req, res);
    if (!bot) return;
    d.store.forgetRoom(bot.id, req.params.platform as Platform, String(req.params.roomId));
    res.json({ ok: true });
  });

  /** Try a bot from the dashboard without connecting any platform. */
  admin.post(
    "/bots/:id/test-chat",
    wrap(async (req, res) => {
      const bot = botOr404(req, res);
      if (!bot) return;
      const text = String(req.body?.text ?? "").slice(0, 4000);
      const image = typeof req.body?.image === "string" && req.body.image.startsWith("data:image/") ? req.body.image : null;
      if (!text && !image) throw new Error("text required");
      const started = Date.now();
      const reply = await d.brain.handle({
        botId: bot.id,
        platform: "web",
        roomId: "dashboard-playground",
        roomName: "dashboard playground",
        userId: "dashboard-admin",
        userName: String(req.body?.name ?? "admin").slice(0, 40),
        text,
        images: image ? [{ url: image }] : [],
        isDirect: true,
        mentionsBot: true,
      });
      res.json({ reply, ms: Date.now() - started });
    }),
  );

  app.use("/api/admin", admin);
  return app;
}
