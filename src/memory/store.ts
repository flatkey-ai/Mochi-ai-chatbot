import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Platform } from "../core/types.ts";

export interface StoredMessage {
  id: number;
  botId: string;
  platform: Platform;
  roomId: string;
  userId: string;
  userName: string;
  text: string;
  hasImage: boolean;
  isBot: boolean;
  ts: number;
}

export interface Person {
  botId: string;
  platform: Platform;
  userId: string;
  displayName: string;
  personality: string;
  facts: string[];
  interests: string[];
  messageCount: number;
  firstSeen: number;
  lastSeen: number;
}

export interface Room {
  botId: string;
  platform: Platform;
  roomId: string;
  title: string;
  summary: string;
  recentTopics: string[];
  msgsSinceUpdate: number;
  updatedAt: number;
}

export interface UsageRow {
  botId: string;
  feature: string;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

const MAX_MESSAGES_PER_ROOM = 300;

/**
 * Every bot's memory, in one SQLite file (Node's built-in node:sqlite, no native deps).
 * All rows are scoped by bot_id: each bot remembers people and rooms on its own.
 * - messages: short-term chat history per room
 * - people:   long-term profile per person (personality, facts, interests)
 * - rooms:    rolling summary + recent topics per chat room
 * - usage:    token usage per bot/feature/model, for the dashboard and budgets
 * (Knowledge base tables live in knowledge/store.ts on the same database.)
 */
export class MemoryStore {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(path.join(dataDir, "mochi.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrateV1();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL,
        platform TEXT NOT NULL, room_id TEXT NOT NULL,
        user_id TEXT NOT NULL, user_name TEXT NOT NULL,
        text TEXT NOT NULL, has_image INTEGER NOT NULL DEFAULT 0,
        is_bot INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(bot_id, platform, room_id, id);
      CREATE TABLE IF NOT EXISTS people (
        bot_id TEXT NOT NULL, platform TEXT NOT NULL, user_id TEXT NOT NULL,
        display_name TEXT NOT NULL, personality TEXT NOT NULL DEFAULT '',
        facts TEXT NOT NULL DEFAULT '[]', interests TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        PRIMARY KEY (bot_id, platform, user_id)
      );
      CREATE TABLE IF NOT EXISTS rooms (
        bot_id TEXT NOT NULL, platform TEXT NOT NULL, room_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
        recent_topics TEXT NOT NULL DEFAULT '[]',
        msgs_since_update INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (bot_id, platform, room_id)
      );
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL,
        day TEXT NOT NULL, ts INTEGER NOT NULL,
        feature TEXT NOT NULL, model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_day ON usage(bot_id, day);
    `);
  }

  /** v0.1 had no bot_id. Rebuild those tables, assigning existing rows to bot "mochi". */
  private migrateV1(): void {
    const cols = this.db.prepare(`PRAGMA table_info(people)`).all() as any[];
    if (!cols.length || cols.some((c) => c.name === "bot_id")) return;
    this.db.exec(`
      BEGIN;
      ALTER TABLE messages RENAME TO messages_v1;
      ALTER TABLE people RENAME TO people_v1;
      ALTER TABLE rooms RENAME TO rooms_v1;
      ALTER TABLE usage RENAME TO usage_v1;
      DROP INDEX IF EXISTS idx_messages_room;
      DROP INDEX IF EXISTS idx_usage_day;
      COMMIT;
    `);
    // Recreate with the new schema, copy rows over, drop the old tables.
    this.db.exec(`
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, platform TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, text TEXT NOT NULL, has_image INTEGER NOT NULL DEFAULT 0, is_bot INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL);
      CREATE TABLE people (bot_id TEXT NOT NULL, platform TEXT NOT NULL, user_id TEXT NOT NULL, display_name TEXT NOT NULL, personality TEXT NOT NULL DEFAULT '', facts TEXT NOT NULL DEFAULT '[]', interests TEXT NOT NULL DEFAULT '[]', message_count INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (bot_id, platform, user_id));
      CREATE TABLE rooms (bot_id TEXT NOT NULL, platform TEXT NOT NULL, room_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', recent_topics TEXT NOT NULL DEFAULT '[]', msgs_since_update INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bot_id, platform, room_id));
      CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, day TEXT NOT NULL, ts INTEGER NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL, prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL);
      INSERT INTO messages (bot_id, platform, room_id, user_id, user_name, text, has_image, is_bot, ts) SELECT 'mochi', platform, room_id, user_id, user_name, text, has_image, is_bot, ts FROM messages_v1 ORDER BY id;
      INSERT INTO people SELECT 'mochi', platform, user_id, display_name, personality, facts, interests, message_count, first_seen, last_seen FROM people_v1;
      INSERT INTO rooms SELECT 'mochi', platform, room_id, title, summary, recent_topics, msgs_since_update, updated_at FROM rooms_v1;
      INSERT INTO usage (bot_id, day, ts, feature, model, prompt_tokens, completion_tokens) SELECT 'mochi', day, ts, feature, model, prompt_tokens, completion_tokens FROM usage_v1;
      DROP TABLE messages_v1; DROP TABLE people_v1; DROP TABLE rooms_v1; DROP TABLE usage_v1;
    `);
    console.log("[mochi] migrated memory database to multi-bot schema");
  }

  // ── messages ────────────────────────────────────────────────────

  addMessage(m: Omit<StoredMessage, "id">): void {
    this.db
      .prepare(
        `INSERT INTO messages (bot_id, platform, room_id, user_id, user_name, text, has_image, is_bot, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.botId, m.platform, m.roomId, m.userId, m.userName, m.text, m.hasImage ? 1 : 0, m.isBot ? 1 : 0, m.ts);
    this.db
      .prepare(
        `DELETE FROM messages WHERE bot_id = ? AND platform = ? AND room_id = ? AND id NOT IN (
           SELECT id FROM messages WHERE bot_id = ? AND platform = ? AND room_id = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(m.botId, m.platform, m.roomId, m.botId, m.platform, m.roomId, MAX_MESSAGES_PER_ROOM);
  }

  recentMessages(botId: string, platform: Platform, roomId: string, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE bot_id = ? AND platform = ? AND room_id = ? ORDER BY id DESC LIMIT ?`)
      .all(botId, platform, roomId, limit) as any[];
    return rows.reverse().map(rowToMessage);
  }

  /**
   * Look further back than the window that fits in the prompt: "what were we talking about
   * before?" needs the older lines of *this* room, not a wider dump of every room.
   */
  searchMessages(botId: string, platform: Platform, roomId: string, query: string, limit = 12): StoredMessage[] {
    const terms = String(query ?? "")
      .toLowerCase()
      .split(/[\s,，。!?！？、;；:：]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .slice(0, 6);
    let rows: any[];
    if (terms.length) {
      const where = terms.map(() => "lower(text) LIKE ?").join(" OR ");
      rows = this.db
        .prepare(
          `SELECT * FROM messages WHERE bot_id = ? AND platform = ? AND room_id = ? AND (${where}) ORDER BY id DESC LIMIT ?`,
        )
        .all(botId, platform, roomId, ...terms.map((t) => `%${t}%`), limit) as any[];
    } else {
      rows = this.db
        .prepare(`SELECT * FROM messages WHERE bot_id = ? AND platform = ? AND room_id = ? ORDER BY id DESC LIMIT ?`)
        .all(botId, platform, roomId, limit) as any[];
    }
    return rows.reverse().map(rowToMessage);
  }

  /** How many messages this room has stored (to tell the model what it is missing). */
  countMessages(botId: string, platform: Platform, roomId: string): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM messages WHERE bot_id = ? AND platform = ? AND room_id = ?`)
      .get(botId, platform, roomId) as any;
    return Number(r?.n ?? 0);
  }

  // ── people ──────────────────────────────────────────────────────

  touchPerson(botId: string, platform: Platform, userId: string, displayName: string, ts: number): void {
    this.db
      .prepare(
        `INSERT INTO people (bot_id, platform, user_id, display_name, message_count, first_seen, last_seen)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(bot_id, platform, user_id) DO UPDATE SET
           display_name = excluded.display_name,
           message_count = message_count + 1,
           last_seen = excluded.last_seen`,
      )
      .run(botId, platform, userId, displayName, ts, ts);
  }

  getPerson(botId: string, platform: Platform, userId: string): Person | undefined {
    const r = this.db
      .prepare(`SELECT * FROM people WHERE bot_id = ? AND platform = ? AND user_id = ?`)
      .get(botId, platform, userId);
    return r ? rowToPerson(r) : undefined;
  }

  getPeople(botId: string, platform: Platform, userIds: string[]): Person[] {
    return userIds.map((id) => this.getPerson(botId, platform, id)).filter((p): p is Person => Boolean(p));
  }

  updatePersonProfile(
    botId: string,
    platform: Platform,
    userId: string,
    patch: { personality?: string; facts?: string[]; interests?: string[] },
  ): void {
    const p = this.getPerson(botId, platform, userId);
    if (!p) return;
    this.db
      .prepare(
        `UPDATE people SET personality = ?, facts = ?, interests = ? WHERE bot_id = ? AND platform = ? AND user_id = ?`,
      )
      .run(
        (patch.personality ?? p.personality).slice(0, 500),
        JSON.stringify((patch.facts ?? p.facts).slice(0, 15)),
        JSON.stringify((patch.interests ?? p.interests).slice(0, 10)),
        botId,
        platform,
        userId,
      );
  }

  listPeople(botId: string, limit = 200): Person[] {
    return (
      this.db.prepare(`SELECT * FROM people WHERE bot_id = ? ORDER BY last_seen DESC LIMIT ?`).all(botId, limit) as any[]
    ).map(rowToPerson);
  }

  forgetPerson(botId: string, platform: Platform, userId: string): void {
    this.db.prepare(`DELETE FROM people WHERE bot_id = ? AND platform = ? AND user_id = ?`).run(botId, platform, userId);
    this.db.prepare(`DELETE FROM messages WHERE bot_id = ? AND platform = ? AND user_id = ?`).run(botId, platform, userId);
  }

  // ── rooms ───────────────────────────────────────────────────────

  bumpRoom(botId: string, platform: Platform, roomId: string, title: string | undefined): number {
    this.db
      .prepare(
        `INSERT INTO rooms (bot_id, platform, room_id, title, msgs_since_update) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(bot_id, platform, room_id) DO UPDATE SET
           msgs_since_update = msgs_since_update + 1,
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END`,
      )
      .run(botId, platform, roomId, title ?? "");
    return this.getRoom(botId, platform, roomId)?.msgsSinceUpdate ?? 0;
  }

  getRoom(botId: string, platform: Platform, roomId: string): Room | undefined {
    const r = this.db
      .prepare(`SELECT * FROM rooms WHERE bot_id = ? AND platform = ? AND room_id = ?`)
      .get(botId, platform, roomId);
    return r ? rowToRoom(r) : undefined;
  }

  updateRoomMemory(botId: string, platform: Platform, roomId: string, summary: string, topics: string[]): void {
    this.db
      .prepare(
        `UPDATE rooms SET summary = ?, recent_topics = ?, msgs_since_update = 0, updated_at = ?
         WHERE bot_id = ? AND platform = ? AND room_id = ?`,
      )
      .run(summary.slice(0, 1500), JSON.stringify(topics.slice(0, 8)), Date.now(), botId, platform, roomId);
  }

  resetRoomCounter(botId: string, platform: Platform, roomId: string): void {
    this.db
      .prepare(`UPDATE rooms SET msgs_since_update = 0 WHERE bot_id = ? AND platform = ? AND room_id = ?`)
      .run(botId, platform, roomId);
  }

  listRooms(botId: string, limit = 200): Room[] {
    return (
      this.db.prepare(`SELECT * FROM rooms WHERE bot_id = ? ORDER BY updated_at DESC LIMIT ?`).all(botId, limit) as any[]
    ).map(rowToRoom);
  }

  forgetRoom(botId: string, platform: Platform, roomId: string): void {
    this.db.prepare(`DELETE FROM rooms WHERE bot_id = ? AND platform = ? AND room_id = ?`).run(botId, platform, roomId);
    this.db.prepare(`DELETE FROM messages WHERE bot_id = ? AND platform = ? AND room_id = ?`).run(botId, platform, roomId);
  }

  /** Remove everything a deleted bot remembered. */
  forgetBot(botId: string): void {
    for (const t of ["messages", "people", "rooms", "usage"]) this.db.prepare(`DELETE FROM ${t} WHERE bot_id = ?`).run(botId);
  }

  // ── usage ───────────────────────────────────────────────────────

  recordUsage(botId: string, feature: string, model: string, promptTokens: number, completionTokens: number): void {
    const now = new Date();
    this.db
      .prepare(
        `INSERT INTO usage (bot_id, day, ts, feature, model, prompt_tokens, completion_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(botId, now.toISOString().slice(0, 10), now.getTime(), feature, model, promptTokens, completionTokens);
  }

  tokensToday(botId?: string): number {
    const day = new Date().toISOString().slice(0, 10);
    const r = (
      botId
        ? this.db.prepare(`SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM usage WHERE day = ? AND bot_id = ?`).get(day, botId)
        : this.db.prepare(`SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM usage WHERE day = ?`).get(day)
    ) as any;
    return Number(r?.t ?? 0);
  }

  /** Usage since a day, optionally for one bot. */
  usageSince(dayInclusive: string, botId?: string): UsageRow[] {
    const where = botId ? "day >= ? AND bot_id = ?" : "day >= ?";
    const args = botId ? [dayInclusive, botId] : [dayInclusive];
    return (
      this.db
        .prepare(
          `SELECT bot_id, feature, model, COUNT(*) AS calls, SUM(prompt_tokens) AS p, SUM(completion_tokens) AS c
           FROM usage WHERE ${where} GROUP BY bot_id, feature, model ORDER BY (p + c) DESC`,
        )
        .all(...args) as any[]
    ).map((r) => ({
      botId: r.bot_id,
      feature: r.feature,
      model: r.model,
      calls: Number(r.calls),
      promptTokens: Number(r.p),
      completionTokens: Number(r.c),
    }));
  }

  usageByDay(sinceDay: string, botId?: string): { day: string; tokens: number }[] {
    const where = botId ? "day >= ? AND bot_id = ?" : "day >= ?";
    const args = botId ? [sinceDay, botId] : [sinceDay];
    return (
      this.db
        .prepare(`SELECT day, SUM(prompt_tokens + completion_tokens) AS t FROM usage WHERE ${where} GROUP BY day ORDER BY day`)
        .all(...args) as any[]
    ).map((r) => ({ day: r.day, tokens: Number(r.t) }));
  }

  counts(botId: string): { people: number; rooms: number } {
    const p = this.db.prepare(`SELECT COUNT(*) AS n FROM people WHERE bot_id = ?`).get(botId) as any;
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM rooms WHERE bot_id = ?`).get(botId) as any;
    return { people: Number(p.n), rooms: Number(r.n) };
  }

  close(): void {
    this.db.close();
  }
}

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function rowToMessage(r: any): StoredMessage {
  return {
    id: Number(r.id),
    botId: r.bot_id,
    platform: r.platform,
    roomId: r.room_id,
    userId: r.user_id,
    userName: r.user_name,
    text: r.text,
    hasImage: Boolean(r.has_image),
    isBot: Boolean(r.is_bot),
    ts: Number(r.ts),
  };
}

function rowToPerson(r: any): Person {
  return {
    botId: r.bot_id,
    platform: r.platform,
    userId: r.user_id,
    displayName: r.display_name,
    personality: r.personality,
    facts: parseList(r.facts),
    interests: parseList(r.interests),
    messageCount: Number(r.message_count),
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
  };
}

function rowToRoom(r: any): Room {
  return {
    botId: r.bot_id,
    platform: r.platform,
    roomId: r.room_id,
    title: r.title,
    summary: r.summary,
    recentTopics: parseList(r.recent_topics),
    msgsSinceUpdate: Number(r.msgs_since_update),
    updatedAt: Number(r.updated_at),
  };
}
