/*!
 * Mochi web chat widget. Add to any site (the dashboard gives you this exact line per bot):
 * <script src="https://YOUR-MOCHI-SERVER/widget/widget.js" data-server="https://YOUR-MOCHI-SERVER" data-bot="BOT_ID" defer></script>
 * The bot's name, avatar, color, description and greeting come from its Persona settings.
 * Optional overrides: data-title, data-color, data-greeting.
 */
(function () {
  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var attr = function (k) { return script && script.getAttribute(k); };
  var server = (attr("data-server") || (script && new URL(script.src).origin) || "").replace(/\/+$/, "");
  var botId = attr("data-bot") || "";
  var key = "__mochiWidget_" + botId;
  if (window[key]) return;
  window[key] = true;

  var base = server + "/api/widget" + (botId ? "/" + encodeURIComponent(botId) : "");
  var cfgUrl = server + "/api/widget/" + encodeURIComponent(botId || "default") + "/config";

  var sid;
  try {
    var sk = "mochi_sid_" + botId;
    sid = localStorage.getItem(sk);
    if (!sid) { sid = "w-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(sk, sid); }
  } catch (e) {
    sid = "w-" + Math.random().toString(36).slice(2);
  }

  fetch(cfgUrl).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (cfg) {
    if (cfg.enabled === false) return;
    mount({
      name: attr("data-title") || cfg.name || "Chat",
      avatar: cfg.avatar || "💬",
      color: attr("data-color") || cfg.color || "#ff6fae",
      description: cfg.description || "usually replies in a few seconds",
      greeting: attr("data-greeting") || cfg.greeting || "Hi! How can I help?",
    });
  });

  function mount(c) {
    var host = document.createElement("div");
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483000";
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    var col = c.color;
    root.innerHTML =
      "<style>" +
      ":host{all:initial}*{box-sizing:border-box;font-family:ui-rounded,'Nunito',system-ui,sans-serif}" +
      ".fab{width:58px;height:58px;border-radius:50%;border:0;background:" + col + ";color:#fff;font-size:28px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.18);transition:transform .15s}" +
      ".fab:hover{transform:scale(1.07)}" +
      ".panel{position:absolute;right:0;bottom:72px;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100vh - 110px));background:#fff;border-radius:22px;box-shadow:0 18px 50px rgba(42,34,51,.22);display:none;flex-direction:column;overflow:hidden}" +
      ".panel.open{display:flex}" +
      ".head{background:" + col + ";color:#fff;padding:12px 14px;font-weight:800;display:flex;align-items:center;gap:10px;font-size:22px}" +
      ".head div{font-size:15px;min-width:0}.head small{font-weight:500;opacity:.9;display:block;font-size:11.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".head button{margin-left:auto;background:none;border:0;color:#fff;font-size:22px;cursor:pointer}" +
      ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#fdf7fb}" +
      ".m{max-width:82%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;color:#2a2233}" +
      ".u{align-self:flex-end;background:" + col + ";color:#fff;border-bottom-right-radius:5px}" +
      ".b{align-self:flex-start;background:#efe9ff;border-bottom-left-radius:5px}" +
      ".m img{max-width:160px;border-radius:10px;display:block;margin-top:4px}" +
      "form{display:flex;gap:6px;padding:10px;border-top:1px solid #f0e4ef}" +
      "input[type=text]{flex:1;border:1.5px solid #f0e4ef;border-radius:999px;padding:9px 14px;font-size:14px;outline:none}" +
      "input[type=text]:focus{border-color:" + col + "}" +
      ".icon{border:0;background:#f4eef3;border-radius:50%;width:38px;height:38px;cursor:pointer;font-size:16px}" +
      ".send{background:" + col + ";color:#fff}" +
      ".foot{text-align:center;font-size:10.5px;color:#a99db3;padding:0 0 8px}.foot a{color:inherit}" +
      "</style>" +
      '<div class="panel"><div class="head">' + esc(c.avatar) + "<div>" + esc(c.name) + "<small>" + esc(c.description) + "</small></div>" +
      '<button aria-label="Close">×</button></div><div class="log"></div>' +
      '<form><button type="button" class="icon attach" aria-label="Attach image">📎</button><input type="file" accept="image/*" hidden />' +
      '<input type="text" placeholder="type a message…" aria-label="Message" /><button class="icon send" aria-label="Send">➤</button></form>' +
      '<div class="foot">powered by <a href="https://flatkey.ai/?utm_source=mochi_bot&utm_medium=web_widget&utm_campaign=mochi&utm_content=powered_by" target="_blank" rel="noopener">flatkey</a></div></div>' +
      '<button class="fab" aria-label="Open chat">' + esc(c.avatar) + "</button>";

    var panel = root.querySelector(".panel");
    var log = root.querySelector(".log");
    var form = root.querySelector("form");
    var input = root.querySelector("input[type=text]");
    var file = root.querySelector("input[type=file]");
    var image = null;
    var greeted = false;

    root.querySelector(".fab").onclick = function () {
      panel.classList.toggle("open");
      if (!greeted) { add("b", esc(c.greeting)); greeted = true; }
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
      add("u", esc(text) + (image ? '<img src="' + image + '" alt="">' : ""));
      var body = JSON.stringify({ sessionId: sid, text: text, image: image });
      input.value = ""; image = null; file.value = ""; input.placeholder = "type a message…";
      var wait = add("b", "…");
      fetch(base + "/chat", { method: "POST", headers: { "content-type": "application/json" }, body: body })
        .then(function (r) { return r.json(); })
        .then(function (d) { wait.innerHTML = esc(d.reply || d.error || "(｡•́︿•̀｡) hmm, no reply"); })
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
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; });
  }
})();
