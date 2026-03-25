import * as vscode from 'vscode';
import { ProxyServer } from './ProxyServer';

export class PreviewPanel {
  private static instance: PreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private proxyServer: ProxyServer;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private context: vscode.ExtensionContext,
    proxyServer: ProxyServer,
  ) {
    this.panel = panel;
    this.proxyServer = proxyServer;

    this.panel.onDidDispose(
      () => this.dispose(),
      null,
      this.disposables,
    );

    this.panel.webview.html = this.getWebviewContent();
  }

  // ── Static API ──────────────────────────────────────────────────────────────

  static createOrShow(context: vscode.ExtensionContext, proxyServer: ProxyServer): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (PreviewPanel.instance) {
      PreviewPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      PreviewPanel.instance.proxyServer = proxyServer;
      PreviewPanel.instance.panel.webview.html = PreviewPanel.instance.getWebviewContent();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'htmlHighlighter',
      'HTML Live Highlighter',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        // Allow the iframe to load localhost content
        localResourceRoots: [],
        retainContextWhenHidden: true,
      },
    );

    PreviewPanel.instance = new PreviewPanel(panel, context, proxyServer);
  }

  /** Reload the iframe (called after proxy restart) */
  static reload(): void {
    if (PreviewPanel.instance) {
      PreviewPanel.instance.panel.webview.postMessage({ type: 'reload' });
    }
  }

  // ── Webview HTML ─────────────────────────────────────────────────────────────

  private getWebviewContent(): string {
    const config = vscode.workspace.getConfiguration('htmlHighlighter');
    const port = config.get<number>('proxyPort', 3131);
    const proxyUrl = `http://127.0.0.1:${port}/`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    frame-src http://127.0.0.1:*;
    script-src 'unsafe-inline';
    style-src 'unsafe-inline';
  ">
  <title>HTML Live Highlighter</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #1e1e2e;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }

    /* ── Toolbar ─────── */
    #toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #181825;
      border-bottom: 1px solid #313244;
      flex-shrink: 0;
    }
    #url-bar {
      flex: 1;
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 4px;
      color: #cdd6f4;
      font-size: 12px;
      padding: 4px 10px;
      outline: none;
    }
    #url-bar:focus { border-color: #4db6f0; }
    .tb-btn {
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 4px;
      color: #cdd6f4;
      cursor: pointer;
      font-size: 13px;
      padding: 3px 8px;
      line-height: 1;
      transition: background 0.15s;
    }
    .tb-btn:hover { background: #45475a; }

    /* ── Iframe ──────── */
    #preview-frame {
      flex: 1;
      border: none;
      width: 100%;
      background: #fff;
    }

    /* ── Status bar ─── */
    #status {
      padding: 2px 10px;
      font-size: 11px;
      color: #6c7086;
      background: #181825;
      border-top: 1px solid #313244;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <button class="tb-btn" id="btn-back" title="Back">◀</button>
    <button class="tb-btn" id="btn-fwd" title="Forward">▶</button>
    <button class="tb-btn" id="btn-reload" title="Reload">↺</button>
    <input id="url-bar" type="text" value="${proxyUrl}" spellcheck="false">
    <button class="tb-btn" id="btn-go" title="Navigate">Go</button>
  </div>

  <iframe id="preview-frame" src="${proxyUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>

  <div id="status">⚡ HTML Live Highlighter — proxy: ${proxyUrl}</div>

  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('preview-frame');
    const urlBar = document.getElementById('url-bar');
    const status = document.getElementById('status');

    // ── Toolbar controls ────────────────────────────────────
    document.getElementById('btn-back').onclick = () => frame.contentWindow.history.back();
    document.getElementById('btn-fwd').onclick = () => frame.contentWindow.history.forward();
    document.getElementById('btn-reload').onclick = () => frame.contentWindow.location.reload();
    document.getElementById('btn-go').onclick = navigate;
    urlBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(); });

    function navigate() {
      let url = urlBar.value.trim();
      if (!url.startsWith('http')) url = 'http://' + url;
      frame.src = url;
    }

    // ── Keep URL bar in sync with frame navigation ─────────
    frame.addEventListener('load', () => {
      try {
        urlBar.value = frame.contentWindow.location.href;
        status.textContent = '⚡ ' + frame.contentWindow.location.href;
      } catch {
        // cross-origin frame
      }
    });

    // ── Messages from extension (reload) ───────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'reload') {
        frame.contentWindow.location.reload();
      }
    });
  </script>
</body>
</html>`;
  }

  // ── Disposal ─────────────────────────────────────────────────────────────────

  private dispose(): void {
    PreviewPanel.instance = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
