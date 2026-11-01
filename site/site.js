// Plays the demo conversation in the hero, then loops.
(function () {
  const box = document.getElementById("chat");
  const msgs = window.MOCHI_DEMO || [];
  if (!box || !msgs.length) return;
  const avatar = document.querySelector(".brand img")?.getAttribute("src") || "";
  const colors = { u1: "#5865F2", u2: "#2fb380" };
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function render(m) {
    const row = document.createElement("div");
    row.className = "msg" + (m.who === "bot" ? " bot" : "");
    const av = document.createElement("div");
    av.className = "av";
    if (m.who === "bot") {
      const img = document.createElement("img");
      img.src = avatar;
      img.alt = "";
      av.appendChild(img);
    } else {
      av.style.background = colors[m.who] || "#8a7f96";
      av.textContent = (m.name || "?").slice(0, 1);
    }
    const body = document.createElement("div");
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = m.who === "bot" ? "Mochi" : m.name;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.text;
    body.append(who, bubble);
    row.append(av, body);
    return row;
  }

  function trim() {
    // justify-content:flex-end hides overflow above, so measure the rows instead of scrollHeight.
    const used = () => Array.from(box.children).reduce((h, el) => h + el.offsetHeight + 9, 0);
    while (used() > box.clientHeight - 20 && box.children.length > 1) box.removeChild(box.firstChild);
  }

  if (still) {
    msgs.slice(-3).forEach((m) => box.appendChild(render(m)));
    trim();
    return;
  }

  let i = 0;
  function next() {
    if (i >= msgs.length) {
      i = 0;
      setTimeout(() => { box.innerHTML = ""; next(); }, 3500);
      return;
    }
    const m = msgs[i++];
    if (m.who === "bot") {
      const t = document.createElement("div");
      t.className = "typing";
      t.textContent = box.dataset.typing;
      box.appendChild(t);
      trim();
      setTimeout(() => { t.remove(); box.appendChild(render(m)); trim(); setTimeout(next, 1700); }, 1100);
    } else {
      box.appendChild(render(m));
      trim();
      setTimeout(next, 1000);
    }
  }
  next();
})();
