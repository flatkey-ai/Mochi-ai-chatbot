import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMockFlatkey } from "./mock-flatkey.ts";
import { FlatkeyClient } from "../src/flatkey/client.ts";
import { MemoryStore } from "../src/memory/store.ts";
import { MemoryUpdater } from "../src/memory/updater.ts";
import { KnowledgeStore } from "../src/knowledge/store.ts";
import { SearchAbility } from "../src/abilities/search.ts";
import { BotRegistry } from "../src/core/bots.ts";
import { SecretsStore } from "../src/core/secrets.ts";
import { Brain } from "../src/core/brain.ts";
import type { IncomingMessage, Platform } from "../src/core/types.ts";
import { ChannelAdapter, type ChannelCapability, type ChatTarget, type HistoryMessage } from "../src/core/channel.ts";

/**
 * A channel that does nothing but record what the core asked it to do. Extending the real
 * base class (rather than faking the shape) means these tests break the moment the channel
 * contract changes.
 */
export class FakeAdapter extends ChannelAdapter {
  readonly capabilities: ReadonlySet<ChannelCapability> = new Set<ChannelCapability>([
    "reply",
    "send",
    "history",
    "media",
    "typing",
  ]);
  readonly sent: { target: ChatTarget; text: string }[] = [];
  readonly replies: { msg: IncomingMessage; text: string }[] = [];
  private running = false;

  constructor(
    botId: string,
    readonly platform: Platform,
  ) {
    super(botId);
  }

  async start(): Promise<void> {
    this.running = true;
  }
  async stop(): Promise<void> {
    this.running = false;
  }
  status() {
    return { running: this.running, detail: "fake" };
  }
  async replyTo(msg: IncomingMessage, text: string): Promise<void> {
    this.replies.push({ msg, text });
  }
  async sendTo(target: ChatTarget, text: string): Promise<void> {
    this.sent.push({ target, text });
  }
  async fetchHistory(): Promise<HistoryMessage[]> {
    return [{ userId: "u-old", userName: "Old Friend", text: "the thing we talked about before", ts: Date.now() - 3_600_000 }];
  }
}

/** A full Mochi stack against the mock Flatkey router, in a temp data dir. */
export async function makeStack(opts: { key?: string } = { key: "test-key" }) {
  const mock = await startMockFlatkey();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-test-"));
  const bots = new BotRegistry(dir);
  const secrets = new SecretsStore(dir);
  const store = new MemoryStore(dir);
  const knowledge = new KnowledgeStore(store.db);
  const flatkey = new FlatkeyClient(opts.key, mock.url);
  const updater = new MemoryUpdater(flatkey, store, bots);
  const search = new SearchAbility(flatkey);
  const brain = new Brain({ flatkey, store, knowledge, updater, search, bots, secrets, random: () => 1 });
  return {
    mock, dir, bots, secrets, store, knowledge, flatkey, updater, brain,
    async close() {
      store.close();
      await mock.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const msg = (over: Partial<IncomingMessage>): IncomingMessage => ({
  botId: "mochi",
  platform: "discord",
  roomId: "room1",
  roomName: "#general",
  userId: "u1",
  userName: "Alice",
  text: "hello",
  images: [],
  isDirect: false,
  mentionsBot: false,
  ...over,
});
