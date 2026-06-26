# Command Center

> A Spotlight/Alfred-style command palette for Firefox. Press **Cmd+Shift+Space**,
> fuzzy-search your open tabs and history, and jump — or hit **Cmd+Enter** to
> Google-search or open a URL.

[![Get the add-on](https://img.shields.io/badge/Firefox%20Add--ons-Install-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/firefox/addon/command-center/)
[![AMO version](https://img.shields.io/amo/v/command-center?label=amo&color=FF7139)](https://addons.mozilla.org/firefox/addon/command-center/)
[![AMO users](https://img.shields.io/amo/users/command-center)](https://addons.mozilla.org/firefox/addon/command-center/)
[![CI](https://github.com/jagajaga/command-center/actions/workflows/ci.yml/badge.svg)](https://github.com/jagajaga/command-center/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/jagajaga/command-center)](https://github.com/jagajaga/command-center/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Command Center in action](docs/screenshot.png)

## Install

- **[Firefox Add-ons (recommended)](https://addons.mozilla.org/firefox/addon/command-center/)** —
  one-click install with automatic updates. *(Goes live once Mozilla approves
  the first release.)*
- **[Latest GitHub release](https://github.com/jagajaga/command-center/releases/latest)** —
  download the signed `.xpi` and drag it onto a Firefox window (or `about:addons`
  → ⚙️ → **Install Add-on From File…**). The Mozilla-signed build is attached to
  each release once that version has been signed.

Then press **Cmd+Shift+Space** on any normal web page.

> Building from source? See [Development](#development) for loading it
> temporarily without signing.

## Usage

| Keys | Action |
|------|--------|
| **Cmd+Shift+Space** (`Ctrl+Shift+Space` on Win/Linux) | Open / close the palette |
| *type* | Fuzzy-search open **tabs** first, then **history** |
| **↑ / ↓** (or `Ctrl+P` / `Ctrl+N`) | Move selection |
| **Enter** | Switch to the tab, or open the history/URL result in a new tab |
| **Cmd+Enter** | Ignore the list — open what you typed as a URL, else Google it |
| **Cmd+Backspace** (`Ctrl+Backspace`) / hover **×** | Close the highlighted tab |
| **Esc** / click outside | Close |

Looks-like-a-URL detection covers `example.com`, `localhost:3000`,
`https://…`; anything else becomes a Google search.

### Settings

Open the add-on's **Settings** (`about:addons` → **Extensions** → Command Center
→ **Preferences/Settings**) to:

- **Rebind the shortcut** to anything — click the field, press your combo, **Apply**.
- **Set how many results** are shown (default **10**).

You can also rebind from `about:addons` → gear ⚙️ → **Manage Extension Shortcuts**.
If a combo is already used by a built-in Firefox shortcut, it'll be rejected —
pick another (anything with <kbd>Ctrl</kbd>/<kbd>Alt</kbd>/<kbd>⌘</kbd>).

## Features

- ⚡ **Tabs-first fuzzy ranking** — a subsequence scorer with bonuses for
  consecutive matches and word/segment boundaries, so `gcc` finds
  `github.com/.../command-center`.
- 🔎 **History fallback**, de-duplicated against your open tabs.
- 🌐 **Site icons** next to every result.
- 🎯 **Cmd+Enter** to go straight to a Google search or URL.
- ❌ **Close tabs** without leaving the palette — Cmd/Ctrl+Backspace or the hover ×.
- ⚙️ **Settings page** — rebind the shortcut and choose how many results to show.
- 🛡️ **Isolated overlay** — rendered in a Shadow DOM and grabs keystrokes at the
  `window` capture level, so the underlying page's shortcuts (e.g. GitHub's
  single-key hotkeys) never fire while it's open.

## Permissions & privacy

| Permission | Why |
|------------|-----|
| `tabs` | List, switch between, and close your open tabs |
| `history` | Search your browsing history |
| `storage` | Save your settings (shortcut display, result count) |
| `<all_urls>` (content script) | Draw the overlay on any page |
| `https://icons.duckduckgo.com/*` | Fetch favicons |

Favicons are fetched in the background from DuckDuckGo and rendered as `data:`
URLs (so they work even on strict-CSP sites). This means the **hostnames** of
your results are sent to DuckDuckGo. Nothing else leaves your machine — no
analytics, no accounts. To disable it, remove the `icons.duckduckgo.com`
permission from `manifest.json`; results fall back to a globe glyph.

## How it works

| File | Role |
|------|------|
| `manifest.json` | Permissions, the Cmd+Shift+Space command, content-script registration |
| `background.js` | Privileged `tabs`/`history` APIs, tab switching/opening/closing, favicon fetch + cache, relays the command to the active tab |
| `content.js` | Shadow-DOM overlay, fuzzy ranking, keyboard handling, rendering |
| `options.html` / `options.js` | Settings page (shortcut rebinding via `commands.update`, result count in `storage`) |
| `icon.svg` | Toolbar / add-on icon |

The keyboard shortcut isn't a built-in Firefox combo, so it binds on install;
rebind it anytime (see [Settings](#settings)).

> The overlay can't be injected on privileged pages Firefox blocks extensions
> from (`about:*`, `addons.mozilla.org`, `view-source:`, the PDF viewer). The
> toolbar button is a backup trigger.

## Development

```sh
# Lint (same check CI runs)
npx web-ext lint --source-dir . --self-hosted \
  --ignore-files ".github/**" "docs/**" "*.md" "LICENSE"

# Run in a scratch Firefox profile with live reload
npx web-ext run --source-dir .
```

Or load it manually for a one-off test: `about:debugging#/runtime/this-firefox`
→ **Load Temporary Add-on…** → pick `manifest.json` (removed when Firefox
restarts, no signing needed).

## Releasing

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).
To cut one:

1. Bump `version` in `manifest.json` (AMO rejects a re-used version).
2. Commit, then tag and push:
   ```sh
   git tag v1.2.3 && git push origin v1.2.3
   ```

CI then lints, submits the version to Firefox Add-ons for review (listed
channel), and publishes a GitHub Release with auto-generated notes and a source
zip. Signing uses the `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` repository secrets.

## License

[MIT](LICENSE) © jagajaga
