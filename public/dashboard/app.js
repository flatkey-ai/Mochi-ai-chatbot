// Mochi dashboard: vanilla JS, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n) => Number(n || 0).toLocaleString();
const money = (n) => (n == null ? "–" : "$" + n.toFixed(n < 1 ? 4 : 2));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let token = store.get("mochi_admin_token") || "";
let state = null;

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
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function showLogin(err = "") {
  $("#login").classList.remove("hidden");
  $("#app").classList.add("hidden");
  $("#login-error").textContent = err;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  token = $("#token").value.trim();
  try {
    await boot();
    store.set("mochi_admin_token", token);
  } catch {}
});
$("#logout").addEventListener("click", () => { store.del("mochi_admin_token"); token = ""; showLogin(); });

// ── routing ──────────────────────────────────────────────────────
function route() {
  const id = (location.hash || "#overview").slice(1);
  $$(".page").forEach((p) => p.classList.toggle("hidden", p.id !== id));
  $$("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + id));
  if (id === "usage") loadUsage();
  if (id === "memory") loadMemory();
  if (id === "overview") loadOverviewStats();
}
window.addEventListener("hashchange", route);

// ── boot ─────────────────────────────────────────────────────────
async function boot() {
  state = await api("/overview");
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  fill();
  route();
  loadModels();
}

function fill() {
  const s = state.settings;
  $("#bot-name").textContent = s.persona.name;
  document.title = `${s.persona.name} · Dashboard`;
  // models
  for (const k of ["chat", "vision", "memory", "search"]) $("#m-" + k).value = s.models[k];
  // abilities
  for (const k of ["memory", "search", "vision"]) $("#f-" + k).checked = s.features[k];
  $("#l-budget").value = s.limits.dailyTokenBudget;
  $("#l-reply").value = s.limits.maxReplyTokens;
  $("#l-history").value = s.limits.historyMessages;
  $("#l-every").value = s.limits.memoryUpdateEvery;
  $("#l-images").value = s.limits.maxImagesPerMessage;
  $("#l-searches").value = s.search.maxSearchesPerReply;
  $("#s-mode").value = s.search.mode;
  $$(".js-every").forEach((e) => (e.textContent = s.limits.memoryUpdateEvery));
  renderPricing(s.pricing);
  // persona
  $("#p-name").value = s.persona.name;
  $("#p-nick").value = s.persona.nicknames.join(", ");
  $("#p-prompt").value = s.persona.systemPrompt;
  $("#t-dm").checked = s.triggers.replyInDirectMessages;
  $("#t-mention").checked = s.triggers.replyWhenMentioned;
  $("#t-name").checked = s.triggers.replyWhenNameSaid;
  $("#t-rand").value = s.triggers.randomReplyChance;
  $("#t-rand-val").textContent = Math.round(s.triggers.randomReplyChance * 100) + "%";
  // platforms
  $("#w-origins").value = s.platforms.web.allowedOrigins.join(", ");
  $("#widget-snippet").textContent = `<script src="${state.publicUrl}/widget/widget.js" data-server="${state.publicUrl}" defer></script>`;
  renderPlatforms();
  renderAbilityChips();
  renderWhyFlatkey();
}

const WHY_ICONS = ["💸", "⏱️", "🔀"];
function renderWhyFlatkey() {
  const w = state.whyFlatkey;
  if (!w) return;
  $("#why-flatkey").innerHTML = `
    <h3>Why Mochi runs on Flatkey</h3>
    <p class="slogan">${esc(w.slogan)}</p>
    <div class="why-grid">${w.points.map((p, i) => `<div><b>${WHY_ICONS[i] || "✨"} ${esc(p.title)}</b><p>${esc(p.body)}</p></div>`).join("")}</div>
    <div class="actions" style="justify-content:flex-start">
      <a class="btn primary" href="${esc(w.keysUrl)}" target="_blank" rel="noopener">Manage API keys</a>
      <a class="btn ghost" href="${esc(w.homeUrl)}" target="_blank" rel="noopener">Explore models</a></div>`;
  $(".fk-badge").href = w.badgeUrl;
}

function renderAbilityChips() {
  const s = state.settings;
  const chip = (on, label) => `<span class="chip ${on ? "on" : "off"}">${label}</span>`;
  $("#ov-abilities").innerHTML = [
    chip(s.features.memory, "🧠 memory"), chip(s.features.search, "🔎 search"), chip(s.features.vision, "🖼️ vision"),
    `<span class="chip">💬 ${esc(s.models.chat)}</span>`,
    s.limits.dailyTokenBudget ? `<span class="chip">⛽ budget ${fmt(s.limits.dailyTokenBudget)}/day</span>` : `<span class="chip">⛽ no daily cap</span>`,
  ].join("");
  $("#st-tokens").textContent = fmt(state.tokensToday);
  $("#st-budget").textContent = s.limits.dailyTokenBudget ? `${Math.round((state.tokensToday / s.limits.dailyTokenBudget) * 100)}% of daily budget` : "no daily cap";
  $("#st-platforms").textContent = state.platforms.filter((p) => p.running).length;
}

const PLATFORM_META = {
  discord: { icon: "🎮", name: "Discord", env: "DISCORD_BOT_TOKEN" },
  telegram: { icon: "✈️", name: "Telegram", env: "TELEGRAM_BOT_TOKEN" },
  slack: { icon: "💼", name: "Slack", env: "SLACK_BOT_TOKEN + SLACK_APP_TOKEN" },
  web: { icon: "🌐", name: "Website widget", env: "built in" },
};

function renderPlatforms() {
  $("#platform-cards").innerHTML = state.platforms.map((p) => {
    const m = PLATFORM_META[p.platform];
    const status = !p.configured ? `<span class="dot bad"></span>add ${m.env} to .env` : p.running ? `<span class="dot ok"></span>${esc(p.detail || "running")}` : `<span class="dot"></span>${esc(p.detail || "stopped")}`;
    return `<div class="card platform">
      <div class="row"><b>${m.icon} ${m.name}</b>
        <label class="switch"><input type="checkbox" data-platform="${p.platform}" ${p.enabled ? "checked" : ""} ${p.configured ? "" : "disabled"} /><span></span></label></div>
      <div class="muted small">${status}</div></div>`;
  }).join("");
  $$("[data-platform]").forEach((el) => el.addEventListener("change", async () => {
    await save({ platforms: { [el.dataset.platform]: { enabled: el.checked } } }, `${PLATFORM_META[el.dataset.platform].name} ${el.checked ? "on" : "off"}`);
    setTimeout(refresh, 2500);
  }));
}

function renderPricing(pricing) {
  const rows = Object.entries(pricing);
  $("#pricing-table tbody").innerHTML = (rows.length ? rows : [["", { inputPerM: "", outputPerM: "" }]]).map(([m, p]) => `
    <tr><td><input list="model-list" class="pr-model" value="${esc(m)}" placeholder="model id" /></td>
    <td><input type="number" step="0.001" min="0" class="pr-in" value="${p.inputPerM}" /></td>
    <td><input type="number" step="0.001" min="0" class="pr-out" value="${p.outputPerM}" /></td>
    <td><button class="btn danger small pr-del" type="button">✕</button></td></tr>`).join("");
  $$(".pr-del").forEach((b) => b.addEventListener("click", () => b.closest("tr").remove()));
}
$("#add-price").addEventListener("click", () => {
  const cur = collectPricing();
  cur[""] = { inputPerM: "", outputPerM: "" };
  renderPricing(cur);
});
function collectPricing() {
  const out = {};
  $$("#pricing-table tbody tr").forEach((tr) => {
    const m = $(".pr-model", tr).value.trim();
    if (m) out[m] = { inputPerM: Number($(".pr-in", tr).value) || 0, outputPerM: Number($(".pr-out", tr).value) || 0 };
  });
  return out;
}

async function loadModels() {
  try {
    const { models } = await api("/models");
    $("#model-list").innerHTML = models.map((m) => `<option value="${esc(m.id)}">`).join("");
    $("#models-note").textContent = `${models.length} models available on your Flatkey key. Start typing to filter.`;
  } catch (e) {
    $("#models-note").textContent = `Couldn't load the model list (${e.message}). You can still type model IDs.`;
  }
}

// ── saving ───────────────────────────────────────────────────────
async function save(patch, msg = "Saved ✨") {
  try {
    const { settings } = await api("/settings", { method: "PUT", body: patch });
    state.settings = settings;
    fill();
    toast(msg);
  } catch (e) {
    toast("Error: " + e.message);
  }
}
async function refresh() { state = await api("/overview"); fill(); }

const savers = {
  models: () => ({ models: Object.fromEntries(["chat", "vision", "memory", "search"].map((k) => [k, $("#m-" + k).value.trim()])) }),
  abilities: () => ({
    features: { memory: $("#f-memory").checked, search: $("#f-search").checked, vision: $("#f-vision").checked },
    limits: {
      dailyTokenBudget: Number($("#l-budget").value), maxReplyTokens: Number($("#l-reply").value),
      historyMessages: Number($("#l-history").value), memoryUpdateEvery: Number($("#l-every").value),
      maxImagesPerMessage: Number($("#l-images").value),
    },
    search: { mode: $("#s-mode").value, maxSearchesPerReply: Number($("#l-searches").value) },
  }),
  pricing: () => ({ pricing: collectPricing() }),
  persona: () => ({
    persona: { name: $("#p-name").value.trim(), nicknames: $("#p-nick").value.split(",").map((x) => x.trim()).filter(Boolean), systemPrompt: $("#p-prompt").value },
    triggers: { replyInDirectMessages: $("#t-dm").checked, replyWhenMentioned: $("#t-mention").checked, replyWhenNameSaid: $("#t-name").checked, randomReplyChance: Number($("#t-rand").value) },
  }),
  web: () => ({ platforms: { web: { allowedOrigins: $("#w-origins").value.split(",").map((x) => x.trim()).filter(Boolean) } } }),
};
$$("[data-save]").forEach((b) => b.addEventListener("click", () => save(savers[b.dataset.save]())));
// Ability switches save instantly: they are the cost controls.
for (const k of ["memory", "search", "vision"]) {
  $("#f-" + k).addEventListener("change", (e) => save({ features: { [k]: e.target.checked } }, `${k} ${e.target.checked ? "on" : "off"}`));
}
$("#t-rand").addEventListener("input", (e) => ($("#t-rand-val").textContent = Math.round(e.target.value * 100) + "%"));

// ── usage ────────────────────────────────────────────────────────
$("#u-days").addEventListener("change", loadUsage);
const FEATURE_LABEL = { chat: "💬 chat", vision: "🖼️ vision", search: "🔎 search", memory: "🧠 memory" };

async function loadUsage() {
  const days = Number($("#u-days").value);
  const { rows, byDay } = await api("/usage?days=" + days);
  const max = Math.max(1, ...byDay.map((d) => d.tokens));
  $("#u-chart").innerHTML = byDay.length
    ? byDay.map((d) => `<div class="bar" style="height:${(d.tokens / max) * 100}%" data-v="${fmt(d.tokens)} tokens"><span>${d.day.slice(5)}</span></div>`).join("")
    : `<p class="muted">No usage yet. Say hi in the Playground!</p>`;
  $("#u-rows").innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${FEATURE_LABEL[r.feature] || esc(r.feature)}</td><td>${esc(r.model)}</td><td>${fmt(r.calls)}</td><td>${fmt(r.promptTokens)}</td><td>${fmt(r.completionTokens)}</td><td>${money(r.estCost)}</td></tr>`).join("")
    : `<tr><td colspan="6" class="muted">No usage yet.</td></tr>`;
}

async function loadOverviewStats() {
  try {
    const [{ rows }, mem, ov] = await Promise.all([api("/usage?days=7"), api("/memory"), api("/overview")]);
    state = ov;
    renderAbilityChips();
    const priced = rows.filter((r) => r.estCost != null);
    $("#st-cost").textContent = priced.length ? money(priced.reduce((a, r) => a + r.estCost, 0)) : "–";
    $("#st-people").textContent = fmt(mem.people.length);
    $("#st-rooms").textContent = `across ${mem.rooms.length} chat room(s)`;
  } catch {}
}

// ── memory ───────────────────────────────────────────────────────
async function loadMemory() {
  const { people, rooms } = await api("/memory");
  $("#mem-people").innerHTML = people.length ? people.map((p) => `
    <div class="mem"><div><b>${esc(p.displayName)}</b><span class="tag">${p.platform}</span>
      <span class="muted small"> · ${fmt(p.messageCount)} msgs · last seen ${new Date(p.lastSeen).toLocaleString()}</span>
      ${p.personality ? `<p>🎭 ${esc(p.personality)}</p>` : ""}
      ${p.facts.length ? `<p>📌 ${p.facts.map(esc).join(" · ")}</p>` : ""}
      ${p.interests.length ? `<p>💖 ${p.interests.map(esc).join(", ")}</p>` : ""}
      ${!p.personality && !p.facts.length ? `<p class="muted">No profile yet. It builds up as they chat.</p>` : ""}
    </div><button class="btn danger small" data-forget-person="${p.platform}/${encodeURIComponent(p.userId)}">Forget</button></div>`).join("")
    : `<p class="muted">Nobody yet.</p>`;
  $("#mem-rooms").innerHTML = rooms.length ? rooms.map((r) => `
    <div class="mem"><div><b>${esc(r.title || r.roomId)}</b><span class="tag">${r.platform}</span>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : `<p class="muted">No summary yet (${r.msgsSinceUpdate} new msgs).</p>`}
      ${r.recentTopics.length ? `<p>🗂️ ${r.recentTopics.map(esc).join(" · ")}</p>` : ""}
    </div><button class="btn danger small" data-forget-room="${r.platform}/${encodeURIComponent(r.roomId)}">Forget</button></div>`).join("")
    : `<p class="muted">No rooms yet.</p>`;
  $$("[data-forget-person]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirmInline(b)) return;
    await api("/memory/people/" + b.dataset.forgetPerson, { method: "DELETE" });
    toast("Forgotten"); loadMemory();
  }));
  $$("[data-forget-room]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirmInline(b)) return;
    await api("/memory/rooms/" + b.dataset.forgetRoom, { method: "DELETE" });
    toast("Forgotten"); loadMemory();
  }));
}
// Two-click confirm without browser dialogs.
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1";
  btn.textContent = "Sure?";
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Forget"; }, 3000);
  return false;
}

// ── playground ───────────────────────────────────────────────────
let pgImage = null;
$("#pg-file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { pgImage = r.result; $("#pg-attached").textContent = "📎 " + f.name + " attached"; };
  r.readAsDataURL(f);
});
function addMsg(cls, html) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.innerHTML = html;
  $("#pg-log").appendChild(d);
  $("#pg-log").scrollTop = 1e9;
  return d;
}
$("#pg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#pg-text").value.trim();
  if (!text && !pgImage) return;
  addMsg("me", esc(text) + (pgImage ? `<img src="${pgImage}" alt="attached image" />` : ""));
  const body = { text, image: pgImage };
  $("#pg-text").value = ""; pgImage = null; $("#pg-attached").textContent = ""; $("#pg-file").value = "";
  const typing = addMsg("bot", "…");
  try {
    const { reply, ms } = await api("/test-chat", { method: "POST", body });
    typing.innerHTML = reply ? esc(reply.text) : `<i class="muted">(no reply: check the triggers)</i>`;
    const tags = [reply?.usedSearch && "🔎 searched", reply?.usedVision && "🖼️ read image", `${(ms / 1000).toFixed(1)}s`].filter(Boolean);
    addMsg("meta", tags.join(" · "));
  } catch (err) {
    typing.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
});

// ── start ────────────────────────────────────────────────────────
if (token) boot().catch(() => showLogin()); else showLogin();
