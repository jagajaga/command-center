// Command Center — settings page.
// - Rebinds the toggle shortcut via the commands API (commands.update / reset).
// - Stores the max-results preference in storage.local (read by the content script).

const api = typeof browser !== "undefined" ? browser : chrome;
const COMMAND = "toggle-palette";
const DEFAULTS = { maxResults: 10 };
const isMac = navigator.platform.toUpperCase().includes("MAC");

const $ = (id) => document.getElementById(id);

function flash(el, text, ok) {
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

// ---- Shortcut ----

function keyName(e) {
  if (e.key === " " || e.code === "Space") return "Space";
  if (e.key.length === 1) {
    if (/[a-z]/i.test(e.key)) return e.key.toUpperCase();
    if (/[0-9]/.test(e.key)) return e.key;
    if (e.key === ",") return "Comma";
    if (e.key === ".") return "Period";
  }
  const map = {
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    Insert: "Insert", Delete: "Delete"
  };
  if (map[e.key]) return map[e.key];
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return e.key;
  return null;
}

// Build a WebExtension shortcut string ("Ctrl+Shift+Space") from a keydown.
function formatShortcut(e) {
  const key = keyName(e);
  if (!key) return null; // modifier-only press → keep waiting
  const mods = [];
  if (e.ctrlKey) mods.push(isMac ? "MacCtrl" : "Ctrl");
  if (e.metaKey) mods.push("Command");
  if (e.altKey) mods.push("Alt");
  const isFn = /^F([1-9]|1[0-2])$/.test(key);
  if (!mods.length && !isFn) return ""; // needs a primary modifier
  if (e.shiftKey) mods.push("Shift");
  return [...mods, key].join("+");
}

async function showCurrent() {
  try {
    const cmds = await api.commands.getAll();
    const c = cmds.find((x) => x.name === COMMAND);
    $("current").textContent = (c && c.shortcut) || "(unset)";
  } catch (e) {
    $("current").textContent = "(unavailable)";
  }
}

function wireShortcut() {
  const capture = $("capture");
  capture.addEventListener("keydown", (e) => {
    e.preventDefault();
    const s = formatShortcut(e);
    if (s === null) return; // modifier-only, wait
    if (s === "") {
      capture.value = "";
      capture.dataset.shortcut = "";
      flash($("shortcutMsg"), "Add a modifier (Ctrl / Alt / ⌘).", false);
      return;
    }
    capture.value = s;
    capture.dataset.shortcut = s;
    $("shortcutMsg").textContent = "";
  });

  $("apply").addEventListener("click", async () => {
    const s = capture.dataset.shortcut;
    if (!s) {
      flash($("shortcutMsg"), "Click the field and press a shortcut first.", false);
      return;
    }
    try {
      await api.commands.update({ name: COMMAND, shortcut: s });
      capture.value = "";
      capture.dataset.shortcut = "";
      await showCurrent();
      flash($("shortcutMsg"), "Saved.", true);
    } catch (err) {
      flash($("shortcutMsg"), "Couldn't set that combo: " + (err && err.message ? err.message : err), false);
    }
  });

  $("reset").addEventListener("click", async () => {
    try {
      await api.commands.reset(COMMAND);
      capture.value = "";
      capture.dataset.shortcut = "";
      await showCurrent();
      flash($("shortcutMsg"), "Reset to default.", true);
    } catch (err) {
      flash($("shortcutMsg"), "Reset failed: " + (err && err.message ? err.message : err), false);
    }
  });
}

// ---- Max results ----

async function wireMaxResults() {
  const input = $("maxResults");
  const stored = await api.storage.local.get(DEFAULTS);
  input.value = stored.maxResults;
  input.addEventListener("change", async () => {
    let n = parseInt(input.value, 10);
    if (!Number.isFinite(n)) n = DEFAULTS.maxResults;
    n = Math.min(30, Math.max(1, n));
    input.value = n;
    await api.storage.local.set({ maxResults: n });
    flash($("resultsMsg"), "Saved.", true);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  showCurrent();
  wireShortcut();
  wireMaxResults();
});
