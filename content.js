// Command Center — content script.
// Renders the Spotlight-style overlay in a Shadow DOM (isolated from page CSS),
// does the fuzzy ranking locally, and asks the background script to perform actions.

(() => {
  if (window.__commandCenterInjected) return;
  window.__commandCenterInjected = true;

  const api = typeof browser !== "undefined" ? browser : chrome;

  const MAX_TABS = 8;
  const MAX_HISTORY = 7;

  let host, shadow, input, list, footer;
  let isOpen = false;
  let allTabs = [];
  let results = [];
  let selected = 0;
  let historyTimer = null;
  let queryToken = 0;

  const favCache = new Map(); // host -> data: URL | null

  // ---------- Fuzzy matching ----------

  // Subsequence scorer with bonuses for consecutive runs and word boundaries.
  // Returns -1 when not every query char is found, so callers can filter.
  function fuzzyScore(query, text) {
    if (!query) return 0;
    query = query.toLowerCase();
    text = text.toLowerCase();
    let qi = 0;
    let score = 0;
    let lastMatch = -2;
    let run = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) {
        let bonus = 1;
        if (lastMatch === ti - 1) {
          run += 1;
          bonus += run * 3;
        } else {
          run = 0;
        }
        const prev = ti > 0 ? text[ti - 1] : " ";
        if (/[\s\-_/.:?#&=]/.test(prev)) bonus += 4; // word/segment boundary
        if (ti === 0) bonus += 4;
        score += bonus;
        lastMatch = ti;
        qi += 1;
      }
    }
    if (qi < query.length) return -1;
    score -= text.length * 0.02; // prefer shorter, tighter matches
    return score;
  }

  // Multi-word queries: each whitespace-separated token must match somewhere in
  // the title or the URL, independently. So "jagajaga coaurora" matches
  // jagajaga.me/coaurora (no literal space between the words), and "git palette"
  // matches a page with "git" in the title and "palette" in the URL.
  function bestScore(query, item) {
    const q = (query || "").trim();
    if (!q) return 0;
    const title = item.title || "";
    const url = item.url || "";
    let total = 0;
    for (const tok of q.split(/\s+/)) {
      const t = fuzzyScore(tok, title);
      const u = fuzzyScore(tok, url);
      if (t < 0 && u < 0) return -1; // this token matched nothing → not a result
      total += Math.max(t, u) + (t >= 0 ? 2 : 0); // nudge toward title hits
    }
    return total;
  }

  // ---------- URL / search helpers ----------

  function looksLikeUrl(q) {
    q = q.trim();
    if (!q || /\s/.test(q)) return /^[a-zA-Z]+:\/\//.test(q);
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(q)) return true;
    if (/^localhost(:\d+)?(\/.*)?$/.test(q)) return true;
    return /^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(q); // domain.tld[/path]
  }

  function normalizeUrl(q) {
    q = q.trim();
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(q) ? q : "https://" + q;
  }

  function googleUrl(q) {
    return "https://www.google.com/search?q=" + encodeURIComponent(q.trim());
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "";
    }
  }

  function prettyUrl(url) {
    try {
      const u = new URL(url);
      return (u.hostname + u.pathname).replace(/\/$/, "");
    } catch (e) {
      return url;
    }
  }

  // ---------- Data ----------

  async function refreshTabs() {
    try {
      allTabs = await api.runtime.sendMessage({ type: "getTabs" });
    } catch (e) {
      allTabs = [];
    }
  }

  async function fetchHistory(text) {
    try {
      return await api.runtime.sendMessage({ type: "searchHistory", text });
    } catch (e) {
      return [];
    }
  }

  // ---------- Rendering ----------

  const ICON_GLOBE =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>';
  const ICON_SEARCH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>';
  const ICON_LINK =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>';

  // Parse a static SVG string into a real node (no innerHTML — keeps the linter
  // happy and avoids any HTML-injection sink).
  function svgIcon(markup) {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    return document.importNode(doc.body.firstElementChild, true);
  }

  function glyph(markup) {
    const span = document.createElement("span");
    span.className = "cc-glyph";
    span.appendChild(svgIcon(markup));
    return span;
  }

  // The icon cell: a favicon <img> (filled in asynchronously) in front of a glyph fallback.
  function buildIcon(item) {
    const cell = document.createElement("span");
    cell.className = "cc-icon";
    if (item.type === "search") {
      cell.appendChild(glyph(ICON_SEARCH));
      return cell;
    }
    if (item.type === "url") {
      cell.appendChild(glyph(ICON_LINK));
      return cell;
    }
    const img = document.createElement("img");
    img.className = "cc-fav";
    if (item.host) img.dataset.host = item.host;
    img.alt = "";
    img.style.display = "none";
    cell.appendChild(img);
    cell.appendChild(glyph(ICON_GLOBE));
    return cell;
  }

  function render() {
    list.innerHTML = "";
    if (results.length === 0) {
      list.innerHTML = '<div class="cc-empty">No matches</div>';
      return;
    }
    results.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "cc-row" + (i === selected ? " cc-sel" : "");
      row.dataset.index = i;

      row.appendChild(buildIcon(item));

      const text = document.createElement("span");
      text.className = "cc-text";
      const title = document.createElement("span");
      title.className = "cc-title";
      title.textContent = item.title;
      text.appendChild(title);
      if (item.subtitle) {
        const sub = document.createElement("span");
        sub.className = "cc-sub";
        sub.textContent = item.subtitle;
        text.appendChild(sub);
      }
      row.appendChild(text);

      const badge = document.createElement("span");
      badge.className = "cc-badge";
      badge.textContent = item.badge || "";
      row.appendChild(badge);

      row.addEventListener("mousemove", () => {
        if (selected !== i) {
          selected = i;
          paintSelection();
        }
      });
      row.addEventListener("click", () => activate(results[i]));
      list.appendChild(row);
    });
    paintSelection();
    fillFavicons(queryToken);
  }

  // Resolve favicons (cached per host) and swap them in for the glyph placeholders.
  async function fillFavicons(token) {
    const byHost = new Map();
    list.querySelectorAll("img.cc-fav").forEach((im) => {
      const h = im.dataset.host;
      if (!h) return;
      if (!byHost.has(h)) byHost.set(h, []);
      byHost.get(h).push(im);
    });
    for (const [h, els] of byHost) {
      let data = favCache.get(h);
      if (data === undefined) {
        try {
          data = await api.runtime.sendMessage({ type: "favicon", host: h });
        } catch (e) {
          data = null;
        }
        favCache.set(h, data);
      }
      if (token !== queryToken) return; // results changed under us
      if (!data) continue;
      for (const im of els) {
        if (!im.isConnected) continue;
        im.onerror = () => {
          im.style.display = "none";
          const g = im.nextElementSibling;
          if (g && g.classList.contains("cc-glyph")) g.style.display = "";
        };
        im.src = data;
        im.style.display = "";
        const g = im.nextElementSibling;
        if (g && g.classList.contains("cc-glyph")) g.style.display = "none";
      }
    }
  }

  function paintSelection() {
    const rows = list.querySelectorAll(".cc-row");
    rows.forEach((r, i) => r.classList.toggle("cc-sel", i === selected));
    const cur = rows[selected];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  // ---------- Query pipeline ----------

  function buildResults(query, historyItems) {
    const q = query.trim();
    const out = [];

    if (!q) {
      // Empty query: most-recently-used tabs (skip the current one).
      for (const t of allTabs) {
        if (t.active) continue;
        out.push({
          type: "tab",
          title: t.title,
          subtitle: prettyUrl(t.url),
          url: t.url,
          host: hostOf(t.url),
          tabId: t.id,
          windowId: t.windowId,
          badge: "Tab"
        });
        if (out.length >= MAX_TABS + MAX_HISTORY) break;
      }
      return out;
    }

    // Tabs first, fuzzy-ranked.
    const scoredTabs = [];
    for (const t of allTabs) {
      const s = bestScore(q, t);
      if (s >= 0) scoredTabs.push({ s, t });
    }
    scoredTabs.sort((a, b) => b.s - a.s);
    const openUrls = new Set();
    for (const { t } of scoredTabs.slice(0, MAX_TABS)) {
      openUrls.add(t.url);
      out.push({
        type: "tab",
        title: t.title,
        subtitle: prettyUrl(t.url),
        url: t.url,
        host: hostOf(t.url),
        tabId: t.id,
        windowId: t.windowId,
        badge: "Tab"
      });
    }

    // History next, fuzzy-ranked, de-duped against open tabs and itself.
    const seen = new Set(openUrls);
    const scoredHist = [];
    for (const h of historyItems || []) {
      if (!h.url || seen.has(h.url)) continue;
      const s = bestScore(q, { title: h.title || "", url: h.url });
      if (s >= 0) {
        seen.add(h.url);
        scoredHist.push({ s, h });
      }
    }
    scoredHist.sort((a, b) => b.s - a.s);
    for (const { h } of scoredHist.slice(0, MAX_HISTORY)) {
      out.push({
        type: "history",
        title: h.title || prettyUrl(h.url),
        subtitle: prettyUrl(h.url),
        url: h.url,
        host: hostOf(h.url),
        badge: "History"
      });
    }

    // Always-available fallbacks at the bottom.
    if (looksLikeUrl(q)) {
      out.push({
        type: "url",
        title: "Open " + q,
        subtitle: normalizeUrl(q),
        url: normalizeUrl(q),
        badge: "↵"
      });
    }
    out.push({
      type: "search",
      title: "Search Google for “" + q + "”",
      subtitle: "google.com",
      url: googleUrl(q),
      badge: looksLikeUrl(q) ? "⌘↵" : "↵"
    });

    return out;
  }

  function recompute() {
    const query = input.value;
    const token = ++queryToken;

    // Tabs/fallbacks render instantly; history streams in when it arrives.
    results = buildResults(query, []);
    clampSelection();
    render();

    clearTimeout(historyTimer);
    if (!query.trim()) return;
    historyTimer = setTimeout(async () => {
      const hist = await fetchHistory(query.trim());
      if (token !== queryToken) return; // a newer keystroke superseded this
      results = buildResults(query, hist);
      clampSelection();
      render();
    }, 110);
  }

  function clampSelection() {
    if (selected >= results.length) selected = results.length - 1;
    if (selected < 0) selected = 0;
  }

  // ---------- Actions ----------

  async function activate(item) {
    if (!item) return;
    close();
    if (item.type === "tab") {
      await api.runtime.sendMessage({ type: "activateTab", tabId: item.tabId, windowId: item.windowId });
    } else {
      await api.runtime.sendMessage({ type: "openUrl", url: item.url, newTab: true });
    }
  }

  // Cmd+Enter: force search/open-URL regardless of which row is highlighted.
  function forceSearchOrUrl() {
    const q = input.value.trim();
    if (!q) return;
    const url = looksLikeUrl(q) ? normalizeUrl(q) : googleUrl(q);
    close();
    api.runtime.sendMessage({ type: "openUrl", url, newTab: true });
  }

  // ---------- Keyboard ----------
  // Captured at the window level so the host page (e.g. GitHub's single-key
  // hotkeys) never sees keystrokes while the palette is open. We only act on our
  // navigation keys; everything else still types into the input via its default
  // action — stopImmediatePropagation blocks page listeners, not text entry.

  function onKeyCapture(e) {
    if (!isOpen) return;
    e.stopImmediatePropagation();
    if (e.type !== "keydown") return;
    handleKey(e);
  }

  function handleKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      selected = Math.min(selected + 1, results.length - 1);
      paintSelection();
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      paintSelection();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) forceSearchOrUrl();
      else activate(results[selected]);
    }
  }

  window.addEventListener("keydown", onKeyCapture, true);
  window.addEventListener("keypress", onKeyCapture, true);
  window.addEventListener("keyup", onKeyCapture, true);

  // ---------- UI ----------

  const STYLES = `
    :host { all: initial; }
    .cc-backdrop {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.32);
      display: flex; align-items: flex-start; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    .cc-panel {
      margin-top: 14vh; width: min(680px, 92vw);
      background: #1e1f26; color: #e9e9ee;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.55);
      overflow: hidden;
      animation: cc-pop 0.09s ease-out;
    }
    @keyframes cc-pop { from { transform: translateY(-6px); opacity: 0.6; } to { transform: none; opacity: 1; } }
    .cc-input {
      width: 100%; box-sizing: border-box;
      padding: 18px 20px; border: none; outline: none;
      background: transparent; color: #f4f4f7;
      font-size: 19px; line-height: 1.2;
    }
    .cc-input::placeholder { color: #8a8b96; }
    .cc-list {
      max-height: 52vh; overflow-y: auto;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .cc-list:empty { display: none; }
    .cc-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; cursor: pointer;
    }
    .cc-row.cc-sel { background: #3a6df0; }
    .cc-row.cc-sel .cc-sub, .cc-row.cc-sel .cc-badge { color: rgba(255,255,255,0.82); }
    .cc-icon {
      width: 20px; height: 20px; flex: 0 0 20px;
      display: flex; align-items: center; justify-content: center;
    }
    .cc-fav { width: 16px; height: 16px; border-radius: 3px; }
    .cc-glyph { display: flex; align-items: center; justify-content: center; color: #b9bac4; }
    .cc-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .cc-title { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cc-sub { font-size: 12px; color: #9a9ba6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cc-badge { font-size: 11px; color: #8a8b96; flex: 0 0 auto; padding-left: 8px; }
    .cc-empty { padding: 18px 20px; color: #8a8b96; font-size: 14px; }
    .cc-foot {
      display: flex; gap: 16px; padding: 8px 16px;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-size: 11px; color: #7d7e88;
    }
    .cc-foot b { color: #b9bac4; font-weight: 600; }
  `;

  function buildUI() {
    host = document.createElement("div");
    host.id = "command-center-host";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLES;

    const backdrop = document.createElement("div");
    backdrop.className = "cc-backdrop";
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });

    const panel = document.createElement("div");
    panel.className = "cc-panel";

    input = document.createElement("input");
    input.className = "cc-input";
    input.type = "text";
    input.placeholder = "Search tabs, history…  ⌘↵ to Google / open URL";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.addEventListener("input", recompute);

    list = document.createElement("div");
    list.className = "cc-list";

    footer = document.createElement("div");
    footer.className = "cc-foot";
    footer.innerHTML =
      "<span><b>↑↓</b> navigate</span><span><b>↵</b> open</span>" +
      "<span><b>⌘↵</b> Google / URL</span><span><b>esc</b> close</span>";

    panel.appendChild(input);
    panel.appendChild(list);
    panel.appendChild(footer);
    backdrop.appendChild(panel);
    shadow.appendChild(style);
    shadow.appendChild(backdrop);
  }

  async function open() {
    if (isOpen) return;
    isOpen = true;
    if (!host) buildUI();
    (document.body || document.documentElement).appendChild(host);
    selected = 0;
    input.value = "";
    await refreshTabs();
    if (!isOpen) return; // closed while awaiting
    recompute();
    requestAnimationFrame(() => input && input.focus());
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(historyTimer);
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // ---------- Message from background (Cmd+K / toolbar button) ----------

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "toggle") {
      toggle();
      return Promise.resolve({ ok: true });
    }
  });
})();
