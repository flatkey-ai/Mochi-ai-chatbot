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
import type { IncomingMessage } from "../src/core/types.ts";

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
  const brain = new Brain({ flatkey, store, knowledge, updater, search, bots, random: () => 1 });
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
