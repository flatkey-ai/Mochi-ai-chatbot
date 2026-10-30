import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Platform } from "../core/types.ts";

export interface StoredMessage {
  id: number;
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
  platform: Platform;
  roomId: string;
  title: string;
  summary: string;
  recentTopics: string[];
  msgsSinceUpdate: number;
  updatedAt: number;
}

export interface UsageRow {
  feature: string;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

/** Keep at most this many raw messages per room; older ones live on only as summaries. */
const MAX_MESSAGES_PER_ROOM = 300;

/**
 * Mochi's memory, in one SQLite file (Node's built-in node:sqlite, no native deps):
 * - messages: short-term chat history per room
 * - people:   long-term profile per person (personality, facts, interests)
 * - rooms:    rolling summary + recent topics per chat room
 * - usage:    token usage per feature/model, for the dashboard and budget
 */
export class MemoryStore {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(path.join(dataDir, "mochi.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL, room_id TEXT NOT NULL,
        user_id TEXT NOT NULL, user_name TEXT NOT NULL,
        text TEXT NOT NULL, has_image INTEGER NOT NULL DEFAULT 0,
        is_bot INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(platform, room_id, id);
      CREATE TABLE IF NOT EXISTS people (
        platform TEXT NOT NULL, user_id TEXT NOT NULL,
        display_name TEXT NOT NULL, personality TEXT NOT NULL DEFAULT '',
        facts TEXT NOT NULL DEFAULT '[]', interests TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        PRIMARY KEY (platform, user_id)
      );
      CREATE TABLE IF NOT EXISTS rooms (
        platform TEXT NOT NULL, room_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
        recent_topics TEXT NOT NULL DEFAULT '[]',
        msgs_since_update INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (platform, room_id)
      );
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL, ts INTEGER NOT NULL,
        feature TEXT NOT NULL, model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_day ON usage(day);
    `);
  }

  // ── messages ────────────────────────────────────────────────────

  addMessage(m: Omit<StoredMessage, "id">): void {
    this.db
      .prepare(
        `INSERT INTO messages (platform, room_id, user_id, user_name, text, has_image, is_bot, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.platform, m.roomId, m.userId, m.userName, m.text, m.hasImage ? 1 : 0, m.isBot ? 1 : 0, m.ts);
    this.db
      .prepare(
        `DELETE FROM messages WHERE platform = ? AND room_id = ? AND id NOT IN (
           SELECT id FROM messages WHERE platform = ? AND room_id = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(m.platform, m.roomId, m.platform, m.roomId, MAX_MESSAGES_PER_ROOM);
  }

  recentMessages(platform: Platform, roomId: string, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE platform = ? AND room_id = ? ORDER BY id DESC LIMIT ?`)
      .all(platform, roomId, limit) as any[];
    return rows.reverse().map(rowToMessage);
  }

  // ── people ──────────────────────────────────────────────────────

  touchPerson(platform: Platform, userId: string, displayName: string, ts: number): void {
    this.db
      .prepare(
        `INSERT INTO people (platform, user_id, display_name, message_count, first_seen, last_seen)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(platform, user_id) DO UPDATE SET
           display_name = excluded.display_name,
           message_count = message_count + 1,
           last_seen = excluded.last_seen`,
      )
      .run(platform, userId, displayName, ts, ts);
  }

  getPerson(platform: Platform, userId: string): Person | undefined {
    const r = this.db.prepare(`SELECT * FROM people WHERE platform = ? AND user_id = ?`).get(platform, userId);
    return r ? rowToPerson(r) : undefined;
  }

  getPeople(platform: Platform, userIds: string[]): Person[] {
    return userIds.map((id) => this.getPerson(platform, id)).filter((p): p is Person => Boolean(p));
  }

  updatePersonProfile(
    platform: Platform,
    userId: string,
    patch: { personality?: string; facts?: string[]; interests?: string[] },
  ): void {
    const p = this.getPerson(platform, userId);
    if (!p) return;
    this.db
      .prepare(`UPDATE people SET personality = ?, facts = ?, interests = ? WHERE platform = ? AND user_id = ?`)
      .run(
        (patch.personality ?? p.personality).slice(0, 500),
        JSON.stringify((patch.facts ?? p.facts).slice(0, 15)),
        JSON.stringify((patch.interests ?? p.interests).slice(0, 10)),
        platform,
        userId,
      );
  }

  listPeople(limit = 200): Person[] {
    return (this.db.prepare(`SELECT * FROM people ORDER BY last_seen DESC LIMIT ?`).all(limit) as any[]).map(
      rowToPerson,
    );
  }

  /** Remove everything Mochi knows about a person (profile + their raw messages). */
  forgetPerson(platform: Platform, userId: string): void {
    this.db.prepare(`DELETE FROM people WHERE platform = ? AND user_id = ?`).run(platform, userId);
    this.db.prepare(`DELETE FROM messages WHERE platform = ? AND user_id = ?`).run(platform, userId);
  }

  // ── rooms ───────────────────────────────────────────────────────

  /** Record a new message in a room; returns how many messages arrived since the last memory update. */
  bumpRoom(platform: Platform, roomId: string, title: string | undefined): number {
    this.db
      .prepare(
        `INSERT INTO rooms (platform, room_id, title, msgs_since_update) VALUES (?, ?, ?, 1)
         ON CONFLICT(platform, room_id) DO UPDATE SET
           msgs_since_update = msgs_since_update + 1,
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE title END`,
      )
      .run(platform, roomId, title ?? "");
    return this.getRoom(platform, roomId)?.msgsSinceUpdate ?? 0;
  }

  getRoom(platform: Platform, roomId: string): Room | undefined {
    const r = this.db.prepare(`SELECT * FROM rooms WHERE platform = ? AND room_id = ?`).get(platform, roomId);
    return r ? rowToRoom(r) : undefined;
  }

  updateRoomMemory(platform: Platform, roomId: string, summary: string, topics: string[]): void {
    this.db
      .prepare(
        `UPDATE rooms SET summary = ?, recent_topics = ?, msgs_since_update = 0, updated_at = ?
         WHERE platform = ? AND room_id = ?`,
      )
      .run(summary.slice(0, 1500), JSON.stringify(topics.slice(0, 8)), Date.now(), platform, roomId);
  }

  resetRoomCounter(platform: Platform, roomId: string): void {
    this.db.prepare(`UPDATE rooms SET msgs_since_update = 0 WHERE platform = ? AND room_id = ?`).run(platform, roomId);
  }

  listRooms(limit = 200): Room[] {
    return (this.db.prepare(`SELECT * FROM rooms ORDER BY updated_at DESC LIMIT ?`).all(limit) as any[]).map(
      rowToRoom,
    );
  }

  forgetRoom(platform: Platform, roomId: string): void {
    this.db.prepare(`DELETE FROM rooms WHERE platform = ? AND room_id = ?`).run(platform, roomId);
    this.db.prepare(`DELETE FROM messages WHERE platform = ? AND room_id = ?`).run(platform, roomId);
  }

  // ── usage ───────────────────────────────────────────────────────

  recordUsage(feature: string, model: string, promptTokens: number, completionTokens: number): void {
    const now = new Date();
    this.db
      .prepare(
        `INSERT INTO usage (day, ts, feature, model, prompt_tokens, completion_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(now.toISOString().slice(0, 10), now.getTime(), feature, model, promptTokens, completionTokens);
  }

  tokensToday(): number {
    const r = this.db
      .prepare(`SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM usage WHERE day = ?`)
      .get(new Date().toISOString().slice(0, 10)) as any;
    return Number(r?.t ?? 0);
  }

  usageSince(dayInclusive: string): UsageRow[] {
    return (
      this.db
        .prepare(
          `SELECT feature, model, COUNT(*) AS calls, SUM(prompt_tokens) AS p, SUM(completion_tokens) AS c
           FROM usage WHERE day >= ? GROUP BY feature, model ORDER BY (p + c) DESC`,
        )
        .all(dayInclusive) as any[]
    ).map((r) => ({
      feature: r.feature,
      model: r.model,
      calls: Number(r.calls),
      promptTokens: Number(r.p),
      completionTokens: Number(r.c),
    }));
  }

  usageByDay(sinceDay: string): { day: string; tokens: number }[] {
    return (
      this.db
        .prepare(
          `SELECT day, SUM(prompt_tokens + completion_tokens) AS t FROM usage WHERE day >= ? GROUP BY day ORDER BY day`,
        )
        .all(sinceDay) as any[]
    ).map((r) => ({ day: r.day, tokens: Number(r.t) }));
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
    platform: r.platform,
    roomId: r.room_id,
    title: r.title,
    summary: r.summary,
    recentTopics: parseList(r.recent_topics),
    msgsSinceUpdate: Number(r.msgs_since_update),
    updatedAt: Number(r.updated_at),
  };
}
