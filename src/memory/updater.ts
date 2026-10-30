import type { FlatkeyClient } from "../flatkey/client.ts";
import type { Settings } from "../core/settings.ts";
import type { Platform } from "../core/types.ts";
import type { MemoryStore } from "./store.ts";

const SYSTEM = `You maintain the long-term memory of a group-chat bot.
Given the chat room's previous summary, the people's existing profiles, and new messages,
return ONLY a JSON object:
{
  "room": { "summary": string (<= 4 sentences, what this room is about and what's been going on),
            "recent_topics": string[] (<= 6 short topic labels, most recent first) },
  "people": [ { "user_id": string,
                "personality": string (<= 2 sentences: tone, humour, how they talk),
                "facts": string[] (durable facts THEY said about themselves: job, location, pets, plans, likes; <= 12),
                "interests": string[] (<= 8) } ]
}
Rules:
- Merge with the existing profiles: keep still-true facts, update changed ones, drop trivia.
- Only include facts a person stated about themselves. No guesses about health, religion, politics, sexuality or other sensitive traits.
- Only include people who appear in the new messages, and never the bot itself.
- Write in the language the chat is in.`;

/**
 * Background memory pass. Runs every N messages per room with a cheap model, so the
 * expensive chat model never has to re-read long histories.
 */
export class MemoryUpdater {
  private running = new Set<string>();

  constructor(
    private readonly flatkey: FlatkeyClient,
    private readonly store: MemoryStore,
    private readonly getSettings: () => Settings,
  ) {}

  /** Call after each stored message. Fires an update in the background when the room is due. */
  maybeUpdate(platform: Platform, roomId: string, msgsSinceUpdate: number): void {
    const s = this.getSettings();
    if (!s.features.memory) return;
    if (msgsSinceUpdate < s.limits.memoryUpdateEvery) return;
    const key = `${platform}:${roomId}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    this.update(platform, roomId)
      .catch((err) => console.warn(`[memory] update failed for ${key}:`, err?.message ?? err))
      .finally(() => this.running.delete(key));
  }

  async update(platform: Platform, roomId: string): Promise<void> {
    const s = this.getSettings();
    const room = this.store.getRoom(platform, roomId);
    const n = Math.max(room?.msgsSinceUpdate ?? 0, s.limits.memoryUpdateEvery);
    const msgs = this.store.recentMessages(platform, roomId, Math.min(n + 4, 80));
    if (msgs.length === 0) return;

    const humanIds = [...new Set(msgs.filter((m) => !m.isBot).map((m) => m.userId))];
    const people = this.store.getPeople(platform, humanIds);

    const input = {
      previous_room_summary: room?.summary ?? "",
      previous_topics: room?.recentTopics ?? [],
      people: people.map((p) => ({
        user_id: p.userId,
        name: p.displayName,
        personality: p.personality,
        facts: p.facts,
        interests: p.interests,
      })),
      new_messages: msgs.map((m) => ({
        user_id: m.isBot ? "BOT" : m.userId,
        name: m.isBot ? s.persona.name : m.userName,
        text: m.text.slice(0, 600) + (m.hasImage ? " [image]" : ""),
      })),
    };

    // Reset first so a burst of messages doesn't queue duplicate updates if this one is slow.
    this.store.resetRoomCounter(platform, roomId);

    const { message, usage } = await this.flatkey.chat({
      model: s.models.memory,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(input) },
      ],
      maxTokens: 1200,
      temperature: 0.2,
      jsonMode: true,
    });
    this.store.recordUsage("memory", s.models.memory, usage.promptTokens, usage.completionTokens);

    const parsed = parseJsonLoose(typeof message.content === "string" ? message.content : "");
    if (!parsed) return;

    const r = parsed.room ?? {};
    this.store.updateRoomMemory(
      platform,
      roomId,
      typeof r.summary === "string" ? r.summary : (room?.summary ?? ""),
      Array.isArray(r.recent_topics) ? r.recent_topics.map(String) : (room?.recentTopics ?? []),
    );

    const allowed = new Set(humanIds);
    for (const p of Array.isArray(parsed.people) ? parsed.people : []) {
      const id = String(p?.user_id ?? "");
      if (!allowed.has(id)) continue;
      this.store.updatePersonProfile(platform, id, {
        personality: typeof p.personality === "string" ? p.personality : undefined,
        facts: Array.isArray(p.facts) ? p.facts.map(String) : undefined,
        interests: Array.isArray(p.interests) ? p.interests.map(String) : undefined,
      });
    }
  }
}

export function parseJsonLoose(text: string): any | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}
