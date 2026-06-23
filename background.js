// Command Center — background script.
// Owns the privileged tabs/history APIs; the overlay (content script) talks to it via messages.

const api = typeof browser !== "undefined" ? browser : chrome;

// --- Trigger: keyboard command (Cmd+Shift+M) and toolbar button both toggle the palette ---

api.commands.onCommand.addListener((command) => {
  if (command === "toggle-palette") togglePalette();
});

api.browserAction.onClicked.addListener(() => togglePalette());

async function togglePalette() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await api.tabs.sendMessage(tab.id, { type: "toggle" });
  } catch (e) {
    // No content script on this page (about:, addons.mozilla.org, view-source, etc.).
    // Nothing we can do — the overlay can't be injected on privileged pages.
  }
}

// --- Requests from the overlay ---

api.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "getTabs":
      return getTabs();
    case "searchHistory":
      return api.history.search({
        text: msg.text || "",
        startTime: 0,
        maxResults: 80
      });
    case "activateTab":
      return activateTab(msg.tabId, msg.windowId);
    case "openUrl":
      return openUrl(msg.url, msg.newTab);
    case "closeTab":
      return api.tabs.remove(msg.tabId);
    case "favicon":
      return getFavicon(msg.host);
    default:
      return false;
  }
});

// --- Favicons ---
// Fetched here (the background has no page CSP) and returned as a data: URL so the
// in-page overlay can render them even on strict-CSP sites. Cached per host.

const faviconCache = new Map();

async function getFavicon(host) {
  if (!host) return null;
  if (faviconCache.has(host)) return faviconCache.get(host);
  let dataUrl = null;
  try {
    const res = await fetch("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(host) + ".ico");
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) dataUrl = await blobToDataUrl(blob);
    }
  } catch (e) {
    dataUrl = null;
  }
  faviconCache.set(host, dataUrl);
  return dataUrl;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function getTabs() {
  const tabs = await api.tabs.query({});
  // Lightweight payload; most-recently-used first so an empty query shows useful defaults.
  return tabs
    .map((t) => ({
      id: t.id,
      windowId: t.windowId,
      title: t.title || t.url || "",
      url: t.url || "",
      favIconUrl: t.favIconUrl || "",
      active: t.active,
      lastAccessed: t.lastAccessed || 0
    }))
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
}

async function activateTab(tabId, windowId) {
  await api.tabs.update(tabId, { active: true });
  if (windowId != null) await api.windows.update(windowId, { focused: true });
}

async function openUrl(url, newTab) {
  if (newTab) {
    await api.tabs.create({ url, active: true });
  } else {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab) await api.tabs.update(tab.id, { url });
    else await api.tabs.create({ url, active: true });
  }
}
