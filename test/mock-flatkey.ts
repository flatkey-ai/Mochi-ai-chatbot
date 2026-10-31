/**
 * A tiny fake Flatkey router for tests and offline development.
 * Run standalone: `npx tsx test/mock-flatkey.ts` → http://localhost:4010/v1
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

export interface MockCall { path: string; body: any }

export function startMockFlatkey(port = 0): Promise<{ url: string; calls: MockCall[]; close: () => Promise<void> }> {
  const calls: MockCall[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ path: req.url ?? "", body });
    const send = (data: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const auth = String(req.headers.authorization ?? "");
    if (!auth.startsWith("Bearer ") || auth.startsWith("Bearer bad-")) return send({ error: "invalid api key" }, 401);

    if (req.url === "/v1/models") {
      return send({ data: ["deepseek-v4-1-flash", "deepseek-v4-pro", "gpt-6-luna", "claude-haiku-5-5", "claude-sonnet-4-6"].map((id) => ({ id, object: "model" })) });
    }

    if (req.url === "/v1/messages") {
      const q = String(body.messages?.[0]?.content ?? "");
      return send({
        content: [
          { type: "server_tool_use", id: "s1", name: "web_search", input: { query: q } },
          { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com/answer", title: "Example source" }] },
          { type: "text", text: "Mock search answer: the sky is blue today." },
        ],
        usage: { input_tokens: 120, output_tokens: 30 },
      });
    }

    if (req.url === "/v1/chat/completions") {
      const msgs: any[] = body.messages ?? [];
      const last = msgs[msgs.length - 1];
      const sys = String(msgs[0]?.content ?? "");
      const usage = { prompt_tokens: 100, completion_tokens: 20 };

      // memory updater
      if (body.response_format?.type === "json_object") {
        const input = JSON.parse(String(last.content));
        const people = [...new Map(input.new_messages.filter((m: any) => m.user_id !== "BOT").map((m: any) => [m.user_id, m])).values()];
        return send({
          choices: [{ message: { role: "assistant", content: JSON.stringify({
            room: { summary: "Friends chatting about cats and weekend plans.", recent_topics: ["cats", "weekend plans"] },
            people: people.map((m: any) => ({ user_id: m.user_id, personality: `${m.name} is cheerful and uses lots of emoji.`, facts: [`${m.name} has a cat named Boba`], interests: ["cats"] })),
          }) } }],
          usage,
        });
      }

      // tool result came back → final answer using it
      if (last?.role === "tool" && last.tool_call_id === "call_hist") {
        const lines = String(last.content).replace(/<\/?history>/g, "").trim();
        return send({ choices: [{ message: { role: "assistant", content: lines ? `From history: ${lines.split("\n")[0]}` : "Nothing older matched." } }], usage });
      }
      if (last?.role === "tool" && last.tool_call_id === "call_kb") {
        const m = String(last.content).match(/\[1\] \(from "([^"]+)"\)\n([^\n]+)/);
        const fb = sys.match(/reply with this message[^:]*: "([^"]+)"/);
        return send({ choices: [{ message: { role: "assistant", content: m ? `From ${m[1]}: ${m[2]}` : (fb?.[1] ?? "not found") } }], usage });
      }
      if (last?.role === "tool") {
        // Only web_search returns JSON; other tools return text, so never assume parseable.
        let r: any = {};
        try {
          r = JSON.parse(String(last.content));
        } catch {
          r = { answer: String(last.content).slice(0, 200) };
        }
        return send({ choices: [{ message: { role: "assistant", content: `Mochi: according to my search, ${r.answer ?? "no idea"}` } }], usage });
      }

      const text = typeof last.content === "string" ? last.content : (last.content ?? []).map((p: any) => p.text ?? "").join(" ");
      const hasImage = Array.isArray(last.content) && last.content.some((p: any) => p.type === "image_url");
      if (/weather|news|latest/i.test(text) && body.tools?.some((t: any) => t.function?.name === "web_search")) {
        return send({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "weather today" }) } }] } }], usage });
      }
      // "what were we talking about?" → the model reaches for older messages.
      if (
        /what were we|earlier|history|之前|刚才/i.test(text) &&
        body.tools?.some((t: any) => t.function?.name === "search_history") &&
        last.role !== "tool"
      ) {
        return send({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_hist", type: "function", function: { name: "search_history", arguments: JSON.stringify({ query: "" }) } }] } }], usage });
      }
      // Knowledge base: answer from the first injected passage, or the strict fallback.
      const passage = sys.match(/\[1\] \(from "([^"]+)"\)\n([\s\S]*?)(?=\n\n\[2\]|\n\n## |$)/);
      if (passage) return send({ choices: [{ message: { role: "assistant", content: `From ${passage[1]}: ${passage[2].replace(/\s+/g, " ").replace(/^# \S+ /, "")}` } }], usage });
      const fallback = sys.match(/reply with this message[^:]*: "([^"]+)"/);
      if (fallback && body.tools?.some((t: any) => t.function?.name === "search_knowledge") && last.role !== "tool") {
        return send({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_kb", type: "function", function: { name: "search_knowledge", arguments: JSON.stringify({ query: "refund" }) } }] } }], usage });
      }
      if (fallback) return send({ choices: [{ message: { role: "assistant", content: fallback[1] } }], usage });

      const remembers = sys.includes("Boba") ? " (and how is Boba the cat?)" : "";
      const reply = hasImage ? "ooh i can see your picture! cute ✨" : `hi! you said: ${text}${remembers}`;
      return send({ choices: [{ message: { role: "assistant", content: reply } }], usage });
    }
    send({ error: "not found" }, 404);
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      const { port: p } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${p}/v1`, calls, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// Windows-safe entry guard: argv[1] is a plain path (E:\...), not a file:// URL.
const isEntry = (() => {
  try {
    return process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
  } catch {
    return false;
  }
})();
if (isEntry) {
  const m = await startMockFlatkey(4010);
  console.log(`mock flatkey on ${m.url}`);
}
