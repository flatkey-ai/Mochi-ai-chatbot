import type { BotSettings, Persona } from "./bots.ts";

export type PresetId = "companion" | "qa" | "study" | "blank";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Preset {
  label: string;
  blurb: string;
  settings: DeepPartial<BotSettings>;
}

/** Starting points for new bots. Everything is editable afterwards. */
export const PRESETS: Record<PresetId, Preset> = {
  companion: {
    label: "Group-chat companion",
    blurb: "A fun regular in your community. Remembers everyone and joins the conversation.",
    settings: {
      mode: "companion",
      persona: {
        name: "Mochi",
        avatar: "🍡",
        color: "#ff6fae",
        description: "Your group chat's cutest regular. Remembers everyone, looks things up, and reads your memes.",
        greeting: "hii! i'm mochi 🍡 ask me anything~",
        nicknames: ["mochi"],
        personality: "Playful, warm and witty. Curious about everyone and loves remembering little details about people. Teases gently, never mean.",
        tone: "playful",
        emoji: "some",
        replyLength: "short",
        backstory: "",
        rules: "Be honest. If you're not sure about a fact, say so or look it up. Never invent sources.",
      },
      knowledge: { enabled: true, strict: false },
      features: { memory: true, search: true, vision: true },
    },
  },
  qa: {
    label: "Q&A / support bot",
    blurb: "Answers questions from your own knowledge base: docs, FAQs, policies.",
    settings: {
      mode: "qa",
      persona: {
        name: "Support Assistant",
        avatar: "💁",
        color: "#6b5cff",
        description: "Ask me anything about our product. I answer from our official docs.",
        greeting: "Hi! How can I help you today?",
        nicknames: [],
        personality: "Clear, patient and accurate. Gets to the point, then offers the next step.",
        tone: "professional",
        emoji: "none",
        replyLength: "medium",
        backstory: "",
        rules:
          "Only answer from the knowledge base. If the answer isn't there, say so and suggest contacting the team.\nNever make up prices, policies or features.\nUse short steps or bullet points for how-to answers.",
      },
      knowledge: { enabled: true, strict: true },
      features: { memory: false, search: false, vision: true },
      triggers: { replyWhenNameSaid: false, randomReplyChance: 0 },
      limits: { historyMessages: 10 },
    },
  },
  study: {
    label: "Study buddy",
    blurb: "Explains things step by step, quizzes you, and can read photos of homework.",
    settings: {
      mode: "companion",
      persona: {
        name: "Sage",
        avatar: "📚",
        color: "#2fb380",
        description: "Your patient study buddy. Ask me to explain, quiz you, or check your work.",
        greeting: "Hey! What are we learning today?",
        nicknames: ["sage"],
        personality: "Encouraging and patient. Explains with simple examples, checks understanding, celebrates progress.",
        tone: "friendly",
        emoji: "some",
        replyLength: "medium",
        backstory: "",
        rules: "Guide people to the answer instead of just giving it when they're practicing. Point out mistakes kindly.",
      },
      knowledge: { enabled: true, strict: false },
      features: { memory: true, search: true, vision: true },
    },
  },
  blank: {
    label: "Blank bot",
    blurb: "Start from scratch.",
    settings: {
      persona: { name: "New bot", avatar: "🤖", color: "#ff6fae", description: "", greeting: "Hi! How can I help?" },
    },
  },
};

const TONE: Record<Persona["tone"], string> = {
  playful: "playful and teasing, like a fun friend online",
  friendly: "warm, friendly and approachable",
  professional: "professional, clear and polite",
  sassy: "sassy and confident with a sharp wit, but never rude",
  calm: "calm, gentle and reassuring",
};
const EMOJI: Record<Persona["emoji"], string> = {
  none: "Don't use emoji.",
  some: "Use an emoji or kaomoji now and then, never more than one per message.",
  lots: "Use emoji and kaomoji freely.",
};
const LENGTH: Record<Persona["replyLength"], string> = {
  short: "Keep replies short: 1–3 sentences, like a chat message.",
  medium: "Keep replies focused: a short paragraph or a few bullet points.",
  long: "Give thorough, detailed answers when the question deserves it.",
};

/** Turn the persona fields into the system prompt's identity section. */
export function buildPersonaPrompt(p: Persona): string {
  if (p.customPrompt.trim()) return p.customPrompt.trim();
  const lines: string[] = [`You are ${p.name}.${p.description ? " " + p.description : ""}`];
  if (p.personality) lines.push(`Personality: ${p.personality}`);
  if (p.backstory) lines.push(`Background: ${p.backstory}`);
  lines.push(
    `How you talk: ${TONE[p.tone]}. ${EMOJI[p.emoji]} ${LENGTH[p.replyLength]}`,
    p.language === "auto"
      ? "Reply in the language the person writes in."
      : `Always reply in ${p.language}, unless someone explicitly asks for another language.`,
  );
  if (p.rules.trim()) lines.push(`Rules you always follow:\n${p.rules.trim().split("\n").map((r) => `- ${r.replace(/^[-•]\s*/, "")}`).join("\n")}`);
  return lines.join("\n");
}
