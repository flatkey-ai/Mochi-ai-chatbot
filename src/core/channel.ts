import type { IncomingMessage, Platform } from "./types.ts";

/**
 * One contract for every channel.
 *
 * Before this, each adapter was an island: Discord replied with `m.reply`, Telegram with
 * `ctx.reply`, Slack with `say`, QQ with a passive `msg_id` POST, and each one handled
 * attachments and history its own way — which is exactly how a channel ends up silently
 * dropping images or having no way to answer a question about earlier messages.
 *
 * Adapters now extend ChannelAdapter and declare what they can do. Callers ask
 * `supports()` first; asking for something missing raises UnsupportedCapability instead of
 * failing quietly.
 */

/**
 * What a channel can do. Feature-detected at runtime, so the core never has to care which
 * platform it is talking to.
 */
export type ChannelCapability =
  /** Answer a specific incoming message (quote, thread or passive reply). */
  | "reply"
  /** Send without an incoming message: proactive channel post or DM to a person. */
  | "send"
  /** Backfill older messages from the platform API (not from our own database). */
  | "history"
  /** Download attachments people sent (images for the vision model). */
  | "media"
  /** Keep replies in a thread when the platform has them. */
  | "threads"
  /** Typing indicator. */
  | "typing";

/** Where a message should go when nobody asked for it. */
export interface ChatTarget {
  kind: "group" | "dm";
  /** Platform room id: channel id, chat id, group openid, DM conversation id. */
  id: string;
  /** Required for kind="dm" on platforms that address people, not rooms. */
  userId?: string;
  name?: string;
}

/** A message fetched from the platform, normalized. */
export interface HistoryMessage {
  userId: string;
  userName: string;
  text: string;
  ts: number;
  isBot?: boolean;
}

/** Raised when a caller asks a channel for something it does not support. */
export class UnsupportedCapability extends Error {
  constructor(
    readonly platform: Platform,
    readonly capability: ChannelCapability,
  ) {
    super(`${platform} cannot "${capability}" (check adapter.supports("${capability}"))`);
    this.name = "UnsupportedCapability";
  }
}

/** What every adapter returns from `start()` so the dashboard can show it. */
export interface ChannelStatus {
  running: boolean;
  detail?: string;
}

export abstract class ChannelAdapter {
  abstract readonly platform: Platform;
  /** Declared once per adapter; this is the whole point of the base class. */
  abstract readonly capabilities: ReadonlySet<ChannelCapability>;

  constructor(readonly botId: string) {}

  supports(capability: ChannelCapability): boolean {
    return this.capabilities.has(capability);
  }

  /** Throw unless the capability is declared. Used by default implementations. */
  protected require(capability: ChannelCapability): void {
    if (!this.supports(capability)) throw new UnsupportedCapability(this.platform, capability);
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract status(): ChannelStatus;

  /**
   * Answer a message that arrived. Implementations that support "reply" quote/thread it;
   * otherwise they fall back to sendTo() so behaviour is uniform for the core.
   */
  abstract replyTo(msg: IncomingMessage, text: string): Promise<void>;

  /** Send a message that was not triggered by an incoming one. */
  abstract sendTo(target: ChatTarget, text: string): Promise<void>;

  /**
   * Read the room's older messages from the platform. Channels without a history API
   * (Telegram, QQ) throw UnsupportedCapability; Mochi then falls back to its own database.
   */
  async fetchHistory(target: ChatTarget, limit: number): Promise<HistoryMessage[]> {
    this.require("history");
    void target;
    void limit;
    return [];
  }

  /** Human-readable capability list, for the dashboard and for tests. */
  describe(): { platform: Platform; capabilities: ChannelCapability[] } {
    return { platform: this.platform, capabilities: [...this.capabilities].sort() };
  }
}

/** Backwards-compatible name used across the codebase. */
export type PlatformAdapter = ChannelAdapter;
