/**
 * Auto-translation for knowledge documents.
 *
 * Retrieval is per-script (FTS5 trigram): a Chinese question finds nothing in an English
 * document. The cheap, reliable fix is to keep every document in every language the console
 * offers, translated once at upload time — the retrieval then always has a passage in the
 * language the person asked in.
 *
 * Translation is opt-in per bot (knowledge.translate) because it costs a model call per
 * language per upload.
 */

export const KB_LANGS = ["en", "zh", "pt", "ja"] as const;
export type KbLang = (typeof KB_LANGS)[number];

export const KB_LANG_NAME: Record<KbLang, string> = {
  en: "English",
  zh: "Simplified Chinese",
  pt: "Brazilian Portuguese",
  ja: "Japanese",
};

/** Rough language guess for the source document, using the same signals as the bot replies. */
export function detectDocLang(text: string): KbLang {
  const sample = text.slice(0, 2000);
  const kana = (sample.match(/[぀-ヿ]/g) ?? []).length;
  const han = (sample.match(/[㐀-䶿一-鿿]/g) ?? []).length;
  if (kana > 3 && kana >= han) return "ja";
  if (han > 5) return "zh";

  // \b is ASCII-only in JS regexes, so "você\b" never matches: use explicit letter guards and
  // count accented Latin characters as an extra signal.
  const ptWords =
    sample.match(/(?<![\p{L}])(você|voce|não|nao|obrigad[oa]|reembolso|para|com|isso|muito|uma|também|dono|pedido)(?![\p{L}])/giu) ?? [];
  const ptChars = sample.match(/[ãõçáéíóúâêô]/gi) ?? [];
  if (ptWords.length + ptChars.length >= 3) return "pt";
  return "en";
}

export interface TranslateClient {
  chat(opts: {
    model: string;
    messages: { role: "system" | "user"; content: string }[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ message: { content: unknown }; usage: { promptTokens: number; completionTokens: number } }>;
}

const SYSTEM = (target: string) =>
  `You translate documentation for a chat bot's knowledge base into ${target}. ` +
  `Preserve Markdown structure exactly: headings, lists, tables, code, links, emoji and proper nouns. ` +
  `Do not summarise, add notes, or translate product names, URLs or code. ` +
  `Output only the translated text — no preamble, no quotes, no explanations.`;

/** Split on paragraph boundaries so each request stays small enough to translate faithfully. */
export function splitForTranslation(text: string, max = 2400): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\n+/)) {
    if (para.length > max) {
      if (cur) {
        parts.push(cur);
        cur = "";
      }
      for (let i = 0; i < para.length; i += max) parts.push(para.slice(i, i + max));
      continue;
    }
    if (cur.length + para.length + 2 > max) {
      parts.push(cur);
      cur = para;
    } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * Translate a whole document into one language. Returns the translated text, or throws —
 * callers keep the original document either way, so a failed translation is not fatal.
 */
export async function translateDocument(
  client: TranslateClient,
  model: string,
  text: string,
  target: KbLang,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const parts = splitForTranslation(text);
  const out: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  for (const part of parts) {
    const { message, usage } = await client.chat({
      model,
      messages: [
        { role: "system", content: SYSTEM(KB_LANG_NAME[target]) },
        { role: "user", content: part },
      ],
      maxTokens: Math.min(4000, Math.max(600, Math.ceil(part.length / 2))),
      temperature: 0.1,
    });
    const content = typeof message.content === "string" ? message.content : "";
    if (!content.trim()) throw new Error(`empty translation (${target})`);
    out.push(content.trim());
    promptTokens += usage.promptTokens;
    completionTokens += usage.completionTokens;
  }
  return { text: out.join("\n\n"), promptTokens, completionTokens };
}

/** Which languages still need to be produced for a document written in `source`. */
export function missingLanguages(source: KbLang, wanted: readonly KbLang[] = KB_LANGS): KbLang[] {
  return wanted.filter((l) => l !== source);
}
