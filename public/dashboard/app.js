// Mochi dashboard: vanilla JS, no build step.
// Every user-facing string goes through t(englishText, vars). Translations live in i18n.js.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ── i18n ─────────────────────────────────────────────────────────
const LANGS = { en: "English", pt: "Português", ja: "日本語", zh: "中文" };
const LOCALE = { en: "en-US", pt: "pt-BR", ja: "ja-JP", zh: "zh-CN" };
function detectLang() {
  const saved = ls.get("mochi_lang");
  if (saved && LANGS[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const c = String(l).toLowerCase().slice(0, 2);
    if (LANGS[c]) return c;
  }
  return "en";
}
let lang = detectLang();
/** Translate an English UI string; {name} placeholders are filled from vars (not escaped: pass escaped HTML). */
function t(key, vars) {
  const s = (lang !== "en" && window.I18N?.[lang]?.[key]) || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}
function setLang(l) {
  lang = LANGS[l] ? l : "en";
  ls.set("mochi_lang", lang);
  document.documentElement.lang = LOCALE[lang];
  applyStatic();
  if (ov) { renderNav(); route(); }
}
/** Elements in index.html marked with data-i18n / data-i18n-placeholder. */
function applyStatic() {
  $$("[data-i18n]").forEach((el) => (el.innerHTML = t(el.dataset.i18n)));
  $$("[data-i18n-placeholder]").forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  $$(".lang-select").forEach((sel) => {
    sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang ? "selected" : ""}>${v}</option>`).join("");
  });
}
$$(".lang-select").forEach((sel) => sel.addEventListener("change", () => setLang(sel.value)));

const fmt = (n) => Number(n || 0).toLocaleString(LOCALE[lang]);
const money = (n) => (n == null ? "–" : "$" + n.toFixed(n < 1 ? 4 : 2));
const ago = (ts) => {
  const s = (Date.now() - ts) / 1000;
  return s < 60 ? t("just now") : s < 3600 ? t("{n}m ago", { n: Math.floor(s / 60) }) : s < 86400 ? t("{n}h ago", { n: Math.floor(s / 3600) }) : new Date(ts).toLocaleDateString(LOCALE[lang]);
};

let token = ls.get("mochi_admin_token") || "";
let ov = null; // /overview
let modelsLoaded = false;
let MODELS = []; // [{ id, provider, type }] from the Flatkey catalog for the bound key

async function api(path, opts = {}) {
  const res = await fetch("/api/admin" + path, {
    ...opts,
    headers: { "content-type": "application/json", authorization: "Bearer " + token, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin(t("Wrong token")); throw new Error("unauthorized"); }
  const data = await res.json().catch(() => ({}));
  // Server errors are English; translate the ones we know.
  if (!res.ok) throw new Error(t(data.error || res.statusText));
  return data;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2400);
}

function showLogin(err = "") {
  $("#login").classList.remove("hidden");
  $("#app").classList.add("hidden");
  $("#login-error").textContent = err;
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  token = $("#token").value.trim();
  try { await boot(); ls.set("mochi_admin_token", token); } catch {}
});
$("#logout").addEventListener("click", () => { ls.del("mochi_admin_token"); token = ""; showLogin(); });

// Two-click confirm without browser dialogs.
function armed(btn, label) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1";
  const old = btn.textContent;
  btn.textContent = label || t("Sure?");
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 3000);
  return false;
}

function modal(html) {
  $("#modal-body").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ── boot & routing ───────────────────────────────────────────────
async function boot() {
  ov = await api("/overview");
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  if (!ov.flatkey.bound && (!location.hash || location.hash === "#bots")) location.hash = "#flatkey";
  renderNav();
  route();
}
async function refreshOverview() { ov = await api("/overview"); renderNav(); }

function renderNav() {
  $("#nav-key-dot").className = "dot " + (ov.flatkey.bound ? "ok" : "bad");
  $(".fk-badge").href = ov.whyFlatkey.badgeUrl;
  $("#nav-bots").innerHTML = ov.bots.map((b) => `<a href="#bot/${b.id}/overview" data-nav="bot/${b.id}"><span class="mini-avatar" style="--c:${b.persona.color}">${esc(b.persona.avatar)}</span>${esc(b.persona.name)}</a>`).join("");
  highlightNav();
}
function highlightNav() {
  const h = location.hash.slice(1) || "bots";
  $$("#nav a").forEach((a) => a.classList.toggle("active", h === a.dataset.nav || h.startsWith(a.dataset.nav + "/")));
}

window.addEventListener("hashchange", route);
function route() {
  const h = location.hash.slice(1) || "bots";
  highlightNav();
  const [page, id, tab] = h.split("/");
  if (page === "flatkey") return viewFlatkey();
  if (page === "usage") return viewUsage();
  if (page === "bot" && id) return viewBot(id, tab || "overview");
  return viewBots();
}

async function ensureModels() {
  if (modelsLoaded || !ov.flatkey.bound) return;
  try {
    const { models } = await api("/models");
    MODELS = models;
    $("#model-list").innerHTML = models.map((m) => `<option value="${esc(m.id)}">`).join("");
    modelsLoaded = models.length > 0;
  } catch {}
}

/** Dropdown of the Flatkey catalog (grouped by provider) plus "Custom model ID…". */
function modelPicker(id, value) {
  const known = MODELS.some((m) => m.id === value);
  const groups = {};
  for (const m of MODELS) (groups[m.provider || "Other"] ??= []).push(m);
  const opts = Object.entries(groups).map(([prov, ms]) =>
    `<optgroup label="${esc(prov)}">${ms.map((m) => `<option value="${esc(m.id)}" ${m.id === value ? "selected" : ""}>${esc(m.id)}${m.type && m.type !== "text" ? ` (${esc(m.type)})` : ""}</option>`).join("")}</optgroup>`).join("");
  return `<div class="model-picker" data-picker="${id}">
    <select id="${id}-sel">${opts}<option value="__custom" ${known ? "" : "selected"}>✏️ ${t("Custom model ID…")}</option></select>
    <input id="${id}" value="${esc(value)}" placeholder="${esc(t("Type any model ID from flatkey.ai/models"))}" class="${known ? "hidden" : ""}" spellcheck="false" />
  </div>`;
}
function wirePickers(root = document) {
  $$("[data-picker]", root).forEach((w) => {
    const sel = $("select", w), inp = $("input", w);
    sel.addEventListener("change", () => {
      if (sel.value === "__custom") { inp.classList.remove("hidden"); inp.focus(); }
      else { inp.value = sel.value; inp.classList.add("hidden"); }
    });
  });
}

const view = () => $("#view");
const keyAlert = () => ov.flatkey.bound ? "" : `
  <a href="#flatkey" class="alert"><span class="alert-icon">🔑</span>
  <span><b>${t("Your bots are asleep: bind your Flatkey API key to wake them up.")}</b><br /><small>${t("It takes about a minute. Create a key on Flatkey, paste it here, done.")}</small></span>
  <span class="btn primary small">${t("Bind key →")}</span></a>`;
const modeTag = (mode) => `<span class="tag ${mode}">${mode === "qa" ? t("Q&A") : t("Companion")}</span>`;

// ── Bots list ────────────────────────────────────────────────────
const PLATFORM = {
  discord: { icon: "🎮", name: "Discord" },
  telegram: { icon: "✈️", name: "Telegram" },
  slack: { icon: "💼", name: "Slack" },
  qq: { icon: "🐧", name: "QQ" },
  web: { icon: "🌐", name: "Website" },
};
const pname = (p) => (p === "web" ? t("Website") : PLATFORM[p].name);

async function viewBots() {
  await refreshOverview();
  const w = ov.whyFlatkey;
  view().innerHTML = `
    <header class="page-head"><h2>${t("Your bots")}</h2><p class="muted">${t("Each bot has its own persona, knowledge base, channels, memory and budget. All of them run on your one Flatkey key.")}</p></header>
    ${keyAlert()}
    <div class="bot-grid">
      ${ov.bots.map((b) => `
        <a class="bot-card" href="#bot/${b.id}/overview" style="--c:${b.persona.color}">
          <div class="bot-head"><span class="avatar">${esc(b.persona.avatar)}</span>
            <div><b>${esc(b.persona.name)}</b>${modeTag(b.mode)}</div></div>
          <p class="muted small desc">${esc(b.persona.description) || `<i>${t("No description yet")}</i>`}</p>
          <div class="chan-row">${b.channels.map((c) => `<span class="chan ${c.running ? "on" : c.bound ? "idle" : ""}" title="${esc(pname(c.platform))}: ${esc(c.running ? t("live") : c.bound ? t("connected, not running") : t("not connected"))}">${PLATFORM[c.platform].icon}</span>`).join("")}</div>
          <div class="bot-stats"><span>💬 ${t("{n} tokens today", { n: fmt(b.tokensToday) })}</span><span>🧠 ${t("{n} people", { n: fmt(b.people) })}</span><span>📚 ${t("{n} docs", { n: fmt(b.knowledge.docs) })}</span></div>
        </a>`).join("")}
      <button class="bot-card new" id="new-bot"><span class="plus">＋</span><b>${t("New bot")}</b><span class="muted small">${t("Companion, Q&A / support, study buddy or blank")}</span></button>
    </div>
    <div class="card why">
      <h3>${t("Why your bots run on Flatkey")}</h3>
      <p class="slogan">${esc(t(w.slogan))}</p>
      <div class="why-grid">${w.points.map((p, i) => `<div><b>${["💸", "⏱️", "🔀"][i] || "✨"} ${esc(t(p.title))}</b><p>${esc(t(p.body))}</p></div>`).join("")}</div>
      <div class="actions left"><a class="btn primary" href="${esc(w.keysUrl)}" target="_blank" rel="noopener">${t("Manage API keys")}</a><a class="btn ghost" href="${esc(w.homeUrl)}" target="_blank" rel="noopener">${t("Explore models")}</a></div>
    </div>`;
  $("#new-bot").addEventListener("click", newBotModal);
}

function newBotModal() {
  modal(`
    <h3>${t("Create a bot")}</h3>
    <p class="muted small">${t("Pick a starting point. You can change everything afterwards.")}</p>
    <div class="preset-grid">${ov.presets.map((p, i) => `
      <label class="preset"><input type="radio" name="preset" value="${p.id}" ${i === 0 ? "checked" : ""} />
        <span class="preset-avatar">${esc(p.avatar || "🤖")}</span><b>${esc(t(p.label))}</b><span class="muted small">${esc(t(p.blurb))}</span></label>`).join("")}
    </div>
    <label>${t("Name")}<input id="nb-name" placeholder="${esc(t("Leave empty to use the preset's name"))}" maxlength="40" /></label>
    <div class="actions"><button class="btn ghost" onclick="closeModal()">${t("Cancel")}</button><button class="btn primary" id="nb-create">${t("Create bot")}</button></div>`);
  $("#nb-create").addEventListener("click", async () => {
    const preset = $("input[name=preset]:checked").value;
    const { bot } = await api("/bots", { method: "POST", body: { preset, name: $("#nb-name").value.trim() || undefined } });
    closeModal();
    await refreshOverview();
    toast(t("{name} created", { name: `${bot.persona.avatar} ${bot.persona.name}` }));
    location.hash = `#bot/${bot.id}/persona`;
  });
}

// ── Single bot ───────────────────────────────────────────────────
const TABS = () => [
  ["overview", t("Overview")], ["persona", t("Persona")], ["knowledge", t("Knowledge base")], ["channels", t("Channels")],
  ["abilities", t("Models & abilities")], ["memory", t("Memory")], ["playground", t("Playground")],
];
let cur = null; // { bot, summary, channels, widgetSnippet, personaPrompt }

async function viewBot(id, tab) {
  try { cur = await api("/bots/" + id); } catch { location.hash = "#bots"; return; }
  const b = cur.bot;
  view().innerHTML = `
    ${keyAlert()}
    <header class="bot-header" style="--c:${b.persona.color}">
      <span class="avatar big">${esc(b.persona.avatar)}</span>
      <div><h2>${esc(b.persona.name)} ${modeTag(b.mode)}</h2>
        <p class="muted small">${esc(b.persona.description) || t("No description yet. Add one in Persona.")}</p></div>
    </header>
    <nav class="tabs">${TABS().map(([k, label]) => `<a href="#bot/${b.id}/${k}" class="${k === tab ? "active" : ""}">${label}</a>`).join("")}</nav>
    <section id="tab"></section>`;
  const fn = { overview: tabOverview, persona: tabPersona, knowledge: tabKnowledge, channels: tabChannels, abilities: tabAbilities, memory: tabMemory, playground: tabPlayground }[tab] || tabOverview;
  fn(b);
}

async function saveBot(patch, msg) {
  const r = await api("/bots/" + cur.bot.id, { method: "PUT", body: patch });
  cur.bot = r.bot;
  cur.personaPrompt = r.personaPrompt;
  toast(msg || t("Saved ✨"));
  refreshOverview();
  return r.bot;
}

// Overview tab
function tabOverview(b) {
  const s = cur.summary;
  const chips = (on, label) => `<span class="chip ${on ? "on" : "off"}">${label}</span>`;
  $("#tab").innerHTML = `
    <div class="stats">
      <div class="stat"><span>${t("Tokens today")}</span><b>${fmt(s.tokensToday)}</b><small>${b.limits.dailyTokenBudget ? t("{pct}% of daily budget", { pct: Math.round((s.tokensToday / b.limits.dailyTokenBudget) * 100) }) : t("no daily cap")}</small></div>
      <div class="stat"><span>${t("People remembered")}</span><b>${fmt(s.people)}</b><small>${t("across {n} chat room(s)", { n: fmt(s.rooms) })}</small></div>
      <div class="stat"><span>${t("Knowledge base")}</span><b>${fmt(s.knowledge.docs)}</b><small>${b.knowledge.strict ? t("answers only from docs") : t("documents")}</small></div>
      <div class="stat"><span>${t("Live channels")}</span><b>${s.channels.filter((c) => c.running).length}</b><small>${t("of {n}", { n: s.channels.length })}</small></div>
    </div>
    <div class="card"><h3>${t("At a glance")}</h3><div class="chips">
      ${chips(b.features.memory, "🧠 " + t("memory"))} ${chips(b.features.search && !b.knowledge.strict, "🔎 " + t("web search"))} ${chips(b.features.vision, "🖼️ " + t("image reading"))}
      ${chips(b.knowledge.enabled && s.knowledge.docs > 0, "📚 " + t("knowledge base"))} <span class="chip">💬 ${esc(b.models.chat)}</span>
    </div></div>
    <div class="card"><h3>${t("Channels")}</h3><div class="chips">
      ${cur.channels.map((c) => `<a class="chip ${c.running ? "on" : ""}" href="#bot/${b.id}/channels">${PLATFORM[c.platform].icon} ${esc(pname(c.platform))}: ${c.running ? t("live") : c.bound ? t("connected") : t("not connected")}</a>`).join("")}
      <a class="chip ${b.channels.web.enabled ? "on" : ""}" href="#bot/${b.id}/channels">🌐 ${t("Website")}: ${b.channels.web.enabled ? t("on") : t("off")}</a>
    </div></div>
    <div class="card danger-zone"><h3>${t("Danger zone")}</h3>
      <p class="muted small">${t("Deleting a bot disconnects its channels and erases its memory and knowledge base.")}</p>
      <button class="btn danger" id="del-bot">${t("Delete {name}", { name: esc(b.persona.name) })}</button></div>`;
  $("#del-bot").addEventListener("click", async (e) => {
    if (!armed(e.target, t("Click again to delete"))) return;
    try { await api("/bots/" + b.id, { method: "DELETE" }); toast(t("Bot deleted")); await refreshOverview(); location.hash = "#bots"; }
    catch (err) { toast(err.message); }
  });
}

// Persona tab
function tabPersona(b) {
  const p = b.persona;
  const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  $("#tab").innerHTML = `
    <div class="persona-layout">
      <div>
        <div class="card">
          <h3>${t("Identity")}</h3>
          <div class="identity-row">
            <label>${t("Avatar")}<input id="p-avatar" value="${esc(p.avatar)}" maxlength="4" class="emoji-input" /></label>
            <label>${t("Color")}<input id="p-color" type="color" value="${esc(p.color)}" /></label>
            <label class="grow">${t("Name")}<input id="p-name" value="${esc(p.name)}" maxlength="40" /></label>
          </div>
          <label>${t("Description")} <small>${t("Public one-liner. Shown in the website widget and synced to your Telegram and Discord bot profiles.")}</small>
            <textarea id="p-desc" rows="2" maxlength="300">${esc(p.description)}</textarea></label>
          <label>${t("Greeting")} <small>${t("The first message the website widget shows.")}</small><input id="p-greet" value="${esc(p.greeting)}" maxlength="300" /></label>
          <label>${t("Type")}
            ${sel("p-mode", [["companion", t("Companion: chats, remembers people, joins conversations")], ["qa", t("Q&A / support: answers from your knowledge base")]], b.mode)}</label>
        </div>
        <div class="card">
          <h3>${t("Personality")}</h3>
          <label>${t("Personality")} <small>${t("Who is this bot? Traits, humour, values.")}</small><textarea id="p-pers" rows="3" maxlength="1500">${esc(p.personality)}</textarea></label>
          <div class="grid3">
            <label>${t("Tone")}${sel("p-tone", [["playful", t("Playful")], ["friendly", t("Friendly")], ["professional", t("Professional")], ["sassy", t("Sassy")], ["calm", t("Calm")]], p.tone)}</label>
            <label>${t("Emoji")}${sel("p-emoji", [["none", t("None")], ["some", t("Some")], ["lots", t("Lots")]], p.emoji)}</label>
            <label>${t("Reply length")}${sel("p-len", [["short", t("Short")], ["medium", t("Medium")], ["long", t("Detailed")]], p.replyLength)}</label>
          </div>
          <label>${t("Language")} <small>${t("“auto” replies in the user's language, or type one, e.g. English, 中文, Português.")}</small><input id="p-lang" value="${esc(p.language)}" maxlength="40" /></label>
          <label>${t("Backstory")} <small>${t("Optional.")}</small><textarea id="p-back" rows="2" maxlength="2000">${esc(p.backstory)}</textarea></label>
          <label>${t("Rules")} <small>${t("One per line: do's and don'ts, topics to avoid, when to hand off to a human.")}</small><textarea id="p-rules" rows="4" maxlength="3000">${esc(p.rules)}</textarea></label>
          <details ${p.customPrompt ? "open" : ""}><summary>${t("Advanced: write the whole prompt yourself")}</summary>
            <label>${t("Custom prompt")} <small>${t("If filled in, this replaces everything generated from the fields above.")}</small><textarea id="p-custom" rows="6" maxlength="8000">${esc(p.customPrompt)}</textarea></label>
          </details>
        </div>
        <div class="card">
          <h3>${t("When to reply")}</h3>
          <label>${t("Nicknames")} <small>${t("Comma-separated. Saying one in a group chat gets a reply.")}</small><input id="p-nick" value="${esc(p.nicknames.join(", "))}" /></label>
          <div class="toggle-row"><b>${t("Direct messages")}</b><label class="switch"><input type="checkbox" id="t-dm" ${b.triggers.replyInDirectMessages ? "checked" : ""} /><span></span></label></div>
          <div class="toggle-row"><b>${t("When @mentioned or replied to")}</b><label class="switch"><input type="checkbox" id="t-mention" ${b.triggers.replyWhenMentioned ? "checked" : ""} /><span></span></label></div>
          <div class="toggle-row"><b>${t("When its name or a nickname is said")}</b><label class="switch"><input type="checkbox" id="t-name" ${b.triggers.replyWhenNameSaid ? "checked" : ""} /><span></span></label></div>
          <label>${t("Random chime-in chance in groups:")} <b id="t-rand-val">${Math.round(b.triggers.randomReplyChance * 100)}%</b><input type="range" id="t-rand" min="0" max="0.3" step="0.01" value="${b.triggers.randomReplyChance}" /></label>
        </div>
        <div class="sticky-save"><button class="btn primary" id="save-persona">${t("Save persona")}</button></div>
      </div>
      <aside class="persona-preview">
        <div class="card">
          <h3>${t("Widget preview")}</h3>
          <div class="wprev" id="wprev"></div>
        </div>
        <div class="card">
          <h3>${t("What the bot is told")}</h3>
          <p class="muted small">${t("Generated from your fields. Memory, knowledge and channel context are added for each message.")}</p>
          <pre id="prompt-preview">${esc(cur.personaPrompt)}</pre>
        </div>
      </aside>
    </div>`;

  const collect = () => ({
    persona: {
      avatar: $("#p-avatar").value.trim(), color: $("#p-color").value, name: $("#p-name").value.trim(),
      description: $("#p-desc").value, greeting: $("#p-greet").value, personality: $("#p-pers").value,
      tone: $("#p-tone").value, emoji: $("#p-emoji").value, replyLength: $("#p-len").value,
      language: $("#p-lang").value.trim() || "auto", backstory: $("#p-back").value, rules: $("#p-rules").value,
      customPrompt: $("#p-custom").value,
      nicknames: $("#p-nick").value.split(",").map((x) => x.trim()).filter(Boolean),
    },
    triggers: {
      replyInDirectMessages: $("#t-dm").checked, replyWhenMentioned: $("#t-mention").checked,
      replyWhenNameSaid: $("#t-name").checked, randomReplyChance: Number($("#t-rand").value),
    },
    mode: $("#p-mode").value,
  });
  const renderWidgetPreview = () => {
    const d = collect().persona;
    $("#wprev").innerHTML = `
      <div class="wprev-head" style="background:${esc(d.color)}">${esc(d.avatar)} <div><b>${esc(d.name || "Bot")}</b><small>${esc(d.description || t("usually replies in a few seconds"))}</small></div></div>
      <div class="wprev-body"><div class="wprev-msg">${esc(d.greeting || t("Hi! How can I help?"))}</div></div>`;
  };
  let timer;
  const preview = () => {
    renderWidgetPreview();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { const { prompt } = await api(`/bots/${b.id}/persona-preview`, { method: "POST", body: { persona: collect().persona } }); $("#prompt-preview").textContent = prompt; } catch {}
    }, 350);
  };
  $$("#tab input, #tab textarea, #tab select").forEach((el) => el.addEventListener("input", preview));
  $("#t-rand").addEventListener("input", (e) => ($("#t-rand-val").textContent = Math.round(e.target.value * 100) + "%"));
  renderWidgetPreview();

  $("#save-persona").addEventListener("click", async () => {
    const patch = collect();
    // Switching type applies sensible defaults for that kind of bot.
    if (patch.mode !== b.mode) {
      if (patch.mode === "qa") Object.assign(patch, { knowledge: { enabled: true, strict: true }, features: { memory: false, search: false } });
      else Object.assign(patch, { knowledge: { strict: false }, features: { memory: true } });
    }
    try {
      await saveBot(patch, patch.mode !== b.mode ? (patch.mode === "qa" ? t("Saved. Q&A mode: answers only from the knowledge base") : t("Saved. Companion mode")) : t("Persona saved ✨"));
      viewBot(b.id, "persona");
    } catch (err) { toast(err.message); }
  });
}

// Knowledge tab
async function tabKnowledge(b) {
  const { docs } = await api(`/bots/${b.id}/knowledge`);
  const k = b.knowledge;
  const srcIcon = { file: "📄", text: "✍️", url: "🔗" };
  $("#tab").innerHTML = `
    <div class="card">
      <div class="toggle-row"><div><b>📚 ${t("Use the knowledge base")}</b><p class="muted small">${t("The bot looks up your documents for every question and answers from them.")}</p></div>
        <label class="switch"><input type="checkbox" id="k-on" ${k.enabled ? "checked" : ""} /><span></span></label></div>
      <div class="toggle-row"><div><b>🎯 ${t("Only answer from the knowledge base")}</b><p class="muted small">${t("For Q&A and support bots. If the answer isn't in your documents, the bot replies with the fallback message instead of guessing. Web search is turned off in this mode.")}</p></div>
        <label class="switch"><input type="checkbox" id="k-strict" ${k.strict ? "checked" : ""} /><span></span></label></div>
      <label>${t("Fallback message")}<input id="k-fallback" value="${esc(k.fallbackMessage)}" maxlength="500" /></label>
      <label class="inline">${t("Passages per answer")} <input type="number" id="k-max" min="1" max="10" value="${k.maxChunks}" style="width:80px" /></label>
      <div class="actions"><button class="btn primary" id="k-save">${t("Save")}</button></div>
    </div>

    <div class="card">
      <h3>${t("Add knowledge")}</h3>
      <div class="subtabs"><button class="active" data-kt="file">📄 ${t("Upload files")}</button><button data-kt="text">✍️ ${t("Paste text")}</button><button data-kt="url">🔗 ${t("Import a web page")}</button></div>
      <div data-kp="file">
        <label class="dropzone" id="dropzone"><input type="file" id="k-files" multiple accept="${ov.supportedFileTypes.join(",")}" hidden />
          <b>${t("Drop files here or click to choose")}</b><span class="muted small">${ov.supportedFileTypes.join(" ")} · ${t("up to 15 MB each")}</span></label>
        <div id="upload-log" class="muted small"></div>
      </div>
      <div data-kp="text" class="hidden">
        <label>${t("Title")}<input id="k-title" placeholder="${esc(t("e.g. Refund policy"))}" maxlength="200" /></label>
        <label>${t("Content")}<textarea id="k-text" rows="8" placeholder="${esc(t("Paste FAQs, policies, product details…"))}"></textarea></label>
        <div class="actions"><button class="btn primary" id="k-add-text">${t("Add to knowledge base")}</button></div>
      </div>
      <div data-kp="url" class="hidden">
        <label>${t("Page URL")}<input id="k-url" placeholder="https://yourdomain.com/faq" /></label>
        <div class="actions"><button class="btn primary" id="k-add-url">${t("Import page")}</button></div>
      </div>
    </div>

    <div class="card">
      <h3>${t("Documents")} <span class="muted small">(${docs.length})</span></h3>
      ${docs.length ? `<table class="table"><thead><tr><th>${t("Title")}</th><th>${t("Source")}</th><th>${t("Size")}</th><th>${t("Added")}</th><th></th></tr></thead><tbody>
        ${docs.map((d) => `<tr><td><b>${esc(d.title)}</b></td><td>${srcIcon[d.source]} ${d.source === "url" ? `<a href="${esc(d.sourceRef)}" target="_blank" rel="noopener">${esc(new URL(d.sourceRef).hostname)}</a>` : esc(d.sourceRef || t("pasted"))}</td>
          <td>${t("{chars} chars · {n} passages", { chars: fmt(d.chars), n: d.chunks })}</td><td>${ago(d.createdAt)}</td>
          <td class="row-actions"><button class="btn ghost small" data-view="${d.id}">${t("View")}</button><button class="btn danger small" data-del="${d.id}">${t("Delete")}</button></td></tr>`).join("")}
        </tbody></table>` : `<p class="muted">${t("No documents yet. Add FAQs, docs or policies above and your bot can answer questions about them.")}</p>`}
    </div>

    <div class="card">
      <h3>${t("Test retrieval")}</h3>
      <p class="muted small">${t("See which passages the bot would read for a question. This doesn't call any model, so it costs nothing.")}</p>
      <form id="k-test" class="key-form"><input id="k-q" placeholder="${esc(t("e.g. how do I get a refund?"))}" /><button class="btn primary">${t("Search")}</button></form>
      <div id="k-hits"></div>
    </div>`;

  $("#k-save").addEventListener("click", () => saveBot({ knowledge: { enabled: $("#k-on").checked, strict: $("#k-strict").checked, fallbackMessage: $("#k-fallback").value, maxChunks: Number($("#k-max").value) } }));
  $$("[data-kt]").forEach((btn) => btn.addEventListener("click", () => {
    $$("[data-kt]").forEach((x) => x.classList.toggle("active", x === btn));
    $$("[data-kp]").forEach((x) => x.classList.toggle("hidden", x.dataset.kp !== btn.dataset.kt));
  }));

  const reload = () => tabKnowledge(cur.bot);
  const upload = async (files) => {
    const log = $("#upload-log");
    for (const f of files) {
      const line = document.createElement("div");
      line.textContent = `⏳ ${f.name}…`;
      log.appendChild(line);
      try {
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        const { doc } = await api(`/bots/${b.id}/knowledge/file`, { method: "POST", body: { filename: f.name, data } });
        line.textContent = `✅ ${f.name}: ${t("{chars} chars · {n} passages", { chars: fmt(doc.chars), n: doc.chunks })}`;
      } catch (err) { line.textContent = `❌ ${f.name}: ${err.message}`; }
    }
    setTimeout(reload, 900);
  };
  $("#k-files").addEventListener("change", (e) => upload([...e.target.files]));
  const dz = $("#dropzone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); upload([...e.dataTransfer.files]); });

  $("#k-add-text").addEventListener("click", async () => {
    try { await api(`/bots/${b.id}/knowledge/text`, { method: "POST", body: { title: $("#k-title").value, text: $("#k-text").value } }); toast(t("Added to knowledge base")); reload(); }
    catch (err) { toast(err.message); }
  });
  $("#k-add-url").addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = t("Importing…");
    try { const { doc } = await api(`/bots/${b.id}/knowledge/url`, { method: "POST", body: { url: $("#k-url").value.trim() } }); toast(t("Imported “{title}”", { title: doc.title })); reload(); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = t("Import page"); }
  });
  $$("[data-del]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!armed(btn)) return;
    await api(`/bots/${b.id}/knowledge/${btn.dataset.del}`, { method: "DELETE" }); toast(t("Document deleted")); reload();
  }));
  $$("[data-view]").forEach((btn) => btn.addEventListener("click", async () => {
    const { doc, text } = await api(`/bots/${b.id}/knowledge/${btn.dataset.view}`);
    modal(`<h3>${esc(doc.title)}</h3><p class="muted small">${t("{chars} chars · {n} passages", { chars: fmt(doc.chars), n: doc.chunks })}</p><pre class="doc-preview">${esc(text)}</pre><div class="actions"><button class="btn primary" onclick="closeModal()">${t("Close")}</button></div>`);
  }));
  $("#k-test").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { hits } = await api(`/bots/${b.id}/knowledge/test`, { method: "POST", body: { question: $("#k-q").value } });
    $("#k-hits").innerHTML = hits.length
      ? hits.map((h, i) => `<div class="hit"><b>${i + 1}. ${esc(h.title)}</b><p>${esc(h.text.slice(0, 400))}${h.text.length > 400 ? "…" : ""}</p></div>`).join("")
      : `<p class="muted">${t("No matching passages. Try other keywords, or add a document that covers this.")}</p>`;
  });
}

// Channels tab
/**
 * The Slack app manifest. "From a manifest" is one paste instead of ticking 8 scopes and
 * 4 events by hand, and it is the only way to get app_home / messages tab right (Slack
 * answers DMs with "Sending messages to this app has been turned off." when it is missing).
 * Keep in sync with docs/slack-app-manifest.json (test/slack-manifest.test.ts enforces it).
 */
const SLACK_MANIFEST = {
  display_information: {
    name: "Mochi",
    description: "Your AI chatbot: personas, memory, knowledge base and web search.",
    background_color: "#ff6fae",
  },
  features: {
    app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    bot_user: { display_name: "Mochi", always_online: true },
  },
  oauth_config: {
    scopes: {
      bot: ["app_mentions:read", "channels:history", "channels:read", "groups:history", "im:history", "chat:write", "users:read", "files:read"],
    },
  },
  settings: {
    event_subscriptions: { bot_events: ["app_mention", "message.channels", "message.groups", "message.im"] },
    socket_mode_enabled: true,
  },
};

const CHANNEL_HELP = () => ({
  discord: {
    fields: [["token", t("Bot token"), t("From Discord → your app → Bot → Reset Token")]],
    steps: [
      t('Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">discord.com/developers/applications</a> → <b>New Application</b>.'),
      t("Open <b>Bot</b> → <b>Reset Token</b> → copy the token."),
      t("On the same page, turn on <b>Message Content Intent</b> (the bot needs it to read group chats)."),
      t("Paste the token below and connect. You'll get an invite link to add the bot to your server."),
    ],
  },
  telegram: {
    fields: [["token", t("Bot token"), t("Looks like 123456789:AA…")]],
    steps: [
      t('Open <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> in Telegram and send <code>/newbot</code>.'),
      t("Pick a name and username, then copy the token BotFather sends you."),
      t("For group memory: BotFather → your bot → <b>Bot Settings → Group Privacy → Turn off</b>."),
      t("Paste the token below and connect."),
    ],
  },
  slack: {
    fields: [
      ["botToken", t("Bot token (xoxb-…)"), t("OAuth & Permissions → OAuth Tokens → Bot User OAuth Token")],
      ["appToken", t("App-level token (xapp-…)"), t("Basic Information → App-Level Tokens → Generate Token and Scopes → connections:write")],
    ],
    manifest: JSON.stringify(SLACK_MANIFEST, null, 2),
    steps: [
      t('Create an app at <a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> → <b>Create New App</b> → <b>From a manifest</b> → pick your workspace → paste the JSON below (the button copies it) → <b>Next → Create</b>.'),
      t("The manifest already sets Socket Mode, the 8 bot scopes, the 4 events and the Messages tab — no ticking required. Keep <b>Socket Mode</b> on under Settings if you turn it off later."),
      t("<b>Basic Information → App-Level Tokens → Generate Token and Scopes</b>: name it <code>socket</code>, <b>Add Scope</b> → <code>connections:write</code> → <b>Generate</b> → copy the <code>xapp-…</code> token."),
      t("<b>OAuth & Permissions → OAuth Tokens → Install to Workspace</b> → Allow → copy the <b>Bot User OAuth Token</b> (<code>xoxb-…</code>), then paste both tokens below."),
      t('Invite it with <code>/invite @YourBot</code> — a bot sees nothing in a channel it has not joined. Its name and icon live under <b>App Home</b>.'),
    ],
  },
  qq: {
    fields: [["appId", "AppID", t("q.qq.com → your bot → 开发管理 (Development)")], ["appSecret", "AppSecret", t("Same page. Generate it if you haven't yet.")]],
    steps: [
      t('Sign in to the <a href="https://q.qq.com/" target="_blank" rel="noopener">QQ Bot Open Platform (QQ开放平台)</a> and create a bot (创建机器人).'),
      t("Open <b>开发管理 (Development)</b>, then copy the <b>AppID</b> and generate the <b>AppSecret</b>."),
      t("On the same page, add this server's public IP to the <b>IP白名单 (IP allowlist)</b>. QQ blocks API calls from other IPs."),
      t("Under <b>沙箱配置 (Sandbox)</b>, add your QQ account and a test group so you can try the bot before it's published."),
      t("Paste the AppID and AppSecret below and connect. The bot answers @-mentions in groups, private chats and QQ guild channels."),
      t("Optional, for group memory: group settings → <b>群机器人</b> → let the bot receive all messages, not only @-mentions."),
    ],
  },
});

function tabChannels(b) {
  const help = CHANNEL_HELP();
  const card = (c) => {
    const h = help[c.platform];
    const P = PLATFORM[c.platform];
    const status = c.running ? `<span class="dot ok"></span>${c.identity ? t("Live as <b>{account}</b>", { account: esc(c.identity.account) }) : t("Live") + (c.detail ? ` · ${esc(c.detail)}` : "")}`
      : c.bound ? `<span class="dot"></span>${esc(c.detail)}` : `<span class="dot bad"></span>${t("Not connected")}`;
    const linkLabel = { discord: t("Invite to a server ↗"), telegram: t("Open in Telegram ↗"), slack: t("Open workspace ↗"), qq: t("Open QQ Bot console ↗") }[c.platform];
    const link = c.identity?.link ? `<a class="btn ghost small" href="${esc(c.identity.link)}" target="_blank" rel="noopener">${linkLabel}</a>` : "";
    return `
      <div class="card channel" data-platform="${c.platform}">
        <div class="row"><b class="ch-title">${P.icon} ${P.name}</b>
          ${c.bound ? `<label class="switch" title="${esc(t("Pause / resume"))}"><input type="checkbox" data-toggle="${c.platform}" ${c.enabled ? "checked" : ""} /><span></span></label>` : ""}</div>
        <div class="muted small">${status} ${c.source === "env" ? "· " + t("from .env") : ""}</div>
        ${link}
        <details ${c.bound ? "" : "open"}><summary>${c.bound ? t("Replace token") : t("How to connect")}</summary>
          <ol class="howto">${h.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
          ${h.manifest ? `<p class="muted small">${t("Paste this manifest (From a manifest → paste → Next → Create):")}</p>
          <pre class="snippet" data-manifest="${c.platform}">${esc(h.manifest)}</pre>
          <div class="actions left"><button type="button" class="btn ghost small" data-copy-manifest="${c.platform}">${t("Copy manifest")}</button></div>` : ""}
          <form class="bind-form" data-bind="${c.platform}">
            ${h.fields.map(([k, label, hint]) => `<label>${label}<small>${hint}</small><input name="${k}" type="${k === "appId" ? "text" : "password"}" autocomplete="off" spellcheck="false" required /></label>`).join("")}
            <div class="actions"><button class="btn primary">${t("Connect {platform}", { platform: P.name })}</button></div>
            <p class="error small" data-err></p>
          </form>
        </details>
        ${c.bound && c.source === "dashboard" ? `<div class="actions"><button class="btn danger small" data-unbind="${c.platform}">${t("Disconnect")}</button></div>` : ""}
      </div>`;
  };
  $("#tab").innerHTML = `
    <p class="muted">${t("Connect this bot to the places your people chat. Tokens are verified with each platform before saving and are stored only on your server.")}</p>
    <div class="channel-grid">
      ${cur.channels.map(card).join("")}
      <div class="card channel">
        <div class="row"><b class="ch-title">🌐 ${t("Website widget")}</b><label class="switch"><input type="checkbox" id="w-on" ${b.channels.web.enabled ? "checked" : ""} /><span></span></label></div>
        <div class="muted small"><span class="dot ${b.channels.web.enabled ? "ok" : ""}"></span>${b.channels.web.enabled ? t("On") : t("Off")} · ${t("built in, no token needed")}</div>
        <p class="muted small">${t("Paste this before <code>&lt;/body&gt;</code> on your site:")}</p>
        <pre class="snippet">${esc(cur.widgetSnippet)}</pre>
        <div class="actions left"><button class="btn ghost small" id="copy-snippet">${t("Copy snippet")}</button><a class="btn ghost small" href="/widget/demo.html?bot=${b.id}&lang=${lang}" target="_blank" rel="noopener">${t("Try it ↗")}</a></div>
        <label>${t("Allowed sites")} <small>${t("Comma-separated origins, e.g. https://example.com. Use * for any site.")}</small><input id="w-origins" value="${esc(b.channels.web.allowedOrigins.join(", "))}" /></label>
        <div class="actions"><button class="btn primary small" id="w-save">${t("Save")}</button></div>
      </div>
    </div>`;

  $$("[data-bind]").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = form.dataset.bind;
    const body = Object.fromEntries(new FormData(form).entries());
    const btn = $("button", form);
    btn.disabled = true; btn.textContent = t("Verifying…"); $("[data-err]", form).textContent = "";
    try {
      const { channel } = await api(`/bots/${b.id}/channels/${p}`, { method: "PUT", body });
      toast(channel.identity ? t("{platform} connected as {account} ✨", { platform: PLATFORM[p].name, account: channel.identity.account }) : t("{platform} connected ✨", { platform: PLATFORM[p].name }));
      setTimeout(() => viewBot(b.id, "channels"), 1500);
    } catch (err) {
      $("[data-err]", form).textContent = err.message;
      btn.disabled = false; btn.textContent = t("Connect {platform}", { platform: PLATFORM[p].name });
    }
  }));
  $$("[data-unbind]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!armed(btn)) return;
    await api(`/bots/${b.id}/channels/${btn.dataset.unbind}`, { method: "DELETE" });
    toast(t("Disconnected")); viewBot(b.id, "channels");
  }));
  $$("[data-toggle]").forEach((el) => el.addEventListener("change", async () => {
    const name = PLATFORM[el.dataset.toggle].name;
    await saveBot({ channels: { [el.dataset.toggle]: { enabled: el.checked } } }, el.checked ? t("{platform} resumed", { platform: name }) : t("{platform} paused", { platform: name }));
    setTimeout(() => viewBot(b.id, "channels"), 1500);
  }));
  $("#w-on").addEventListener("change", (e) => saveBot({ channels: { web: { enabled: e.target.checked } } }, e.target.checked ? t("Website widget on") : t("Website widget off")));
  $("#w-save").addEventListener("click", () => saveBot({ channels: { web: { allowedOrigins: $("#w-origins").value.split(",").map((x) => x.trim()).filter(Boolean) } } }));
  $("#copy-snippet").addEventListener("click", async () => { try { await navigator.clipboard.writeText(cur.widgetSnippet); toast(t("Copied")); } catch { toast(t("Select the snippet and copy it")); } });

  // Slack (and any future channel that ships a manifest): copy-paste beats a checklist.
  $$("[data-copy-manifest]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const text = $(`[data-manifest="${btn.dataset.copyManifest}"]`)?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        toast(t("Manifest copied"));
      } catch {
        toast(t("Select the manifest and copy it"));
      }
    }),
  );
}

// Models & abilities tab
async function tabAbilities(b) {
  await ensureModels();
  const n = (id, v, min, max) => `<input type="number" id="${id}" value="${v}" min="${min}" ${max ? `max="${max}"` : ""} />`;
  const modelsLink = '<a href="https://flatkey.ai/models?utm_source=mochi_bot&utm_medium=dashboard&utm_campaign=mochi&utm_content=model_picker" target="_blank" rel="noopener">flatkey.ai/models</a>';
  const featureToast = { memory: [t("Memory on"), t("Memory off")], search: [t("Web search on"), t("Web search off")], vision: [t("Image reading on"), t("Image reading off")] };
  $("#tab").innerHTML = `
    <div class="card">
      <h3>${t("Models")}</h3>
      <p class="muted small">${t("Every ability runs through your Flatkey key, so any model in the Flatkey catalog works for any job. Use a strong model for chat and a small one for background memory.")}</p>
      <div class="grid2">
        <label>${t("Chat model")}<small>${t("Main conversation")}</small>${modelPicker("m-chat", b.models.chat)}</label>
        <label>${t("Vision model")}<small>${t("Used when a message has images. Must accept image input.")}</small>${modelPicker("m-vision", b.models.vision)}</label>
        <label>${t("Memory model")}<small>${t("Background summaries and people profiles. A small model is fine.")}</small>${modelPicker("m-memory", b.models.memory)}</label>
        <label>${t("Search model")}<small>${t("Web search runs on the model's built-in search tool (Claude or GPT).")}</small>${modelPicker("m-search", b.models.search)}</label>
      </div>
      <p class="muted small">${MODELS.length ? t("{n} models available on your Flatkey key, the same list as {link}. Pick one, or choose “Custom model ID…” to type any ID.", { n: MODELS.length, link: modelsLink }) : ov.flatkey.bound ? t("Couldn't load the model list right now. Type a model ID instead.") : t('Bind your <a href="#flatkey">Flatkey API key</a> to load the model list. Until then, type a model ID.')}</p>
    </div>
    <div class="card">
      <h3>${t("Abilities &amp; cost control")}</h3>
      <div class="toggle-row"><div><b>🧠 ${t("Memory")}</b><p class="muted small">${t("Remembers people (personality, facts, interests) and what each room talks about. Costs one memory-model call every <b>{n}</b> messages per room.", { n: b.limits.memoryUpdateEvery })}</p></div><label class="switch"><input type="checkbox" id="f-memory" ${b.features.memory ? "checked" : ""} /><span></span></label></div>
      <div class="toggle-row"><div><b>🔎 ${t("Web search")}</b><p class="muted small">${t("Looks up facts it isn't sure about. Each search is one extra search-model call.")} ${b.knowledge.strict ? `<b>${t("Off while “only answer from the knowledge base” is on.")}</b>` : ""}</p></div><label class="switch"><input type="checkbox" id="f-search" ${b.features.search ? "checked" : ""} /><span></span></label></div>
      <div class="toggle-row"><div><b>🖼️ ${t("Image reading")}</b><p class="muted small">${t("Reads images people send, using the vision model. Image input uses more tokens than text.")}</p></div><label class="switch"><input type="checkbox" id="f-vision" ${b.features.vision ? "checked" : ""} /><span></span></label></div>
    </div>
    <div class="card">
      <h3>${t("Safety")}</h3>
      <p class="muted small">${t("Chat messages, documents and search results can contain text aimed at the model. These guards are deterministic: they run in the server, not in the model.")}</p>
      <div class="toggle-row"><div><b>🛡️ ${t("Prompt safeguard")}</b><p class="muted small">${t("Strips role and template syntax from untrusted text, marks quoted passages as data, refuses search queries that carry URLs or tokens, and drops any reply that leaks its instructions.")}</p></div><label class="switch"><input type="checkbox" id="sfg-prompt" ${b.safeguard?.prompt !== false ? "checked" : ""} /><span></span></label></div>
      <div class="toggle-row"><div><b>🕵️ ${t("Scrub secrets from replies")}</b><p class="muted small">${t("Removes anything that looks like an API key or token from what the bot says, and blanks out any credential this server knows.")}</p></div><label class="switch"><input type="checkbox" id="sfg-redact" ${b.safeguard?.redactSecrets !== false ? "checked" : ""} /><span></span></label></div>
    </div>
    <div class="card">
      <h3>${t("Limits")}</h3>
      <div class="grid3">
        <label>${t("Daily token budget")}<small>${t("0 = no cap. The bot goes quiet once it's reached.")}</small>${n("l-budget", b.limits.dailyTokenBudget, 0)}</label>
        <label>${t("Max reply tokens")}${n("l-reply", b.limits.maxReplyTokens, 50)}</label>
        <label>${t("Chat history (messages)")}<small>${t("More history = more tokens per reply")}</small>${n("l-history", b.limits.historyMessages, 2)}</label>
        <label>${t("Memory update every N messages")}${n("l-every", b.limits.memoryUpdateEvery, 3)}</label>
        <label>${t("Max web searches per reply")}${n("l-searches", b.search.maxSearchesPerReply, 1, 5)}</label>
        <label>${t("Max images per message")}${n("l-images", b.limits.maxImagesPerMessage, 1, 6)}</label>
        <label>${t("Messages per minute per person")}<small>${t("0 = no limit. Stops one person looping the bot and burning the budget.")}</small>${n("l-flood", b.safeguard?.floodPerMinute ?? 20, 0, 120)}</label>
      </div>
      <label class="inline">${t("Search protocol")}
        <select id="s-mode"><option value="messages" ${b.search.mode === "messages" ? "selected" : ""}>Anthropic web_search (/v1/messages)</option><option value="responses" ${b.search.mode === "responses" ? "selected" : ""}>OpenAI web_search (/v1/responses)</option></select></label>
    </div>
    <div class="sticky-save"><button class="btn primary" id="save-abilities">${t("Save")}</button></div>`;
  wirePickers($("#tab"));
  for (const k of ["memory", "search", "vision"]) $("#f-" + k).addEventListener("change", (e) => saveBot({ features: { [k]: e.target.checked } }, featureToast[k][e.target.checked ? 0 : 1]));
  $("#sfg-prompt").addEventListener("change", (e) => saveBot({ safeguard: { prompt: e.target.checked } }, e.target.checked ? t("Safeguard on") : t("Safeguard off")));
  $("#sfg-redact").addEventListener("change", (e) => saveBot({ safeguard: { redactSecrets: e.target.checked } }, e.target.checked ? t("Secret scrubbing on") : t("Secret scrubbing off")));
  $("#save-abilities").addEventListener("click", () => saveBot({
    models: Object.fromEntries(["chat", "vision", "memory", "search"].map((k) => [k, ($("#m-" + k + "-sel").value === "__custom" ? $("#m-" + k).value : $("#m-" + k + "-sel").value).trim()]).filter(([, v]) => v)),
    limits: { dailyTokenBudget: +$("#l-budget").value, maxReplyTokens: +$("#l-reply").value, historyMessages: +$("#l-history").value, memoryUpdateEvery: +$("#l-every").value, maxImagesPerMessage: +$("#l-images").value },
    safeguard: { floodPerMinute: +$("#l-flood").value },
    search: { mode: $("#s-mode").value, maxSearchesPerReply: +$("#l-searches").value },
  }).then(() => viewBot(b.id, "abilities")).catch((err) => toast(err.message)));
}

// Memory tab
async function tabMemory(b) {
  const { people, rooms } = await api(`/bots/${b.id}/memory`);
  $("#tab").innerHTML = `
    <p class="muted">${t("What {name} remembers. People can also say “forget me” to the bot.", { name: esc(b.persona.name) })}</p>
    <div class="card"><h3>${t("People")}</h3><div class="mem-list">${people.length ? people.map((p) => `
      <div class="mem"><div><b>${esc(p.displayName)}</b><span class="tag">${p.platform}</span><span class="muted small"> · ${t("{n} msgs · last seen {when}", { n: fmt(p.messageCount), when: ago(p.lastSeen) })}</span>
        ${p.personality ? `<p>🎭 ${esc(p.personality)}</p>` : ""}${p.facts.length ? `<p>📌 ${p.facts.map(esc).join(" · ")}</p>` : ""}${p.interests.length ? `<p>💖 ${p.interests.map(esc).join(", ")}</p>` : ""}
        ${!p.personality && !p.facts.length ? `<p class="muted">${t("No profile yet. It builds up as they chat.")}</p>` : ""}</div>
        <button class="btn danger small" data-fp="${p.platform}/${encodeURIComponent(p.userId)}">${t("Forget")}</button></div>`).join("") : `<p class="muted">${t("Nobody yet.")}</p>`}</div></div>
    <div class="card"><h3>${t("Rooms")}</h3><div class="mem-list">${rooms.length ? rooms.map((r) => `
      <div class="mem"><div><b>${esc(r.title || r.roomId)}</b><span class="tag">${r.platform}</span>
        ${r.summary ? `<p>${esc(r.summary)}</p>` : `<p class="muted">${t("No summary yet ({n} new msgs).", { n: r.msgsSinceUpdate })}</p>`}${r.recentTopics.length ? `<p>🗂️ ${r.recentTopics.map(esc).join(" · ")}</p>` : ""}</div>
        <button class="btn danger small" data-fr="${r.platform}/${encodeURIComponent(r.roomId)}">${t("Forget")}</button></div>`).join("") : `<p class="muted">${t("No rooms yet.")}</p>`}</div></div>`;
  $$("[data-fp]").forEach((x) => x.addEventListener("click", async () => { if (!armed(x)) return; await api(`/bots/${b.id}/memory/people/${x.dataset.fp}`, { method: "DELETE" }); toast(t("Forgotten")); tabMemory(b); }));
  $$("[data-fr]").forEach((x) => x.addEventListener("click", async () => { if (!armed(x)) return; await api(`/bots/${b.id}/memory/rooms/${x.dataset.fr}`, { method: "DELETE" }); toast(t("Forgotten")); tabMemory(b); }));
}

// Playground tab
function tabPlayground(b) {
  $("#tab").innerHTML = `
    <div class="card chat">
      <div id="pg-log" class="chat-log"><div class="msg meta">${t("Chat with {name} using its current settings. This makes real Flatkey calls.", { name: esc(b.persona.name) })}</div>
        ${b.persona.greeting ? `<div class="msg bot">${esc(b.persona.greeting)}</div>` : ""}</div>
      <form id="pg-form" class="chat-input">
        <label class="btn ghost small attach" title="${esc(t("Attach image"))}">📎<input type="file" id="pg-file" accept="image/*" hidden /></label>
        <input id="pg-text" placeholder="${esc(t("Message {name}…", { name: b.persona.name }))}" autocomplete="off" />
        <button class="btn primary" type="submit">${t("Send")}</button>
      </form>
      <p id="pg-attached" class="muted small"></p>
    </div>`;
  let img = null;
  $("#pg-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { img = r.result; $("#pg-attached").textContent = t("📎 {file} attached", { file: f.name }); };
    r.readAsDataURL(f);
  });
  const add = (cls, html) => { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; $("#pg-log").appendChild(d); $("#pg-log").scrollTop = 1e9; return d; };
  $("#pg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#pg-text").value.trim();
    if (!text && !img) return;
    add("me", esc(text) + (img ? `<img src="${img}" alt="" />` : ""));
    const body = { text, image: img };
    $("#pg-text").value = ""; img = null; $("#pg-attached").textContent = ""; $("#pg-file").value = "";
    const wait = add("bot", "…");
    try {
      const { reply, ms } = await api(`/bots/${b.id}/test-chat`, { method: "POST", body });
      wait.innerHTML = reply ? esc(reply.text) : `<i class="muted">${t("(no reply: check “When to reply” in Persona)")}</i>`;
      const tags = [reply?.usedKnowledge?.length && `📚 ${reply.usedKnowledge.map((k) => k.title).join(", ")}`, reply?.usedSearch && "🔎 " + t("searched"), reply?.usedVision && "🖼️ " + t("read image"), `${(ms / 1000).toFixed(1)}s`].filter(Boolean);
      add("meta", esc(tags.join(" · ")));
    } catch (err) { wait.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
  });
}

// ── Flatkey key page ─────────────────────────────────────────────
function viewFlatkey() {
  const k = ov.flatkey;
  const from = k.source === "dashboard" ? t("bound in this dashboard") : t("from FLATKEY_API_KEY in .env");
  view().innerHTML = `
    <header class="page-head"><h2>${t("Flatkey API key")}</h2><p class="muted">${t("All your bots run on Flatkey. One key powers chat, image reading, web search and memory for every bot.")}</p></header>
    <div class="card key-status">${k.bound
      ? `<span class="big">✅</span><div><b>${t("Key bound. Your bots are awake.")}</b><br /><span class="muted small"><code>${esc(k.masked)}</code> · ${from}</span></div>${k.source === "dashboard" ? `<button class="btn danger small" id="unbind-key">${t("Unbind")}</button>` : ""}`
      : `<span class="big">😴</span><div><b>${t("No key bound yet.")}</b><br /><span class="muted small">${t("Your bots can't reply until there's a Flatkey API key. Follow the steps below.")}</span></div>`}</div>
    <div class="card"><ol class="steps">
      <li><div><b>${t("Create a key on Flatkey")}</b><p class="muted small">${t("Sign in or sign up, then create a new API key and copy it.")}</p></div>
        <a id="create-key-link" class="btn primary" href="${esc(k.keysUrl)}" target="_blank" rel="noopener">${t("Create a key on Flatkey ↗")}</a></li>
      <li><div><b>${t("Paste it here and bind")}</b><p class="muted small">${t("Mochi checks the key with Flatkey before saving it. It's stored only on your server and is never shown in full again.")}</p></div>
        <form id="key-form" class="key-form"><input id="key-input" type="password" placeholder="${esc(t("Paste your Flatkey API key"))}" autocomplete="off" spellcheck="false" /><button class="btn primary" type="submit">${t("Bind key")}</button></form>
        <p id="key-error" class="error small"></p></li>
      <li><div><b>${t("Pick your models")}</b><p class="muted small">${t("Once the key is bound, every model on your Flatkey account appears under each bot's <b>Models &amp; abilities</b>.")}</p></div></li>
    </ol></div>
    <div class="card why-mini"><b>${t("Why Flatkey?")}</b>
      <p>💸 ${t("Mainstream models like GPT, Claude, DeepSeek, Kimi and GLM are at least 20% below official pricing, and failed calls cost $0.")}</p>
      <p>⏱️ ${t("A chatbot needs several kinds of models. With Flatkey that's one key, one balance and one bill instead of an account per provider.")}</p>
      <p class="slogan">${t("Official models. Better prices.")}</p></div>`;
  $("#unbind-key")?.addEventListener("click", async (e) => {
    if (!armed(e.target)) return;
    ov.flatkey = await api("/flatkey", { method: "DELETE" });
    modelsLoaded = false; renderNav(); viewFlatkey();
    toast(ov.flatkey.bound ? t("Using the key from .env") : t("Key unbound"));
  });
  $("#key-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const apiKey = $("#key-input").value.trim();
    if (!apiKey) return;
    const btn = $("#key-form button");
    btn.disabled = true; btn.textContent = t("Checking…"); $("#key-error").textContent = "";
    try {
      const r = await api("/flatkey", { method: "PUT", body: { apiKey } });
      ov.flatkey = r; modelsLoaded = false; renderNav(); viewFlatkey();
      toast(t("Key bound ✨ {n} models available", { n: r.models }));
    } catch (err) {
      $("#key-error").textContent = err.message;
      btn.disabled = false; btn.textContent = t("Bind key");
    }
  });
}

// ── Usage page ───────────────────────────────────────────────────
const FEATURE_LABEL = () => ({ chat: "💬 " + t("chat"), vision: "🖼️ " + t("vision"), search: "🔎 " + t("search"), memory: "🧠 " + t("memory") });
async function viewUsage() {
  await refreshOverview();
  const [{ pricing }] = await Promise.all([api("/pricing"), ensureModels()]);
  view().innerHTML = `
    <header class="page-head"><h2>${t("Usage &amp; cost")}</h2><p class="muted">${t("Token usage across your bots, by ability and model.")}</p>
      <div class="filters"><select id="u-bot"><option value="">${t("All bots")}</option>${ov.bots.map((b) => `<option value="${b.id}">${esc(b.persona.avatar)} ${esc(b.persona.name)}</option>`).join("")}</select>
      <select id="u-days"><option value="1">${t("Today")}</option><option value="7" selected>${t("7 days")}</option><option value="30">${t("30 days")}</option></select></div></header>
    <div class="card"><h3>${t("Tokens per day")}</h3><div id="u-chart" class="bars"></div></div>
    <div class="card"><table class="table"><thead><tr><th>${t("Bot")}</th><th>${t("Ability")}</th><th>${t("Model")}</th><th>${t("Calls")}</th><th>${t("Input")}</th><th>${t("Output")}</th><th>${t("Est. cost")}</th></tr></thead><tbody id="u-rows"></tbody></table></div>
    <div class="card">
      <h3>${t("Pricing table")} <span class="muted small">${t("(optional, for cost estimates)")}</span></h3>
      <p class="muted small">${t("$ per 1M tokens. Copy these from your Flatkey console pricing page.")}</p>
      <table class="table" id="pricing-table"><thead><tr><th>${t("Model")}</th><th>${t("Input $/1M")}</th><th>${t("Output $/1M")}</th><th></th></tr></thead><tbody></tbody></table>
      <div class="actions"><button class="btn ghost" id="add-price">${t("+ Add model")}</button><button class="btn primary" id="save-pricing">${t("Save pricing")}</button></div>
    </div>`;
  const renderPricing = (p) => {
    const rows = Object.entries(p);
    $("#pricing-table tbody").innerHTML = (rows.length ? rows : [["", { inputPerM: "", outputPerM: "" }]]).map(([m, v]) => `
      <tr><td><input list="model-list" class="pr-model" value="${esc(m)}" placeholder="${esc(t("model id"))}" /></td>
      <td><input type="number" step="0.001" min="0" class="pr-in" value="${v.inputPerM}" /></td>
      <td><input type="number" step="0.001" min="0" class="pr-out" value="${v.outputPerM}" /></td>
      <td><button class="btn danger small pr-del" type="button">✕</button></td></tr>`).join("");
    $$(".pr-del").forEach((x) => x.addEventListener("click", () => x.closest("tr").remove()));
  };
  const collect = () => {
    const out = {};
    $$("#pricing-table tbody tr").forEach((tr) => { const m = $(".pr-model", tr).value.trim(); if (m) out[m] = { inputPerM: +$(".pr-in", tr).value || 0, outputPerM: +$(".pr-out", tr).value || 0 }; });
    return out;
  };
  renderPricing(pricing);
  $("#add-price").addEventListener("click", () => { const p = collect(); p[""] = { inputPerM: "", outputPerM: "" }; renderPricing(p); });
  $("#save-pricing").addEventListener("click", async () => { await api("/pricing", { method: "PUT", body: { pricing: collect() } }); toast(t("Pricing saved")); load(); });

  const names = Object.fromEntries(ov.bots.map((b) => [b.id, `${b.persona.avatar} ${b.persona.name}`]));
  const labels = FEATURE_LABEL();
  const load = async () => {
    const q = new URLSearchParams({ days: $("#u-days").value, ...($("#u-bot").value ? { bot: $("#u-bot").value } : {}) });
    const { rows, byDay } = await api("/usage?" + q);
    const max = Math.max(1, ...byDay.map((d) => d.tokens));
    $("#u-chart").innerHTML = byDay.length
      ? byDay.map((d) => `<div class="bar" style="height:${(d.tokens / max) * 100}%" data-v="${esc(t("{n} tokens", { n: fmt(d.tokens) }))}"><span>${d.day.slice(5)}</span></div>`).join("")
      : `<p class="muted">${t("No usage yet. Say hi in a bot's Playground!")}</p>`;
    $("#u-rows").innerHTML = rows.length
      ? rows.map((r) => `<tr><td>${esc(names[r.botId] || r.botId)}</td><td>${labels[r.feature] || esc(r.feature)}</td><td>${esc(r.model)}</td><td>${fmt(r.calls)}</td><td>${fmt(r.promptTokens)}</td><td>${fmt(r.completionTokens)}</td><td>${money(r.estCost)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="muted">${t("No usage yet.")}</td></tr>`;
  };
  $("#u-days").addEventListener("change", load);
  $("#u-bot").addEventListener("change", load);
  load();
}

// ── start ────────────────────────────────────────────────────────
setLang(lang);
if (token) boot().catch(() => showLogin()); else showLogin();
