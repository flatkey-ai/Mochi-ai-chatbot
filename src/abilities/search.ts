import type { FlatkeyClient } from "../flatkey/client.ts";
import type { BotSettings } from "../core/bots.ts";

export interface SearchSource {
  title: string;
  url: string;
}

export interface SearchResult {
  answer: string;
  sources: SearchSource[];
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const INSTRUCTION =
  "Search the web and answer the question with verified, up-to-date facts. " +
  "Be concise (<= 120 words). If sources disagree, say so. Question: ";

/**
 * Grounded web search through Flatkey. One key, no separate search vendor:
 * - "messages" mode sends Anthropic's native `web_search` server tool to /v1/messages
 *   (Flatkey runs it natively or emulates it on its side).
 * - "responses" mode sends OpenAI's `web_search` tool to /v1/responses.
 * If the configured mode fails, the other one is tried once.
 */
export class SearchAbility {
  constructor(private readonly flatkey: FlatkeyClient) {}

  async search(query: string, s: Pick<BotSettings, "search" | "models">): Promise<SearchResult> {
    const primary = s.search.mode;
    try {
      return await this.run(primary, s.models.search, query);
    } catch (err) {
      const fallback = primary === "messages" ? "responses" : "messages";
      console.warn(`[search] ${primary} mode failed (${(err as Error).message}); trying ${fallback}`);
      return await this.run(fallback, s.models.search, query);
    }
  }

  private run(mode: "messages" | "responses", model: string, query: string): Promise<SearchResult> {
    return mode === "messages" ? this.viaMessages(model, query) : this.viaResponses(model, query);
  }

  private async viaMessages(model: string, query: string): Promise<SearchResult> {
    const data = await this.flatkey.messages({
      model,
      max_tokens: 700,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: INSTRUCTION + query }],
    });
    const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
    const answer = blocks
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const sources: SearchSource[] = [];
    for (const b of blocks) {
      if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r?.url) sources.push({ title: r.title ?? r.url, url: r.url });
      }
      for (const c of Array.isArray(b?.citations) ? b.citations : []) {
        if (c?.url) sources.push({ title: c.title ?? c.url, url: c.url });
      }
    }
    if (!answer) throw new Error("empty search answer");
    return {
      answer,
      sources: dedupe(sources),
      model,
      promptTokens: data?.usage?.input_tokens ?? 0,
      completionTokens: data?.usage?.output_tokens ?? 0,
    };
  }

  private async viaResponses(model: string, query: string): Promise<SearchResult> {
    const data = await this.flatkey.responses({
      model,
      tools: [{ type: "web_search" }],
      input: INSTRUCTION + query,
      max_output_tokens: 700,
    });
    let answer = typeof data?.output_text === "string" ? data.output_text : "";
    const sources: SearchSource[] = [];
    for (const item of Array.isArray(data?.output) ? data.output : []) {
      if (item?.type !== "message") continue;
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (part?.type === "output_text") {
          if (!data?.output_text) answer += part.text ?? "";
          for (const a of Array.isArray(part.annotations) ? part.annotations : []) {
            if (a?.url) sources.push({ title: a.title ?? a.url, url: a.url });
          }
        }
      }
    }
    answer = answer.trim();
    if (!answer) throw new Error("empty search answer");
    return {
      answer,
      sources: dedupe(sources),
      model,
      promptTokens: data?.usage?.input_tokens ?? 0,
      completionTokens: data?.usage?.output_tokens ?? 0,
    };
  }
}

function dedupe(sources: SearchSource[]): SearchSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true))).slice(0, 6);
}
