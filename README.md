# HTML Live Highlighter

**Live preview with real-time element highlighting — like browser DevTools, right inside VS Code.**

Move your cursor over any HTML tag and instantly see that element highlighted in the preview panel. Works with static HTML files and external development servers like Django, Flask, or Express.

---

## Features

### 🔵 DevTools-Style Element Highlighting
As you navigate your HTML source code, the element under the cursor is highlighted in the live preview with a blue overlay and a tooltip showing the tag name, `id`, classes, and dimensions — exactly like Chrome DevTools.

### ⚡ Live Preview Panel
An embedded preview panel opens directly alongside your editor. No need to switch to a browser window. Includes a simple toolbar with **Back**, **Forward**, **Reload**, and a URL bar.

### 🔄 Live Reload
The preview updates automatically as you type, with a configurable debounce delay. No need to manually save or refresh.

### 🌐 External Server Support (Django, Flask, Express…)
Unlike other preview extensions, HTML Live Highlighter routes requests through a **local HTTP proxy** that injects the highlighting script into every HTML response. This means it works seamlessly with any framework that runs its own development server.

| Mode | How to use |
|---|---|
| Static HTML file | Open an `.html` file → Run `HTML Highlighter: Open Preview` |
| External server (Django, Flask…) | Run `HTML Highlighter: Set Target URL` → enter `http://127.0.0.1:8000` |

### 📜 Scroll Sync
When the highlighted element changes, the preview automatically scrolls to bring it into view.

---

## Getting Started

1. Open any `.html` file in VS Code.
2. Run the command **`HTML Highlighter: Open Preview`** from the Command Palette (`Ctrl+Shift+P`).
3. Move your cursor around the HTML — watch the element highlight update in real time.

### For Django / Flask / Express

1. Start your development server (e.g. `python manage.py runserver`).
2. Run **`HTML Highlighter: Set Target URL`** and enter the server URL (e.g. `http://127.0.0.1:8000`).
3. Run **`HTML Highlighter: Open Preview`**.

The proxy will intercept HTML responses and inject the highlighting script automatically. You can navigate between pages within the preview and the script stays active.

---

## Commands

| Command | Description |
|---|---|
| `HTML Highlighter: Open Preview` | Open the preview panel beside the editor |
| `HTML Highlighter: Set Target URL` | Point the proxy to an external server |
| `HTML Highlighter: Restart Proxy` | Restart the local proxy server |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `htmlHighlighter.targetUrl` | `""` | URL of the external server. Leave empty for static file mode. |
| `htmlHighlighter.proxyPort` | `3131` | Local port for the proxy server. |
| `htmlHighlighter.liveReload` | `true` | Reload the preview automatically on file changes. |
| `htmlHighlighter.reloadDelay` | `300` | Debounce delay in milliseconds before triggering a reload. |
| `htmlHighlighter.showTooltip` | `true` | Show a DevTools-style tooltip with tag, id, classes, and dimensions. |
| `htmlHighlighter.highlightColor` | `#4db6f0` | Color of the element highlight overlay. |
| `htmlHighlighter.syncScroll` | `true` | Auto-scroll the preview to keep the highlighted element visible. |

---

## How It Works

HTML Live Highlighter starts a **local HTTP proxy** on `localhost:3131`. The preview panel loads an iframe pointing to this proxy. For every HTML response (whether from a static file or a remote server), the proxy injects a small script (`highlight.js`) that:

1. Opens a **WebSocket** connection back to the proxy.
2. Listens for `highlight` messages containing a CSS selector.
3. Applies a DevTools-style overlay and tooltip to the matching DOM element.

On the editor side, every cursor movement triggers an HTML parse (using [`htmlparser2`](https://github.com/fb55/htmlparser2)) to find the element at the cursor position and generate its CSS selector, which is broadcast to all connected preview clients.

---

## Known Limitations

- **Django templates:** The mapping between cursor position and rendered element is based on the template source. Elements generated dynamically by template tags (`{% for %}`, `{% if %}`, etc.) may not highlight precisely.
- **HTTPS external servers:** The proxy currently supports HTTP targets only.
- **Iframes within the page:** Content inside nested iframes is not highlighted.

---

## Requirements

- VS Code `1.85.0` or higher
- Node.js (bundled with VS Code — no separate installation required)

---

## License

MIT
