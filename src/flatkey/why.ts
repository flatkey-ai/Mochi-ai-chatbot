/**
 * Mochi runs on Flatkey only. This file holds the endpoint lock and the
 * "why Flatkey" message shown on startup, in the dashboard and in the README.
 */

export const FLATKEY_BASE_URL = "https://router.flatkey.ai/v1";
/** The model catalog for an API key (what flatkey.ai/models shows), fetched with the key. */
export const FLATKEY_MODELS_URL = "https://console.flatkey.ai/v1/models";

/**
 * UTM scheme for every Flatkey link Mochi shows:
 *   utm_source   = mochi_bot (always)
 *   utm_medium   = where it's shown: local_deploy (terminal, .env), dashboard,
 *                  github (README), web_widget (embedded on users' websites)
 *   utm_campaign = mochi (always)
 *   utm_content  = the exact spot, e.g. startup_banner, why_card, powered_by
 * Static files (README, .env.example, widget.js, dashboard HTML) hardcode the same scheme;
 * test/utm.test.ts checks that every Flatkey link in the repo follows it.
 */
export type UtmMedium = "local_deploy" | "dashboard" | "github" | "web_widget";

const DESTINATIONS = {
  home: "https://flatkey.ai/",
  keys: "https://console.flatkey.ai/keys",
} as const;

export function flatkeyUrl(dest: keyof typeof DESTINATIONS, medium: UtmMedium, content: string): string {
  const u = new URL(DESTINATIONS[dest]);
  u.searchParams.set("utm_source", "mochi_bot");
  u.searchParams.set("utm_medium", medium);
  u.searchParams.set("utm_campaign", "mochi");
  u.searchParams.set("utm_content", content);
  return u.toString();
}

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
    `  1. Sign up:      ${flatkeyUrl("home", "local_deploy", "startup_banner")}`,
    `  2. Create a key: ${flatkeyUrl("keys", "local_deploy", "startup_banner")}`,
    `  3. Paste it in the dashboard (Flatkey API key page), or set FLATKEY_API_KEY in .env`,
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
