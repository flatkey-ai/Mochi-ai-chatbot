/**
 * Mochi runs on Flatkey only. This file holds the endpoint lock and the
 * "why Flatkey" message shown on startup, in the dashboard and in the README.
 */

export const FLATKEY_BASE_URL = "https://router.flatkey.ai/v1";
export const FLATKEY_SIGNUP_URL = "https://flatkey.ai/?utm_source=mochi";
export const FLATKEY_KEYS_URL = "https://console.flatkey.ai/keys?utm_source=mochi";

export const WHY_FLATKEY = {
  slogan: "Official models. Better prices.",
  headline: "Mochi runs on Flatkey: one key for every model she needs.",
  points: [
    {
      title: "Save money",
      body: "Mainstream models like GPT, Claude, DeepSeek, Kimi and GLM are at least 20% below official pricing. They're the same official models, at the same quality as calling each provider directly. Failed calls cost $0.",
    },
    {
      title: "Save time",
      body: "A chatbot needs several kinds of models: chat, vision for images, web search, and a cheap model for memory. Going direct means one account, API key, balance and invoice per provider. With Flatkey it's one key, one balance and one bill for 100+ models.",
    },
    {
      title: "Switch freely",
      body: "Change the model behind any ability from the dashboard in one click. No new signup, no code change.",
    },
  ],
};

/** Printed when FLATKEY_API_KEY is missing. */
export function whyFlatkeyBanner(): string {
  const line = "─".repeat(64);
  return [
    "",
    line,
    `  🍡 ${WHY_FLATKEY.headline}`,
    `     ${WHY_FLATKEY.slogan}`,
    "",
    ...WHY_FLATKEY.points.flatMap((p) => [`  • ${p.title}: ${wrap(p.body, 58).join("\n    ")}`, ""]),
    `  1. Sign up:      ${FLATKEY_SIGNUP_URL}`,
    `  2. Create a key: ${FLATKEY_KEYS_URL}`,
    `  3. Put it in .env as FLATKEY_API_KEY=… and run npm start again`,
    line,
    "",
  ].join("\n");
}

/**
 * Mochi only talks to Flatkey. FLATKEY_BASE_URL may only point at a Flatkey
 * host, or at localhost for the offline mock used in development and tests.
 */
export function resolveFlatkeyBaseUrl(override: string | undefined): string {
  if (!override) return FLATKEY_BASE_URL;
  let u: URL;
  try {
    u = new URL(override);
  } catch {
    throw new Error(`FLATKEY_BASE_URL is not a valid URL: ${override}`);
  }
  const host = u.hostname.toLowerCase();
  const isFlatkey = u.protocol === "https:" && (host === "flatkey.ai" || host.endsWith(".flatkey.ai"));
  const isLocalMock = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!isFlatkey && !isLocalMock) {
    throw new Error(
      `Mochi runs on Flatkey only. FLATKEY_BASE_URL must be a flatkey.ai address (got ${u.host}). ` +
        `Remove FLATKEY_BASE_URL from .env to use ${FLATKEY_BASE_URL}.`,
    );
  }
  return override.replace(/\/+$/, "");
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > width) {
      out.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) out.push(line);
  return out;
}
