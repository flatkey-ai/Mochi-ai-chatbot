# Channels: one contract, one factory

Every chat channel implements the same abstract class ([`src/core/channel.ts`](../src/core/channel.ts)) and is
built in one place ([`src/channels/factory.ts`](../src/channels/factory.ts)). Adding a platform means writing an
adapter that extends `ChannelAdapter` and adding one line to the builder map — no `if`-chains anywhere else.

## The contract

```ts
abstract class ChannelAdapter {
  abstract readonly platform: Platform;
  abstract readonly capabilities: ReadonlySet<ChannelCapability>;

  supports(cap: ChannelCapability): boolean;
  protected require(cap: ChannelCapability): void;   // throws UnsupportedCapability

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract status(): { running: boolean; detail?: string };

  abstract replyTo(msg: IncomingMessage, text: string): Promise<void>;  // answer this message
  abstract sendTo(target: ChatTarget, text: string): Promise<void>;     // start a conversation

  async fetchHistory(target: ChatTarget, limit: number): Promise<HistoryMessage[]>;
}
```

`IncomingMessage.ref` carries the platform id of the message being answered, so `replyTo` quotes the right one
even when several messages are in flight (a per-room "last message" is a race; a test pins this down).

## Capabilities (what each platform can actually do)

| capability | meaning | discord | telegram | slack | qq | web |
|---|---|:-:|:-:|:-:|:-:|:-:|
| `reply` | answer a specific message (quote / thread / passive) | ✅ | ✅ | ✅ | ✅ (needs `msg_id`) | ✅ |
| `send` | send without being asked (channel post, DM a person) | ✅ | ✅ | ✅ | ⚠️ quota-limited | ✅ |
| `history` | backfill older messages from the platform API | ✅ | ❌ no API | ✅ | ❌ no API | n/a |
| `media` | download attachments for the vision model | ✅ | ✅ | ✅ | ✅ | ✅ (`data:` URL) |
| `threads` | keep replies in a thread | ✅ | ❌ | ✅ | ❌ | ❌ |
| `typing` | typing indicator | ✅ | ✅ | ✅ | ❌ | ❌ |

The matrix lives in `CAPABILITY_MATRIX` and a test asserts it never drifts from what the adapters declare.

### What that means for reading history

* `search_history` reads Mochi's own database first (every message the bot received), then asks the channel for
  older lines through `fetchHistory` when the platform has an API.
* **Discord / Slack**: full backfill — the bot can read a channel it was just added to.
* **Telegram**: the Bot API has no "read history" call at all, so only messages the bot witnessed exist.
* **QQ**: no history endpoint either, and in groups the bot only receives messages that @ it unless the group
  grants full-message events. Media and passive replies work, history does not.

## Envelope for every channel

All adapters normalize into `IncomingMessage` and hand it to the same `Brain.handle()`, so memory, personas,
knowledge, safety guards, flood control and cost accounting behave identically no matter where the message came
from. Anything that is not an image becomes a text note (`[sent a video (video/mp4)]`), so the model knows
something arrived instead of claiming it saw nothing.
