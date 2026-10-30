import express, { type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import path from "node:path";
import type { Brain } from "../core/brain.ts";
import type { SettingsStore } from "../core/settings.ts";
import { maskKey, type SecretsStore } from "../core/secrets.ts";
import type { Platform, PlatformAdapter } from "../core/types.ts";
import type { FlatkeyClient, FlatkeyModel } from "../flatkey/client.ts";
import type { MemoryStore } from "../memory/store.ts";
import { WHY_FLATKEY, flatkeyUrl } from "../flatkey/why.ts";

export interface ServerDeps {
  brain: Brain;
  settings: SettingsStore;
  secrets: SecretsStore;
  envFlatkeyKey?: string;
  store: MemoryStore;
  flatkey: FlatkeyClient;
  adapters: () => Partial<Record<Platform, PlatformAdapter>>;
  configured: Record<Platform, boolean>;
  adminToken: string;
  publicUrl: string;
  publicDir: string;
}

const PLATFORMS: Platform[] = ["discord", "telegram", "slack", "web"];

export function createServer(d: ServerDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  app.get("/", (_req, res) => res.redirect("/dashboard/"));
  app.use("/dashboard", express.static(path.join(d.publicDir, "dashboard")));
  app.use("/widget", express.static(path.join(d.publicDir, "widget"), { setHeaders: (r) => r.setHeader("access-control-allow-origin", "*") }));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // ── public: web chat widget ─────────────────────────────────────
  const hits = new Map<string, { n: number; reset: number }>();
  const widgetCors = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowed = d.settings.get().platforms.web.allowedOrigins;
    if (origin && (allowed.includes("*") || allowed.includes(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
  app.options("/api/widget/chat", widgetCors);
  app.post("/api/widget/chat", widgetCors, async (req, res) => {
    const s = d.settings.get();
    if (!s.platforms.web.enabled) return res.status(403).json({ error: "web chat is turned off" });
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
    res.json({ reply: reply?.text ?? "", name: s.persona.name });
  });

  // ── admin API (dashboard) ───────────────────────────────────────
  const admin = express.Router();
  admin.use((req, res, next) => {
    const got = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(d.adminToken);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: "unauthorized" });
    next();
  });

  let modelCache: { at: number; models: FlatkeyModel[] } | null = null;
  const flatkeyStatus = () => {
    const dash = d.secrets.flatkeyApiKey;
    const key = dash ?? d.envFlatkeyKey;
    return {
      bound: d.flatkey.hasKey(),
      source: dash ? "dashboard" : d.envFlatkeyKey ? "env" : null,
      masked: maskKey(key),
      // Where users create the key they bind here.
      keysUrl: flatkeyUrl("keys", "local_deploy", "dashboard_api_key"),
    };
  };

  admin.get("/flatkey", (_req, res) => res.json(flatkeyStatus()));

  /** Bind a Flatkey API key: verify it against Flatkey, then save it. */
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
        error: status === 401 || status === 403 ? "Flatkey rejected this key. Check that you copied the whole key and that it's active." : `Couldn't verify the key: ${(err as Error).message}`,
      });
    }
  });

  /** Unbind the dashboard key (falls back to FLATKEY_API_KEY in .env, if any). */
  admin.delete("/flatkey", (_req, res) => {
    d.secrets.setFlatkeyApiKey(undefined);
    d.flatkey.setApiKey(d.envFlatkeyKey);
    modelCache = null;
    res.json(flatkeyStatus());
  });

  admin.get("/overview", (_req, res) => {
    const adapters = d.adapters();
    const s = d.settings.get();
    res.json({
      settings: s,
      flatkeyBaseUrl: d.flatkey.baseUrl,
      flatkey: flatkeyStatus(),
      whyFlatkey: {
        ...WHY_FLATKEY,
        keysUrl: flatkeyUrl("keys", "dashboard", "why_card"),
        homeUrl: flatkeyUrl("home", "dashboard", "why_card"),
        badgeUrl: flatkeyUrl("home", "dashboard", "sidebar_badge"),
      },
      publicUrl: d.publicUrl,
      tokensToday: d.store.tokensToday(),
      platforms: PLATFORMS.map((p) => ({
        platform: p,
        configured: d.configured[p],
        enabled: s.platforms[p].enabled,
        ...(p === "web" ? { running: s.platforms.web.enabled, detail: "built in" } : (adapters[p]?.status() ?? { running: false, detail: d.configured[p] ? "stopped" : "no token in .env" })),
      })),
    });
  });

  admin.put("/settings", (req, res) => {
    try {
      res.json({ settings: d.settings.update(req.body ?? {}) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  admin.get("/models", async (_req, res) => {
    try {
      if (!modelCache || Date.now() - modelCache.at > 5 * 60_000) modelCache = { at: Date.now(), models: await d.flatkey.listModels() };
      res.json({ models: modelCache.models });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message, models: [] });
    }
  });

  admin.get("/usage", (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const pricing = d.settings.get().pricing;
    const rows = d.store.usageSince(since).map((r) => {
      const p = pricing[r.model];
      return { ...r, estCost: p ? (r.promptTokens * p.inputPerM + r.completionTokens * p.outputPerM) / 1e6 : null };
    });
    res.json({ since, rows, byDay: d.store.usageByDay(since) });
  });

  admin.get("/memory", (_req, res) => {
    res.json({ people: d.store.listPeople(), rooms: d.store.listRooms() });
  });
  admin.delete("/memory/people/:platform/:userId", (req, res) => {
    d.store.forgetPerson(req.params.platform as Platform, String(req.params.userId));
    res.json({ ok: true });
  });
  admin.delete("/memory/rooms/:platform/:roomId", (req, res) => {
    d.store.forgetRoom(req.params.platform as Platform, String(req.params.roomId));
    res.json({ ok: true });
  });

  /** Try Mochi from the dashboard without connecting any platform. */
  admin.post("/test-chat", async (req, res) => {
    const text = String(req.body?.text ?? "").slice(0, 4000);
    const image = typeof req.body?.image === "string" && req.body.image.startsWith("data:image/") ? req.body.image : null;
    if (!text && !image) return res.status(400).json({ error: "text required" });
    const started = Date.now();
    const reply = await d.brain.handle({
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
  });

  app.use("/api/admin", admin);
  return app;
}
