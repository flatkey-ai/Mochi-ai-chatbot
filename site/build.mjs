// Builds the Mochi website into site/dist: English at the root, then zh/, ja/, pt/.
//   node site/build.mjs            (SITE_URL overrides the canonical base URL)
import fs from "node:fs";
import path from "node:path";
import { CONTENT, LANGS } from "./content.mjs";

const here = import.meta.dirname;
const root = path.resolve(here, "..");
const out = path.join(here, "dist");
const SITE_URL = (process.env.SITE_URL || "https://flatkey-ai.github.io/Mochi-ai-chatbot/").replace(/\/?$/, "/");
const REPO = "https://github.com/flatkey-ai/Mochi-ai-chatbot";
const DEPLOY_GUIDE = `${REPO}/blob/main/deploy/README.md`;

/** Tracked Flatkey link. utm_medium=mochi_site; utm_content gets a _zh/_ja/_pt suffix outside English. */
function fk(dest, content, lang) {
  const base = { keys: "https://console.flatkey.ai/keys", home: "https://flatkey.ai/", contact: "https://flatkey.ai/contact" }[dest];
  const u = new URL(base);
  u.searchParams.set("utm_source", "mochi_bot");
  u.searchParams.set("utm_medium", "mochi_site");
  u.searchParams.set("utm_campaign", "mochi");
  u.searchParams.set("utm_content", lang === "en" ? content : `${content}_${lang}`);
  return u.toString();
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dirOf = (lang) => (lang === "en" ? "" : `${lang}/`);

const PLATFORMS = [
  ["Discord", "#5865F2"],
  ["Telegram", "#27A7E7"],
  ["Slack", "#4A154B"],
  ["QQ", "#12B7F5"],
  ["LINE", "#06C755"],
  ["Website", "#ff6fae"],
];

function page(lang) {
  const c = CONTENT[lang];
  const up = lang === "en" ? "" : "../";
  const a = (p) => `${up}assets/${p}`;
  const url = SITE_URL + dirOf(lang);
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${CONTENT[l].htmlLang}" href="${SITE_URL + dirOf(l)}">`).join("\n    ");
  const switcher = LANGS.map(
    (l) => `<a href="${up}${dirOf(l) || "./"}" lang="${CONTENT[l].htmlLang}"${l === lang ? ' aria-current="true"' : ""}>${CONTENT[l].label}</a>`,
  ).join("");

  return `<!doctype html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(c.title)}</title>
  <meta name="description" content="${esc(c.description)}">
  <link rel="canonical" href="${url}">
    ${alternates}
  <link rel="alternate" hreflang="x-default" href="${SITE_URL}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(c.title)}">
  <meta property="og:description" content="${esc(c.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE_URL}assets/social-preview.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#ff6fae">
  <link rel="icon" type="image/png" href="${a("favicon.png")}">
  <link rel="stylesheet" href="${a("site.css")}">
</head>
<body>
  <header class="nav">
    <div class="wrap nav-in">
      <a class="brand" href="${up || "./"}"><img src="${a("mochi-avatar-128.png")}" alt="" width="36" height="36"><span>Mochi</span></a>
      <nav class="links">
        <a href="#features">${c.nav.features}</a>
        <a href="#how">${c.nav.how}</a>
        <a href="#why">${c.nav.why}</a>
        <a href="#faq">${c.nav.faq}</a>
        <a href="${REPO}">${c.nav.github}</a>
      </nav>
      <details class="lang">
        <summary aria-label="Language">🌐 ${c.label}</summary>
        <div class="lang-menu">${switcher}</div>
      </details>
      <a class="btn btn-pink btn-sm" href="${fk("keys", "nav_cta", lang)}">${c.nav.cta}</a>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap hero-in">
        <div class="hero-copy">
          <p class="eyebrow">${c.hero.eyebrow}</p>
          <h1>${c.hero.h1a}<br><span class="grad">${c.hero.h1b}</span></h1>
          <p class="lead">${c.hero.sub}</p>
          <div class="ctas">
            <a class="btn btn-pink" href="${fk("keys", "hero_cta", lang)}">🔑 ${c.hero.cta1}</a>
            <a class="btn btn-ghost" href="#how">🚀 ${c.hero.cta2}</a>
            <a class="btn btn-ghost" href="${REPO}">⭐ ${c.hero.cta3}</a>
          </div>
          <p class="note">${c.hero.note}</p>
          <div class="platforms"><span>${c.runsOn}</span>${PLATFORMS.map(([n, col]) => `<i style="--c:${col}">${n}</i>`).join("")}</div>
        </div>
        <div class="hero-art">
          <div class="halo"></div>
          <img class="avatar" src="${a("mochi-avatar-512.png")}" alt="Mochi" width="380" height="380">
          <div class="chat" aria-label="Demo chat">
            <div class="chat-head"><b>${c.demo.channel}</b><span>● online</span></div>
            <div class="chat-body" id="chat" data-typing="${esc(c.demo.typing)}"></div>
          </div>
        </div>
      </div>
    </section>

    <section id="features" class="sec">
      <div class="wrap">
        <h2>${c.features.h2}</h2>
        <p class="sub">${c.features.sub}</p>
        <div class="grid4">
          ${c.features.items.map((f) => `<article class="card"><div class="ico">${f.icon}</div><h3>${f.t}</h3><p>${f.b}</p></article>`).join("\n          ")}
        </div>
      </div>
    </section>

    <section id="how" class="sec sec-tint">
      <div class="wrap">
        <h2>${c.how.h2}</h2>
        <ol class="steps">
          ${c.how.steps
            .map(
              (s, i) =>
                `<li class="card step"><span class="num">${i + 1}</span><h3>${s.t}</h3><p>${s.b}</p>${
                  i === 0
                    ? `<a class="btn btn-pink btn-sm" href="${fk("keys", "step1_cta", lang)}">${c.nav.cta} →</a>`
                    : i === 1
                      ? `<a class="btn btn-ghost btn-sm" href="${DEPLOY_GUIDE}">${c.how.deployGuide} →</a>`
                      : ""
                }</li>`,
            )
            .join("\n          ")}
        </ol>
        <pre class="code"><code>${esc(c.how.code)}</code></pre>
      </div>
    </section>

    <section id="why" class="sec">
      <div class="wrap why">
        <div class="why-head">
          <h2>${c.why.h2}</h2>
          <p class="slogan grad">${c.why.slogan}</p>
          <p class="sub">${c.why.lead}</p>
          <a class="btn btn-pink" href="${fk("keys", "why_cta", lang)}">${c.why.cta}</a>
          <p class="powered">Powered by <a href="${fk("home", "why_logo", lang)}"><b>flatkey</b></a></p>
        </div>
        <div class="why-points">
          ${c.why.points.map((p, i) => `<article class="card"><h3>${["💸", "⏱️", "🔁"][i]} ${p.t}</h3><p>${p.b}</p></article>`).join("\n          ")}
        </div>
      </div>
    </section>

    <section class="sec sec-tint">
      <div class="wrap">
        <h2>${c.shots.h2}</h2>
        <div class="shots">
          ${c.shots.items.map((s) => `<figure><img src="${a(s.img)}" alt="${esc(s.c)}" loading="lazy"><figcaption>${s.c}</figcaption></figure>`).join("\n          ")}
        </div>
      </div>
    </section>

    <section class="sec">
      <div class="wrap">
        <h2>${c.uses.h2}</h2>
        <div class="grid3">
          ${c.uses.items.map((u) => `<article class="card use"><div class="ico">${u.icon}</div><h3>${u.t}</h3><p>${u.b}</p></article>`).join("\n          ")}
        </div>
      </div>
    </section>

    <section id="faq" class="sec sec-tint">
      <div class="wrap narrow">
        <h2>${c.faq.h2}</h2>
        ${c.faq.items.map((f) => `<details class="faq"><summary>${f.q}</summary><p>${f.a}</p></details>`).join("\n        ")}
      </div>
    </section>

    <section class="sec final">
      <div class="wrap final-in">
        <img src="${a("mochi-avatar-256.png")}" alt="" width="120" height="120">
        <h2>${c.final.h2}</h2>
        <p class="sub">${c.final.sub}</p>
        <div class="ctas center">
          <a class="btn btn-pink" href="${fk("keys", "final_cta", lang)}">🔑 ${c.final.cta}</a>
          <a class="btn btn-ghost" href="${REPO}">${c.final.cta2}</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="foot">
    <div class="wrap foot-in">
      <div><b>Mochi</b> · ${c.footer.tag}</div>
      <div class="foot-links">
        <a href="${REPO}">GitHub</a>
        <a href="${REPO}/blob/main/LICENSE">${c.footer.license}</a>
        <a href="${fk("home", "footer", lang)}">flatkey.ai</a>
        <a href="${fk("contact", "footer_contact", lang)}">${c.footer.contact}</a>
      </div>
    </div>
  </footer>
  <script>window.MOCHI_DEMO = ${JSON.stringify(c.demo.msgs).replace(/</g, "\\u003c")};</script>
  <script src="${a("site.js")}" defer></script>
</body>
</html>
`;
}

async function resizeAvatar(sizes) {
  // Small avatar copies for nav/favicon, rendered with the preinstalled Playwright.
  const { createRequire } = await import("node:module");
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    for (const s of sizes) fs.copyFileSync(path.join(root, "docs/mochi-avatar-512.png"), path.join(out, `assets/mochi-avatar-${s}.png`));
    return; // CI without Playwright: fall back to the 512px file
  }
  const browser = await chromium.launch();
  const pg = await browser.newPage();
  const data = fs.readFileSync(path.join(root, "docs/mochi-avatar-512.png")).toString("base64");
  for (const s of sizes) {
    await pg.setViewportSize({ width: s, height: s });
    await pg.setContent(`<body style="margin:0;background:transparent"><img src="data:image/png;base64,${data}" style="width:${s}px;height:${s}px;display:block;border-radius:50%"></body>`);
    await pg.screenshot({ path: path.join(out, `assets/mochi-avatar-${s}.png`), omitBackground: true });
  }
  await browser.close();
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets"), { recursive: true });
for (const f of ["mochi-avatar-512.png", "social-preview.png", "bots.png", "persona.png", "knowledge.png", "channels.png"]) {
  fs.copyFileSync(path.join(root, "docs", f), path.join(out, "assets", f));
}
for (const f of ["site.css", "site.js"]) fs.copyFileSync(path.join(here, f), path.join(out, "assets", f));
const committed = path.join(here, "avatars");
if (fs.existsSync(committed)) {
  for (const f of fs.readdirSync(committed)) fs.copyFileSync(path.join(committed, f), path.join(out, "assets", f));
} else {
  await resizeAvatar([128, 256]);
}
fs.copyFileSync(path.join(out, "assets/mochi-avatar-128.png"), path.join(out, "assets/favicon.png"));

for (const lang of LANGS) {
  const dir = path.join(out, dirOf(lang));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), page(lang));
}
fs.writeFileSync(path.join(out, ".nojekyll"), "");
fs.writeFileSync(
  path.join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${LANGS.map((l) => `  <url><loc>${SITE_URL + dirOf(l)}</loc></url>`).join("\n")}\n</urlset>\n`,
);
fs.writeFileSync(path.join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
console.log(`Built ${LANGS.length} pages into ${path.relative(root, out)}/ (base ${SITE_URL})`);
