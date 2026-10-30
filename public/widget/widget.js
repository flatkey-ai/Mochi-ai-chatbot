/*!
 * Mochi web chat widget. Add to any site:
 * <script src="https://YOUR-MOCHI-SERVER/widget/widget.js" data-server="https://YOUR-MOCHI-SERVER" defer></script>
 * Optional: data-title="Chat with Mochi" data-color="#ff6fae" data-greeting="hii! ask me anything ✨"
 */
(function () {
  if (window.__mochiWidget) return;
  window.__mochiWidget = true;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var server = ((script && script.getAttribute("data-server")) || (script && new URL(script.src).origin) || "").replace(/\/+$/, "");
  var color = (script && script.getAttribute("data-color")) || "#ff6fae";
  var title = (script && script.getAttribute("data-title")) || "Mochi";
  var greeting = (script && script.getAttribute("data-greeting")) || "hii! i'm mochi 🍡 ask me anything~";

  var sid;
  try {
    sid = localStorage.getItem("mochi_sid");
    if (!sid) { sid = "w-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("mochi_sid", sid); }
  } catch (e) {
    sid = "w-" + Math.random().toString(36).slice(2);
  }

  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483000";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" +
    ":host{all:initial}*{box-sizing:border-box;font-family:ui-rounded,'Nunito',system-ui,sans-serif}" +
    ".fab{width:58px;height:58px;border-radius:50%;border:0;background:" + color + ";color:#fff;font-size:28px;cursor:pointer;box-shadow:0 8px 24px rgba(255,111,174,.45);transition:transform .15s}" +
    ".fab:hover{transform:scale(1.07)}" +
    ".panel{position:absolute;right:0;bottom:72px;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100vh - 110px));background:#fff;border-radius:22px;box-shadow:0 18px 50px rgba(42,34,51,.22);display:none;flex-direction:column;overflow:hidden}" +
    ".panel.open{display:flex}" +
    ".head{background:" + color + ";color:#fff;padding:14px 16px;font-weight:800;display:flex;align-items:center;gap:8px}" +
    ".head small{font-weight:500;opacity:.85;display:block;font-size:11px}" +
    ".head button{margin-left:auto;background:none;border:0;color:#fff;font-size:20px;cursor:pointer}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#fdf7fb}" +
    ".m{max-width:82%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;color:#2a2233}" +
    ".u{align-self:flex-end;background:" + color + ";color:#fff;border-bottom-right-radius:5px}" +
    ".b{align-self:flex-start;background:#efe9ff;border-bottom-left-radius:5px}" +
    ".m img{max-width:160px;border-radius:10px;display:block;margin-top:4px}" +
    "form{display:flex;gap:6px;padding:10px;border-top:1px solid #f0e4ef}" +
    "input[type=text]{flex:1;border:1.5px solid #f0e4ef;border-radius:999px;padding:9px 14px;font-size:14px;outline:none}" +
    "input[type=text]:focus{border-color:" + color + "}" +
    ".icon{border:0;background:#ffe3f0;border-radius:50%;width:38px;height:38px;cursor:pointer;font-size:16px}" +
    ".send{background:" + color + ";color:#fff}" +
    ".foot{text-align:center;font-size:10.5px;color:#a99db3;padding:0 0 8px}.foot a{color:inherit}" +
    "</style>" +
    '<div class="panel" part="panel"><div class="head">🍡<div>' + escapeHtml(title) + "<small>usually replies in a few seconds</small></div>" +
    '<button aria-label="Close">×</button></div><div class="log"></div>' +
    '<form><button type="button" class="icon attach" aria-label="Attach image">📎</button><input type="file" accept="image/*" hidden />' +
    '<input type="text" placeholder="type a message…" aria-label="Message" /><button class="icon send" aria-label="Send">➤</button></form>' +
    '<div class="foot">powered by <a href="https://flatkey.ai/?utm_source=mochi_bot&utm_medium=web_widget&utm_campaign=mochi&utm_content=powered_by" target="_blank" rel="noopener">flatkey</a></div></div>' +
    '<button class="fab" aria-label="Open chat">🍡</button>';

  var panel = root.querySelector(".panel");
  var log = root.querySelector(".log");
  var form = root.querySelector("form");
  var input = root.querySelector("input[type=text]");
  var file = root.querySelector("input[type=file]");
  var image = null;
  var greeted = false;

  root.querySelector(".fab").onclick = function () {
    panel.classList.toggle("open");
    if (!greeted) { add("b", escapeHtml(greeting)); greeted = true; }
    input.focus();
  };
  root.querySelector(".head button").onclick = function () { panel.classList.remove("open"); };
  root.querySelector(".attach").onclick = function () { file.click(); };
  file.onchange = function () {
    var f = file.files[0];
    if (!f || f.size > 5 * 1024 * 1024) return;
    var r = new FileReader();
    r.onload = function () { image = r.result; input.placeholder = "image attached, add a message…"; };
    r.readAsDataURL(f);
  };

  form.onsubmit = function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text && !image) return;
    add("u", escapeHtml(text) + (image ? '<img src="' + image + '" alt="">' : ""));
    var body = JSON.stringify({ sessionId: sid, text: text, image: image });
    input.value = ""; image = null; file.value = ""; input.placeholder = "type a message…";
    var wait = add("b", "…");
    fetch(server + "/api/widget/chat", { method: "POST", headers: { "content-type": "application/json" }, body: body })
      .then(function (r) { return r.json(); })
      .then(function (d) { wait.innerHTML = escapeHtml(d.reply || d.error || "(｡•́︿•̀｡) hmm, no reply"); })
      .catch(function () { wait.textContent = "connection hiccup, try again?"; });
  };

  function add(cls, html) {
    var d = document.createElement("div");
    d.className = "m " + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = 1e9;
    return d;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
})();
