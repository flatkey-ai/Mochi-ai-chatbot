export type Platform = "discord" | "telegram" | "slack" | "qq" | "web";

/** An image attached to a message. `url` is either a public https URL or a data: URL. */
export interface ImageInput {
  url: string;
  mimeType?: string;
}

/** A platform-agnostic incoming chat message. Every adapter converts to this shape. */
export interface IncomingMessage {
  /** Which of your bots received this message. */
  botId: string;
  platform: Platform;
  roomId: string;
  roomName?: string;
  userId: string;
  userName: string;
  text: string;
  images: ImageInput[];
  isDirect: boolean;
  /** The bot was @mentioned or the message replies to the bot. */
  mentionsBot: boolean;
  timestamp?: number;
}

export interface BotReply {
  text: string;
  usedSearch: boolean;
  usedVision: boolean;
  /** Knowledge base documents the answer drew on. */
  usedKnowledge?: { docId: number; title: string }[];
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly botId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): { running: boolean; detail?: string };
}
