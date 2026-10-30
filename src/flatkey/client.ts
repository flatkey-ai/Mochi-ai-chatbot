/**
 * Minimal Flatkey client. Flatkey is OpenAI-compatible at https://router.flatkey.ai/v1,
 * and also speaks the Anthropic /v1/messages and OpenAI /v1/responses protocols,
 * so one key covers chat, vision and grounded web search.
 */

import { FLATKEY_BASE_URL, resolveFlatkeyBaseUrl } from "./why.ts";

export interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  usage: Usage;
}

export interface FlatkeyModel {
  id: string;
  owned_by?: string;
}

export class FlatkeyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class FlatkeyClient {
  private apiKey: string;

  constructor(
    apiKey: string | undefined,
    readonly baseUrl = FLATKEY_BASE_URL,
    private readonly timeoutMs = 90_000,
  ) {
    this.apiKey = apiKey ?? "";
    // Mochi runs on Flatkey only (localhost is allowed for the offline mock).
    this.baseUrl = resolveFlatkeyBaseUrl(baseUrl);
  }

  /** True once a Flatkey API key is bound (via the dashboard or .env). */
  hasKey(): boolean {
    return this.apiKey.length > 0;
  }

  setApiKey(key: string | undefined): void {
    this.apiKey = key ?? "";
  }

  private requireKey(): void {
    if (!this.apiKey) throw new FlatkeyError("No Flatkey API key bound. Add one in the dashboard.", 0);
  }

  private async post(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
    this.requireKey();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "user-agent": "mochi-ai-chatbot/0.2 (+https://github.com/flatkey-ai/Mochi-ai-chatbot)",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new FlatkeyError(`Flatkey ${path} ${res.status}: ${text.slice(0, 300)}`, res.status);
    try {
      return JSON.parse(text);
    } catch {
      throw new FlatkeyError(`Flatkey ${path} returned non-JSON`, res.status);
    }
  }

  async chat(opts: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    tools?: ToolDef[];
    temperature?: number;
    jsonMode?: boolean;
  }): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
    };
    if (opts.tools?.length) body.tools = opts.tools;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    const data = await this.post("/chat/completions", body);
    const message: ChatMessage = data?.choices?.[0]?.message ?? { role: "assistant", content: "" };
    return {
      message,
      usage: {
        promptTokens: data?.usage?.prompt_tokens ?? 0,
        completionTokens: data?.usage?.completion_tokens ?? 0,
      },
    };
  }

  /** Anthropic-protocol call (used for the native web_search tool). */
  async messages(body: Record<string, unknown>): Promise<any> {
    return this.post("/messages", body, { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" });
  }

  /** OpenAI Responses-protocol call (used for the web_search tool on GPT models). */
  async responses(body: Record<string, unknown>): Promise<any> {
    return this.post("/responses", body);
  }

  async listModels(apiKey = this.apiKey): Promise<FlatkeyModel[]> {
    if (!apiKey) throw new FlatkeyError("No Flatkey API key bound. Add one in the dashboard.", 0);
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new FlatkeyError(`Flatkey /models ${res.status}`, res.status);
    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    return list
      .filter((m) => m && typeof m.id === "string")
      .map((m) => ({ id: m.id, owned_by: m.owned_by }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
