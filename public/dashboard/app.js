// Mochi dashboard: vanilla JS, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n) => Number(n || 0).toLocaleString();
const money = (n) => (n == null ? "–" : "$" + n.toFixed(n < 1 ? 4 : 2));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : new Date(ts).toLocaleDateString(); };

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
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
  if (res.status === 401) { showLogin("Wrong token"); throw new Error("unauthorized"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
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
  btn.textContent = label || "Sure?";
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
    <select id="${id}-sel">${opts}<option value="__custom" ${known ? "" : "selected"}>✏️ Custom model ID…</option></select>
    <input id="${id}" value="${esc(value)}" placeholder="Type any model ID from flatkey.ai/models" class="${known ? "hidden" : ""}" spellcheck="false" />
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
  <span><b>Your bots are asleep: bind your Flatkey API key to wake them up.</b><br /><small>It takes about a minute. Create a key on Flatkey, paste it here, done.</small></span>
  <span class="btn primary small">Bind key →</span></a>`;

// ── Bots list ────────────────────────────────────────────────────
const PLATFORM = {
  discord: { icon: "🎮", name: "Discord" },
  telegram: { icon: "✈️", name: "Telegram" },
  slack: { icon: "💼", name: "Slack" },
  web: { icon: "🌐", name: "Website" },
};

async function viewBots() {
  await refreshOverview();
  const w = ov.whyFlatkey;
  view().innerHTML = `
    <header class="page-head"><h2>Your bots</h2><p class="muted">Each bot has its own persona, knowledge base, channels, memory and budget. All of them run on your one Flatkey key.</p></header>
    ${keyAlert()}
    <div class="bot-grid">
      ${ov.bots.map((b) => `
        <a class="bot-card" href="#bot/${b.id}/overview" style="--c:${b.persona.color}">
          <div class="bot-head"><span class="avatar">${esc(b.persona.avatar)}</span>
            <div><b>${esc(b.persona.name)}</b><span class="tag ${b.mode}">${b.mode === "qa" ? "Q&A" : "Companion"}</span></div></div>
          <p class="muted small desc">${esc(b.persona.description) || "<i>No description yet</i>"}</p>
          <div class="chan-row">${b.channels.map((c) => `<span class="chan ${c.running ? "on" : c.bound ? "idle" : ""}" title="${PLATFORM[c.platform].name}: ${c.running ? "live" : c.bound ? "connected, not running" : "not connected"}">${PLATFORM[c.platform].icon}</span>`).join("")}</div>
          <div class="bot-stats"><span>💬 ${fmt(b.tokensToday)} tokens today</span><span>🧠 ${fmt(b.people)} people</span><span>📚 ${fmt(b.knowledge.docs)} docs</span></div>
        </a>`).join("")}
      <button class="bot-card new" id="new-bot"><span class="plus">＋</span><b>New bot</b><span class="muted small">Companion, Q&A / support, study buddy or blank</span></button>
    </div>
    <div class="card why">
      <h3>Why your bots run on Flatkey</h3>
      <p class="slogan">${esc(w.slogan)}</p>
      <div class="why-grid">${w.points.map((p, i) => `<div><b>${["💸", "⏱️", "🔀"][i] || "✨"} ${esc(p.title)}</b><p>${esc(p.body)}</p></div>`).join("")}</div>
      <div class="actions left"><a class="btn primary" href="${esc(w.keysUrl)}" target="_blank" rel="noopener">Manage API keys</a><a class="btn ghost" href="${esc(w.homeUrl)}" target="_blank" rel="noopener">Explore models</a></div>
    </div>`;
  $("#new-bot").addEventListener("click", newBotModal);
}

function newBotModal() {
  modal(`
    <h3>Create a bot</h3>
    <p class="muted small">Pick a starting point. You can change everything afterwards.</p>
    <div class="preset-grid">${ov.presets.map((p, i) => `
      <label class="preset"><input type="radio" name="preset" value="${p.id}" ${i === 0 ? "checked" : ""} />
        <span class="preset-avatar">${esc(p.avatar || "🤖")}</span><b>${esc(p.label)}</b><span class="muted small">${esc(p.blurb)}</span></label>`).join("")}
    </div>
    <label>Name<input id="nb-name" placeholder="Leave empty to use the preset's name" maxlength="40" /></label>
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" id="nb-create">Create bot</button></div>`);
  $("#nb-create").addEventListener("click", async () => {
    const preset = $("input[name=preset]:checked").value;
    const { bot } = await api("/bots", { method: "POST", body: { preset, name: $("#nb-name").value.trim() || undefined } });
    closeModal();
    await refreshOverview();
    toast(`${bot.persona.avatar} ${bot.persona.name} created`);
    location.hash = `#bot/${bot.id}/persona`;
  });
}

// ── Single bot ───────────────────────────────────────────────────
const TABS = [
  ["overview", "Overview"], ["persona", "Persona"], ["knowledge", "Knowledge base"], ["channels", "Channels"],
  ["abilities", "Models & abilities"], ["memory", "Memory"], ["playground", "Playground"],
];
let cur = null; // { bot, summary, channels, widgetSnippet, personaPrompt }

async function viewBot(id, tab) {
  try { cur = await api("/bots/" + id); } catch { location.hash = "#bots"; return; }
  const b = cur.bot;
  view().innerHTML = `
    ${keyAlert()}
    <header class="bot-header" style="--c:${b.persona.color}">
      <span class="avatar big">${esc(b.persona.avatar)}</span>
      <div><h2>${esc(b.persona.name)} <span class="tag ${b.mode}">${b.mode === "qa" ? "Q&A" : "Companion"}</span></h2>
        <p class="muted small">${esc(b.persona.description) || "No description yet. Add one in Persona."}</p></div>
    </header>
    <nav class="tabs">${TABS.map(([k, label]) => `<a href="#bot/${b.id}/${k}" class="${k === tab ? "active" : ""}">${label}</a>`).join("")}</nav>
    <section id="tab"></section>`;
  const fn = { overview: tabOverview, persona: tabPersona, knowledge: tabKnowledge, channels: tabChannels, abilities: tabAbilities, memory: tabMemory, playground: tabPlayground }[tab] || tabOverview;
  fn(b);
}

async function saveBot(patch, msg = "Saved ✨") {
  const r = await api("/bots/" + cur.bot.id, { method: "PUT", body: patch });
  cur.bot = r.bot;
  cur.personaPrompt = r.personaPrompt;
  toast(msg);
  refreshOverview();
  return r.bot;
}

// Overview tab
function tabOverview(b) {
  const s = cur.summary;
  const chips = (on, label) => `<span class="chip ${on ? "on" : "off"}">${label}</span>`;
  $("#tab").innerHTML = `
    <div class="stats">
      <div class="stat"><span>Tokens today</span><b>${fmt(s.tokensToday)}</b><small>${b.limits.dailyTokenBudget ? `${Math.round((s.tokensToday / b.limits.dailyTokenBudget) * 100)}% of daily budget` : "no daily cap"}</small></div>
      <div class="stat"><span>People remembered</span><b>${fmt(s.people)}</b><small>across ${fmt(s.rooms)} chat room(s)</small></div>
      <div class="stat"><span>Knowledge base</span><b>${fmt(s.knowledge.docs)}</b><small>${b.knowledge.strict ? "answers only from docs" : "documents"}</small></div>
      <div class="stat"><span>Live channels</span><b>${s.channels.filter((c) => c.running).length}</b><small>of 4</small></div>
    </div>
    <div class="card"><h3>At a glance</h3><div class="chips">
      ${chips(b.features.memory, "🧠 memory")} ${chips(b.features.search && !b.knowledge.strict, "🔎 web search")} ${chips(b.features.vision, "🖼️ image reading")}
      ${chips(b.knowledge.enabled && s.knowledge.docs > 0, "📚 knowledge base")} <span class="chip">💬 ${esc(b.models.chat)}</span>
    </div></div>
    <div class="card"><h3>Channels</h3><div class="chips">
      ${cur.channels.map((c) => `<a class="chip ${c.running ? "on" : ""}" href="#bot/${b.id}/channels">${PLATFORM[c.platform].icon} ${PLATFORM[c.platform].name}: ${c.running ? "live" : c.bound ? "connected" : "not connected"}</a>`).join("")}
      <a class="chip ${b.channels.web.enabled ? "on" : ""}" href="#bot/${b.id}/channels">🌐 Website: ${b.channels.web.enabled ? "on" : "off"}</a>
    </div></div>
    <div class="card danger-zone"><h3>Danger zone</h3>
      <p class="muted small">Deleting a bot disconnects its channels and erases its memory and knowledge base.</p>
      <button class="btn danger" id="del-bot">Delete ${esc(b.persona.name)}</button></div>`;
  $("#del-bot").addEventListener("click", async (e) => {
    if (!armed(e.target, "Click again to delete")) return;
    try { await api("/bots/" + b.id, { method: "DELETE" }); toast("Bot deleted"); await refreshOverview(); location.hash = "#bots"; }
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
          <h3>Identity</h3>
          <div class="identity-row">
            <label>Avatar<input id="p-avatar" value="${esc(p.avatar)}" maxlength="4" class="emoji-input" /></label>
            <label>Color<input id="p-color" type="color" value="${esc(p.color)}" /></label>
            <label class="grow">Name<input id="p-name" value="${esc(p.name)}" maxlength="40" /></label>
          </div>
          <label>Description <small>Public one-liner. Shown in the website widget and synced to your Telegram and Discord bot profiles.</small>
            <textarea id="p-desc" rows="2" maxlength="300">${esc(p.description)}</textarea></label>
          <label>Greeting <small>The first message the website widget shows.</small><input id="p-greet" value="${esc(p.greeting)}" maxlength="300" /></label>
          <label>Type
            ${sel("p-mode", [["companion", "Companion: chats, remembers people, joins conversations"], ["qa", "Q&A / support: answers from your knowledge base"]], b.mode)}</label>
        </div>
        <div class="card">
          <h3>Personality</h3>
          <label>Personality <small>Who is this bot? Traits, humour, values.</small><textarea id="p-pers" rows="3" maxlength="1500">${esc(p.personality)}</textarea></label>
          <div class="grid3">
            <label>Tone${sel("p-tone", [["playful", "Playful"], ["friendly", "Friendly"], ["professional", "Professional"], ["sassy", "Sassy"], ["calm", "Calm"]], p.tone)}</label>
            <label>Emoji${sel("p-emoji", [["none", "None"], ["some", "Some"], ["lots", "Lots"]], p.emoji)}</label>
            <label>Reply length${sel("p-len", [["short", "Short"], ["medium", "Medium"], ["long", "Detailed"]], p.replyLength)}</label>
          </div>
          <label>Language <small>"auto" replies in the user's language, or type one, e.g. English, 中文, Português.</small><input id="p-lang" value="${esc(p.language)}" maxlength="40" /></label>
          <label>Backstory <small>Optional.</small><textarea id="p-back" rows="2" maxlength="2000">${esc(p.backstory)}</textarea></label>
          <label>Rules <small>One per line: do's and don'ts, topics to avoid, when to hand off to a human.</small><textarea id="p-rules" rows="4" maxlength="3000">${esc(p.rules)}</textarea></label>
          <details ${p.customPrompt ? "open" : ""}><summary>Advanced: write the whole prompt yourself</summary>
            <label>Custom prompt <small>If filled in, this replaces everything generated from the fields above.</small><textarea id="p-custom" rows="6" maxlength="8000">${esc(p.customPrompt)}</textarea></label>
          </details>
        </div>
        <div class="card">
          <h3>When to reply</h3>
          <label>Nicknames <small>Comma-separated. Saying one in a group chat gets a reply.</small><input id="p-nick" value="${esc(p.nicknames.join(", "))}" /></label>
          <div class="toggle-row"><b>Direct messages</b><label class="switch"><input type="checkbox" id="t-dm" ${b.triggers.replyInDirectMessages ? "checked" : ""} /><span></span></label></div>
          <div class="toggle-row"><b>When @mentioned or replied to</b><label class="switch"><input type="checkbox" id="t-mention" ${b.triggers.replyWhenMentioned ? "checked" : ""} /><span></span></label></div>
          <div class="toggle-row"><b>When its name or a nickname is said</b><label class="switch"><input type="checkbox" id="t-name" ${b.triggers.replyWhenNameSaid ? "checked" : ""} /><span></span></label></div>
          <label>Random chime-in chance in groups: <b id="t-rand-val">${Math.round(b.triggers.randomReplyChance * 100)}%</b><input type="range" id="t-rand" min="0" max="0.3" step="0.01" value="${b.triggers.randomReplyChance}" /></label>
        </div>
        <div class="sticky-save"><button class="btn primary" id="save-persona">Save persona</button></div>
      </div>
      <aside class="persona-preview">
        <div class="card">
          <h3>Widget preview</h3>
          <div class="wprev" id="wprev"></div>
        </div>
        <div class="card">
          <h3>What the bot is told</h3>
          <p class="muted small">Generated from your fields. Memory, knowledge and channel context are added for each message.</p>
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
      <div class="wprev-head" style="background:${esc(d.color)}">${esc(d.avatar)} <div><b>${esc(d.name || "Bot")}</b><small>${esc(d.description || "usually replies in a few seconds")}</small></div></div>
      <div class="wprev-body"><div class="wprev-msg">${esc(d.greeting || "Hi! How can I help?")}</div></div>`;
  };
  let t;
  const preview = () => {
    renderWidgetPreview();
    clearTimeout(t);
    t = setTimeout(async () => {
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
      await saveBot(patch, patch.mode !== b.mode ? (patch.mode === "qa" ? "Saved. Q&A mode: answers only from the knowledge base" : "Saved. Companion mode") : "Persona saved ✨");
      viewBot(b.id, "persona");
    } catch (err) { toast(err.message); }
  });
}

// Knowledge tab
async function tabKnowledge(b) {
  const { docs } = await api(`/bots/${b.id}/knowledge`);
  const k = b.knowledge;
  $("#tab").innerHTML = `
    <div class="card">
      <div class="toggle-row"><div><b>📚 Use the knowledge base</b><p class="muted small">The bot looks up your documents for every question and answers from them.</p></div>
        <label class="switch"><input type="checkbox" id="k-on" ${k.enabled ? "checked" : ""} /><span></span></label></div>
      <div class="toggle-row"><div><b>🎯 Only answer from the knowledge base</b><p class="muted small">For Q&A and support bots. If the answer isn't in your documents, the bot replies with the fallback message instead of guessing. Web search is turned off in this mode.</p></div>
        <label class="switch"><input type="checkbox" id="k-strict" ${k.strict ? "checked" : ""} /><span></span></label></div>
      <label>Fallback message<input id="k-fallback" value="${esc(k.fallbackMessage)}" maxlength="500" /></label>
      <label class="inline">Passages per answer <input type="number" id="k-max" min="1" max="10" value="${k.maxChunks}" style="width:80px" /></label>
      <div class="actions"><button class="btn primary" id="k-save">Save</button></div>
    </div>

    <div class="card">
      <h3>Add knowledge</h3>
      <div class="subtabs"><button class="active" data-kt="file">📄 Upload files</button><button data-kt="text">✍️ Paste text</button><button data-kt="url">🔗 Import a web page</button></div>
      <div data-kp="file">
        <label class="dropzone" id="dropzone"><input type="file" id="k-files" multiple accept="${ov.supportedFileTypes.join(",")}" hidden />
          <b>Drop files here or click to choose</b><span class="muted small">${ov.supportedFileTypes.join(" ")} · up to 15 MB each</span></label>
        <div id="upload-log" class="muted small"></div>
      </div>
      <div data-kp="text" class="hidden">
        <label>Title<input id="k-title" placeholder="e.g. Refund policy" maxlength="200" /></label>
        <label>Content<textarea id="k-text" rows="8" placeholder="Paste FAQs, policies, product details…"></textarea></label>
        <div class="actions"><button class="btn primary" id="k-add-text">Add to knowledge base</button></div>
      </div>
      <div data-kp="url" class="hidden">
        <label>Page URL<input id="k-url" placeholder="https://yourdomain.com/faq" /></label>
        <div class="actions"><button class="btn primary" id="k-add-url">Import page</button></div>
      </div>
    </div>

    <div class="card">
      <h3>Documents <span class="muted small">(${docs.length})</span></h3>
      ${docs.length ? `<table class="table"><thead><tr><th>Title</th><th>Source</th><th>Size</th><th>Added</th><th></th></tr></thead><tbody>
        ${docs.map((d) => `<tr><td><b>${esc(d.title)}</b></td><td>${{ file: "📄", text: "✍️", url: "🔗" }[d.source]} ${d.source === "url" ? `<a href="${esc(d.sourceRef)}" target="_blank" rel="noopener">${esc(new URL(d.sourceRef).hostname)}</a>` : esc(d.sourceRef || "pasted")}</td>
          <td>${fmt(d.chars)} chars · ${d.chunks} passages</td><td>${ago(d.createdAt)}</td>
          <td class="row-actions"><button class="btn ghost small" data-view="${d.id}">View</button><button class="btn danger small" data-del="${d.id}">Delete</button></td></tr>`).join("")}
        </tbody></table>` : `<p class="muted">No documents yet. Add FAQs, docs or policies above and your bot can answer questions about them.</p>`}
    </div>

    <div class="card">
      <h3>Test retrieval</h3>
      <p class="muted small">See which passages the bot would read for a question. This doesn't call any model, so it costs nothing.</p>
      <form id="k-test" class="key-form"><input id="k-q" placeholder="e.g. how do I get a refund?" /><button class="btn primary">Search</button></form>
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
        line.textContent = `✅ ${f.name}: ${fmt(doc.chars)} chars, ${doc.chunks} passages`;
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
    try { await api(`/bots/${b.id}/knowledge/text`, { method: "POST", body: { title: $("#k-title").value, text: $("#k-text").value } }); toast("Added to knowledge base"); reload(); }
    catch (err) { toast(err.message); }
  });
  $("#k-add-url").addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Importing…";
    try { const { doc } = await api(`/bots/${b.id}/knowledge/url`, { method: "POST", body: { url: $("#k-url").value.trim() } }); toast(`Imported "${doc.title}"`); reload(); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Import page"; }
  });
  $$("[data-del]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!armed(btn)) return;
    await api(`/bots/${b.id}/knowledge/${btn.dataset.del}`, { method: "DELETE" }); toast("Document deleted"); reload();
  }));
  $$("[data-view]").forEach((btn) => btn.addEventListener("click", async () => {
    const { doc, text } = await api(`/bots/${b.id}/knowledge/${btn.dataset.view}`);
    modal(`<h3>${esc(doc.title)}</h3><p class="muted small">${fmt(doc.chars)} chars · ${doc.chunks} passages</p><pre class="doc-preview">${esc(text)}</pre><div class="actions"><button class="btn primary" onclick="closeModal()">Close</button></div>`);
  }));
  $("#k-test").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { hits } = await api(`/bots/${b.id}/knowledge/test`, { method: "POST", body: { question: $("#k-q").value } });
    $("#k-hits").innerHTML = hits.length
      ? hits.map((h, i) => `<div class="hit"><b>${i + 1}. ${esc(h.title)}</b><p>${esc(h.text.slice(0, 400))}${h.text.length > 400 ? "…" : ""}</p></div>`).join("")
      : `<p class="muted">No matching passages. Try other keywords, or add a document that covers this.</p>`;
  });
}

// Channels tab
const CHANNEL_HELP = {
  discord: {
    fields: [["token", "Bot token", "From Discord → your app → Bot → Reset Token"]],
    steps: [
      'Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">discord.com/developers/applications</a> → <b>New Application</b>.',
      "Open <b>Bot</b> → <b>Reset Token</b> → copy the token.",
      "On the same page, turn on <b>Message Content Intent</b> (the bot needs it to read group chats).",
      "Paste the token below and connect. You'll get an invite link to add the bot to your server.",
    ],
  },
  telegram: {
    fields: [["token", "Bot token", "Looks like 123456789:AA…"]],
    steps: [
      'Open <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> in Telegram and send <code>/newbot</code>.',
      "Pick a name and username, then copy the token BotFather sends you.",
      "For group memory: BotFather → your bot → <b>Bot Settings → Group Privacy → Turn off</b>.",
      "Paste the token below and connect.",
    ],
  },
  slack: {
    fields: [["botToken", "Bot token (xoxb-…)", "OAuth & Permissions → Bot User OAuth Token"], ["appToken", "App-level token (xapp-…)", "Basic Information → App-Level Tokens (scope connections:write)"]],
    steps: [
      'Create an app at <a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> → <b>From scratch</b>.',
      "<b>Socket Mode</b> → enable, and create an app-level token with <code>connections:write</code>.",
      "<b>OAuth & Permissions</b> → bot scopes: <code>app_mentions:read channels:history channels:read groups:history im:history chat:write users:read files:read</code>.",
      "<b>Event Subscriptions</b> → enable → bot events: <code>message.channels message.groups message.im</code>.",
      "<b>Install to Workspace</b>, copy the bot token, then paste both tokens below. Invite the bot with <code>/invite @YourBot</code>.",
    ],
  },
};

function tabChannels(b) {
  const card = (c) => {
    const h = CHANNEL_HELP[c.platform];
    const P = PLATFORM[c.platform];
    const status = c.running ? `<span class="dot ok"></span>Live${c.identity ? ` as <b>${esc(c.identity.account)}</b>` : c.detail ? ` · ${esc(c.detail)}` : ""}`
      : c.bound ? `<span class="dot"></span>${esc(c.detail)}` : `<span class="dot bad"></span>Not connected`;
    const link = c.identity?.link ? `<a class="btn ghost small" href="${esc(c.identity.link)}" target="_blank" rel="noopener">${c.platform === "discord" ? "Invite to a server ↗" : c.platform === "telegram" ? "Open in Telegram ↗" : "Open workspace ↗"}</a>` : "";
    return `
      <div class="card channel" data-platform="${c.platform}">
        <div class="row"><b class="ch-title">${P.icon} ${P.name}</b>
          ${c.bound ? `<label class="switch" title="Pause / resume"><input type="checkbox" data-toggle="${c.platform}" ${c.enabled ? "checked" : ""} /><span></span></label>` : ""}</div>
        <div class="muted small">${status} ${c.source === "env" ? "· from .env" : ""}</div>
        ${link}
        <details ${c.bound ? "" : "open"}><summary>${c.bound ? "Replace token" : "How to connect"}</summary>
          <ol class="howto">${h.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
          <form class="bind-form" data-bind="${c.platform}">
            ${h.fields.map(([k, label, hint]) => `<label>${label}<small>${hint}</small><input name="${k}" type="password" autocomplete="off" spellcheck="false" required /></label>`).join("")}
            <div class="actions"><button class="btn primary">Connect ${P.name}</button></div>
            <p class="error small" data-err></p>
          </form>
        </details>
        ${c.bound && c.source === "dashboard" ? `<div class="actions"><button class="btn danger small" data-unbind="${c.platform}">Disconnect</button></div>` : ""}
      </div>`;
  };
  $("#tab").innerHTML = `
    <p class="muted">Connect this bot to the places your people chat. Tokens are verified with each platform before saving and are stored only on your server.</p>
    <div class="channel-grid">
      ${cur.channels.map(card).join("")}
      <div class="card channel">
        <div class="row"><b class="ch-title">🌐 Website widget</b><label class="switch"><input type="checkbox" id="w-on" ${b.channels.web.enabled ? "checked" : ""} /><span></span></label></div>
        <div class="muted small"><span class="dot ${b.channels.web.enabled ? "ok" : ""}"></span>${b.channels.web.enabled ? "On" : "Off"} · built in, no token needed</div>
        <p class="muted small">Paste this before <code>&lt;/body&gt;</code> on your site:</p>
        <pre class="snippet">${esc(cur.widgetSnippet)}</pre>
        <div class="actions left"><button class="btn ghost small" id="copy-snippet">Copy snippet</button><a class="btn ghost small" href="/widget/demo.html?bot=${b.id}" target="_blank" rel="noopener">Try it ↗</a></div>
        <label>Allowed sites <small>Comma-separated origins, e.g. https://example.com. Use * for any site.</small><input id="w-origins" value="${esc(b.channels.web.allowedOrigins.join(", "))}" /></label>
        <div class="actions"><button class="btn primary small" id="w-save">Save</button></div>
      </div>
    </div>`;

  $$("[data-bind]").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = form.dataset.bind;
    const body = Object.fromEntries(new FormData(form).entries());
    const btn = $("button", form);
    btn.disabled = true; btn.textContent = "Verifying…"; $("[data-err]", form).textContent = "";
    try {
      const { channel } = await api(`/bots/${b.id}/channels/${p}`, { method: "PUT", body });
      toast(`${PLATFORM[p].name} connected${channel.identity ? ` as ${channel.identity.account}` : ""} ✨`);
      setTimeout(() => viewBot(b.id, "channels"), 1500);
    } catch (err) {
      $("[data-err]", form).textContent = err.message;
      btn.disabled = false; btn.textContent = `Connect ${PLATFORM[p].name}`;
    }
  }));
  $$("[data-unbind]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!armed(btn)) return;
    await api(`/bots/${b.id}/channels/${btn.dataset.unbind}`, { method: "DELETE" });
    toast("Disconnected"); viewBot(b.id, "channels");
  }));
  $$("[data-toggle]").forEach((el) => el.addEventListener("change", async () => {
    await saveBot({ channels: { [el.dataset.toggle]: { enabled: el.checked } } }, `${PLATFORM[el.dataset.toggle].name} ${el.checked ? "resumed" : "paused"}`);
    setTimeout(() => viewBot(b.id, "channels"), 1500);
  }));
  $("#w-on").addEventListener("change", (e) => saveBot({ channels: { web: { enabled: e.target.checked } } }, `Website widget ${e.target.checked ? "on" : "off"}`));
  $("#w-save").addEventListener("click", () => saveBot({ channels: { web: { allowedOrigins: $("#w-origins").value.split(",").map((x) => x.trim()).filter(Boolean) } } }));
  $("#copy-snippet").addEventListener("click", async () => { try { await navigator.clipboard.writeText(cur.widgetSnippet); toast("Copied"); } catch { toast("Select the snippet and copy it"); } });
}

// Models & abilities tab
async function tabAbilities(b) {
  await ensureModels();
  const n = (id, v, min, max) => `<input type="number" id="${id}" value="${v}" min="${min}" ${max ? `max="${max}"` : ""} />`;
  $("#tab").innerHTML = `
    <div class="card">
      <h3>Models</h3>
      <p class="muted small">Every ability runs through your Flatkey key, so any model in the Flatkey catalog works for any job. Use a strong model for chat and a small one for background memory.</p>
      <div class="grid2">
        <label>Chat model<small>Main conversation</small>${modelPicker("m-chat", b.models.chat)}</label>
        <label>Vision model<small>Used when a message has images. Must accept image input.</small>${modelPicker("m-vision", b.models.vision)}</label>
        <label>Memory model<small>Background summaries and people profiles. A small model is fine.</small>${modelPicker("m-memory", b.models.memory)}</label>
        <label>Search model<small>Web search runs on the model's built-in search tool (Claude or GPT).</small>${modelPicker("m-search", b.models.search)}</label>
      </div>
      <p class="muted small">${MODELS.length ? `${MODELS.length} models available on your Flatkey key, the same list as <a href="https://flatkey.ai/models?utm_source=mochi_bot&utm_medium=dashboard&utm_campaign=mochi&utm_content=model_picker" target="_blank" rel="noopener">flatkey.ai/models</a>. Pick one, or choose “Custom model ID…” to type any ID.` : ov.flatkey.bound ? "Couldn't load the model list right now. Type a model ID instead." : `Bind your <a href="#flatkey">Flatkey API key</a> to load the model list. Until then, type a model ID.`}</p>
    </div>
    <div class="card">
      <h3>Abilities &amp; cost control</h3>
      <div class="toggle-row"><div><b>🧠 Memory</b><p class="muted small">Remembers people (personality, facts, interests) and what each room talks about. Costs one memory-model call every <b>${b.limits.memoryUpdateEvery}</b> messages per room.</p></div><label class="switch"><input type="checkbox" id="f-memory" ${b.features.memory ? "checked" : ""} /><span></span></label></div>
      <div class="toggle-row"><div><b>🔎 Web search</b><p class="muted small">Looks up facts it isn't sure about. Each search is one extra search-model call. ${b.knowledge.strict ? "<b>Off while “only answer from the knowledge base” is on.</b>" : ""}</p></div><label class="switch"><input type="checkbox" id="f-search" ${b.features.search ? "checked" : ""} /><span></span></label></div>
      <div class="toggle-row"><div><b>🖼️ Image reading</b><p class="muted small">Reads images people send, using the vision model. Image input uses more tokens than text.</p></div><label class="switch"><input type="checkbox" id="f-vision" ${b.features.vision ? "checked" : ""} /><span></span></label></div>
    </div>
    <div class="card">
      <h3>Limits</h3>
      <div class="grid3">
        <label>Daily token budget<small>0 = no cap. The bot goes quiet once it's reached.</small>${n("l-budget", b.limits.dailyTokenBudget, 0)}</label>
        <label>Max reply tokens${n("l-reply", b.limits.maxReplyTokens, 50)}</label>
        <label>Chat history (messages)<small>More history = more tokens per reply</small>${n("l-history", b.limits.historyMessages, 2)}</label>
        <label>Memory update every N messages${n("l-every", b.limits.memoryUpdateEvery, 3)}</label>
        <label>Max web searches per reply${n("l-searches", b.search.maxSearchesPerReply, 1, 5)}</label>
        <label>Max images per message${n("l-images", b.limits.maxImagesPerMessage, 1, 6)}</label>
      </div>
      <label class="inline">Search protocol
        <select id="s-mode"><option value="messages" ${b.search.mode === "messages" ? "selected" : ""}>Anthropic web_search (/v1/messages)</option><option value="responses" ${b.search.mode === "responses" ? "selected" : ""}>OpenAI web_search (/v1/responses)</option></select></label>
    </div>
    <div class="sticky-save"><button class="btn primary" id="save-abilities">Save</button></div>`;
  wirePickers($("#tab"));
  for (const k of ["memory", "search", "vision"]) $("#f-" + k).addEventListener("change", (e) => saveBot({ features: { [k]: e.target.checked } }, `${k} ${e.target.checked ? "on" : "off"}`));
  $("#save-abilities").addEventListener("click", () => saveBot({
    models: Object.fromEntries(["chat", "vision", "memory", "search"].map((k) => [k, ($("#m-" + k + "-sel").value === "__custom" ? $("#m-" + k).value : $("#m-" + k + "-sel").value).trim()]).filter(([, v]) => v)),
    limits: { dailyTokenBudget: +$("#l-budget").value, maxReplyTokens: +$("#l-reply").value, historyMessages: +$("#l-history").value, memoryUpdateEvery: +$("#l-every").value, maxImagesPerMessage: +$("#l-images").value },
    search: { mode: $("#s-mode").value, maxSearchesPerReply: +$("#l-searches").value },
  }).then(() => viewBot(b.id, "abilities")).catch((err) => toast(err.message)));
}

// Memory tab
async function tabMemory(b) {
  const { people, rooms } = await api(`/bots/${b.id}/memory`);
  $("#tab").innerHTML = `
    <p class="muted">What ${esc(b.persona.name)} remembers. People can also say "forget me" to the bot.</p>
    <div class="card"><h3>People</h3><div class="mem-list">${people.length ? people.map((p) => `
      <div class="mem"><div><b>${esc(p.displayName)}</b><span class="tag">${p.platform}</span><span class="muted small"> · ${fmt(p.messageCount)} msgs · last seen ${ago(p.lastSeen)}</span>
        ${p.personality ? `<p>🎭 ${esc(p.personality)}</p>` : ""}${p.facts.length ? `<p>📌 ${p.facts.map(esc).join(" · ")}</p>` : ""}${p.interests.length ? `<p>💖 ${p.interests.map(esc).join(", ")}</p>` : ""}
        ${!p.personality && !p.facts.length ? `<p class="muted">No profile yet. It builds up as they chat.</p>` : ""}</div>
        <button class="btn danger small" data-fp="${p.platform}/${encodeURIComponent(p.userId)}">Forget</button></div>`).join("") : `<p class="muted">Nobody yet.</p>`}</div></div>
    <div class="card"><h3>Rooms</h3><div class="mem-list">${rooms.length ? rooms.map((r) => `
      <div class="mem"><div><b>${esc(r.title || r.roomId)}</b><span class="tag">${r.platform}</span>
        ${r.summary ? `<p>${esc(r.summary)}</p>` : `<p class="muted">No summary yet (${r.msgsSinceUpdate} new msgs).</p>`}${r.recentTopics.length ? `<p>🗂️ ${r.recentTopics.map(esc).join(" · ")}</p>` : ""}</div>
        <button class="btn danger small" data-fr="${r.platform}/${encodeURIComponent(r.roomId)}">Forget</button></div>`).join("") : `<p class="muted">No rooms yet.</p>`}</div></div>`;
  $$("[data-fp]").forEach((x) => x.addEventListener("click", async () => { if (!armed(x)) return; await api(`/bots/${b.id}/memory/people/${x.dataset.fp}`, { method: "DELETE" }); toast("Forgotten"); tabMemory(b); }));
  $$("[data-fr]").forEach((x) => x.addEventListener("click", async () => { if (!armed(x)) return; await api(`/bots/${b.id}/memory/rooms/${x.dataset.fr}`, { method: "DELETE" }); toast("Forgotten"); tabMemory(b); }));
}

// Playground tab
function tabPlayground(b) {
  $("#tab").innerHTML = `
    <div class="card chat">
      <div id="pg-log" class="chat-log"><div class="msg meta">Chat with ${esc(b.persona.name)} using its current settings. This makes real Flatkey calls.</div>
        ${b.persona.greeting ? `<div class="msg bot">${esc(b.persona.greeting)}</div>` : ""}</div>
      <form id="pg-form" class="chat-input">
        <label class="btn ghost small attach" title="Attach image">📎<input type="file" id="pg-file" accept="image/*" hidden /></label>
        <input id="pg-text" placeholder="Message ${esc(b.persona.name)}…" autocomplete="off" />
        <button class="btn primary" type="submit">Send</button>
      </form>
      <p id="pg-attached" class="muted small"></p>
    </div>`;
  let img = null;
  $("#pg-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { img = r.result; $("#pg-attached").textContent = "📎 " + f.name + " attached"; };
    r.readAsDataURL(f);
  });
  const add = (cls, html) => { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; $("#pg-log").appendChild(d); $("#pg-log").scrollTop = 1e9; return d; };
  $("#pg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#pg-text").value.trim();
    if (!text && !img) return;
    add("me", esc(text) + (img ? `<img src="${img}" alt="attached image" />` : ""));
    const body = { text, image: img };
    $("#pg-text").value = ""; img = null; $("#pg-attached").textContent = ""; $("#pg-file").value = "";
    const wait = add("bot", "…");
    try {
      const { reply, ms } = await api(`/bots/${b.id}/test-chat`, { method: "POST", body });
      wait.innerHTML = reply ? esc(reply.text) : `<i class="muted">(no reply: check "When to reply" in Persona)</i>`;
      const tags = [reply?.usedKnowledge?.length && `📚 ${reply.usedKnowledge.map((k) => k.title).join(", ")}`, reply?.usedSearch && "🔎 searched", reply?.usedVision && "🖼️ read image", `${(ms / 1000).toFixed(1)}s`].filter(Boolean);
      add("meta", esc(tags.join(" · ")));
    } catch (err) { wait.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
  });
}

// ── Flatkey key page ─────────────────────────────────────────────
function viewFlatkey() {
  const k = ov.flatkey;
  const from = k.source === "dashboard" ? "bound in this dashboard" : "from FLATKEY_API_KEY in .env";
  view().innerHTML = `
    <header class="page-head"><h2>Flatkey API key</h2><p class="muted">All your bots run on Flatkey. One key powers chat, image reading, web search and memory for every bot.</p></header>
    <div class="card key-status">${k.bound
      ? `<span class="big">✅</span><div><b>Key bound. Your bots are awake.</b><br /><span class="muted small"><code>${esc(k.masked)}</code> · ${from}</span></div>${k.source === "dashboard" ? `<button class="btn danger small" id="unbind-key">Unbind</button>` : ""}`
      : `<span class="big">😴</span><div><b>No key bound yet.</b><br /><span class="muted small">Your bots can't reply until there's a Flatkey API key. Follow the steps below.</span></div>`}</div>
    <div class="card"><ol class="steps">
      <li><div><b>Create a key on Flatkey</b><p class="muted small">Sign in or sign up, then create a new API key and copy it.</p></div>
        <a id="create-key-link" class="btn primary" href="${esc(k.keysUrl)}" target="_blank" rel="noopener">Create a key on Flatkey ↗</a></li>
      <li><div><b>Paste it here and bind</b><p class="muted small">Mochi checks the key with Flatkey before saving it. It's stored only on your server and is never shown in full again.</p></div>
        <form id="key-form" class="key-form"><input id="key-input" type="password" placeholder="Paste your Flatkey API key" autocomplete="off" spellcheck="false" /><button class="btn primary" type="submit">Bind key</button></form>
        <p id="key-error" class="error small"></p></li>
      <li><div><b>Pick your models</b><p class="muted small">Once the key is bound, every model on your Flatkey account appears under each bot's <b>Models &amp; abilities</b>.</p></div></li>
    </ol></div>
    <div class="card why-mini"><b>Why Flatkey?</b>
      <p>💸 Mainstream models like GPT, Claude, DeepSeek, Kimi and GLM are at least 20% below official pricing, and failed calls cost $0.</p>
      <p>⏱️ A chatbot needs several kinds of models. With Flatkey that's one key, one balance and one bill instead of an account per provider.</p>
      <p class="slogan">Official models. Better prices.</p></div>`;
  $("#unbind-key")?.addEventListener("click", async (e) => {
    if (!armed(e.target)) return;
    ov.flatkey = await api("/flatkey", { method: "DELETE" });
    modelsLoaded = false; renderNav(); viewFlatkey();
    toast(ov.flatkey.bound ? "Using the key from .env" : "Key unbound");
  });
  $("#key-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const apiKey = $("#key-input").value.trim();
    if (!apiKey) return;
    const btn = $("#key-form button");
    btn.disabled = true; btn.textContent = "Checking…"; $("#key-error").textContent = "";
    try {
      const r = await api("/flatkey", { method: "PUT", body: { apiKey } });
      ov.flatkey = r; modelsLoaded = false; renderNav(); viewFlatkey();
      toast(`Key bound ✨ ${r.models} models available`);
    } catch (err) {
      $("#key-error").textContent = err.message;
      btn.disabled = false; btn.textContent = "Bind key";
    }
  });
}

// ── Usage page ───────────────────────────────────────────────────
const FEATURE_LABEL = { chat: "💬 chat", vision: "🖼️ vision", search: "🔎 search", memory: "🧠 memory" };
async function viewUsage() {
  await refreshOverview();
  const [{ pricing }] = await Promise.all([api("/pricing"), ensureModels()]);
  view().innerHTML = `
    <header class="page-head"><h2>Usage &amp; cost</h2><p class="muted">Token usage across your bots, by ability and model.</p>
      <div class="filters"><select id="u-bot"><option value="">All bots</option>${ov.bots.map((b) => `<option value="${b.id}">${esc(b.persona.avatar)} ${esc(b.persona.name)}</option>`).join("")}</select>
      <select id="u-days"><option value="1">Today</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></div></header>
    <div class="card"><h3>Tokens per day</h3><div id="u-chart" class="bars"></div></div>
    <div class="card"><table class="table"><thead><tr><th>Bot</th><th>Ability</th><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Est. cost</th></tr></thead><tbody id="u-rows"></tbody></table></div>
    <div class="card">
      <h3>Pricing table <span class="muted small">(optional, for cost estimates)</span></h3>
      <p class="muted small">$ per 1M tokens. Copy these from your Flatkey console pricing page.</p>
      <table class="table" id="pricing-table"><thead><tr><th>Model</th><th>Input $/1M</th><th>Output $/1M</th><th></th></tr></thead><tbody></tbody></table>
      <div class="actions"><button class="btn ghost" id="add-price">+ Add model</button><button class="btn primary" id="save-pricing">Save pricing</button></div>
    </div>`;
  const renderPricing = (p) => {
    const rows = Object.entries(p);
    $("#pricing-table tbody").innerHTML = (rows.length ? rows : [["", { inputPerM: "", outputPerM: "" }]]).map(([m, v]) => `
      <tr><td><input list="model-list" class="pr-model" value="${esc(m)}" placeholder="model id" /></td>
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
  $("#save-pricing").addEventListener("click", async () => { await api("/pricing", { method: "PUT", body: { pricing: collect() } }); toast("Pricing saved"); load(); });

  const names = Object.fromEntries(ov.bots.map((b) => [b.id, `${b.persona.avatar} ${b.persona.name}`]));
  const load = async () => {
    const q = new URLSearchParams({ days: $("#u-days").value, ...($("#u-bot").value ? { bot: $("#u-bot").value } : {}) });
    const { rows, byDay } = await api("/usage?" + q);
    const max = Math.max(1, ...byDay.map((d) => d.tokens));
    $("#u-chart").innerHTML = byDay.length
      ? byDay.map((d) => `<div class="bar" style="height:${(d.tokens / max) * 100}%" data-v="${fmt(d.tokens)} tokens"><span>${d.day.slice(5)}</span></div>`).join("")
      : `<p class="muted">No usage yet. Say hi in a bot's Playground!</p>`;
    $("#u-rows").innerHTML = rows.length
      ? rows.map((r) => `<tr><td>${esc(names[r.botId] || r.botId)}</td><td>${FEATURE_LABEL[r.feature] || esc(r.feature)}</td><td>${esc(r.model)}</td><td>${fmt(r.calls)}</td><td>${fmt(r.promptTokens)}</td><td>${fmt(r.completionTokens)}</td><td>${money(r.estCost)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="muted">No usage yet.</td></tr>`;
  };
  $("#u-days").addEventListener("change", load);
  $("#u-bot").addEventListener("change", load);
  load();
}

// ── start ────────────────────────────────────────────────────────
if (token) boot().catch(() => showLogin()); else showLogin();
