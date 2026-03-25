import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { HtmlParser } from './HtmlParser';

/** Minimal MIME type lookup (no extra dependency needed) */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.eot':  'application/vnd.ms-fontobject',
    '.webp': 'image/webp',
    '.mp4':  'video/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}

const INJECTED_ROUTE = '/__highlighter__';

/** Reads a media file bundled with the extension */
function readMediaFile(context: vscode.ExtensionContext, filename: string): string {
  const filePath = context.asAbsolutePath(path.join('media', filename));
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Injects the highlighter script + css just before </body>
 */
function injectScript(html: string, port: number): string {
  const tag = `
<link rel="stylesheet" href="${INJECTED_ROUTE}/highlight.css">
<script src="${INJECTED_ROUTE}/highlight.js" data-ws-port="${port}"></script>`;
  return html.replace(/<\/body>/i, `${tag}\n</body>`);
}

export class ProxyServer {
  private server: http.Server | undefined;
  private wss: WebSocketServer | undefined;
  private clients: Set<WebSocket> = new Set();
  private staticHtml: string = '';
  private staticFilePath: string = '';
  private parser: HtmlParser = new HtmlParser();

  constructor(
    private context: vscode.ExtensionContext,
    private port: number,
    private targetUrl: string,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestHandler = this.targetUrl
        ? this.createProxyHandler()
        : this.createStaticHandler();

      this.server = http.createServer(requestHandler);

      // Attach WebSocket server to the same HTTP server
      this.wss = new WebSocketServer({ server: this.server, path: '/__ws__' });
      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
        ws.on('message', (raw) => this.handleClientMessage(raw.toString()));
      });

      this.server.on('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`HTML Highlighter proxy running on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.clients.forEach((ws) => ws.terminate());
      this.clients.clear();
      this.wss?.close();
      this.server?.close(() => resolve());
    });
  }

  setStaticContent(html: string, filePath: string): void {
    this.staticHtml = html;
    this.staticFilePath = filePath;
  }

  broadcastReload(): void {
    this.broadcast({ type: 'reload' });
  }

  broadcastCursorPosition(html: string, line: number, col: number): void {
    const node = this.parser.findNodeAtPosition(html, line, col);
    if (!node) {
      return;
    }
    const selector = this.parser.generateSelector(node);
    const config = vscode.workspace.getConfiguration('htmlHighlighter');
    this.broadcast({
      type: 'highlight',
      selector,
      tag: node.tagName,
      id: node.id,
      classes: node.classes,
      showTooltip: config.get<boolean>('showTooltip', true),
      color: config.get<string>('highlightColor', '#4db6f0'),
      syncScroll: config.get<boolean>('syncScroll', true),
    });
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  /** Serves static .html files (no external server) */
  private createStaticHandler(): http.RequestListener {
    return (req, res) => {
      const url = req.url ?? '/';

      // Serve highlighter assets first
      if (url.startsWith(INJECTED_ROUTE)) {
        return this.serveAsset(url, res);
      }

      // Root request → serve the HTML document
      if (url === '/' || url === '/index.html') {
        const html = this.staticHtml
          || '<html><body><p>Open an HTML file and run "HTML Highlighter: Open Preview".</p></body></html>';
        const injected = injectScript(html, this.port);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(injected);
        return;
      }

      // Any other request → try to serve relative assets from the HTML file's directory
      if (this.staticFilePath) {
        const htmlDir = path.dirname(this.staticFilePath);
        // Strip query string and leading slash, then resolve safely
        const relPath = decodeURIComponent(url.split('?')[0].replace(/^\/+/, ''));
        const absPath = path.resolve(htmlDir, relPath);

        // Security: don't allow path traversal outside the workspace
        if (!absPath.startsWith(path.resolve(htmlDir))) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
          const ct = getMimeType(absPath);
          res.writeHead(200, { 'Content-Type': ct });
          fs.createReadStream(absPath).pipe(res);
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    };
  }

  /** Proxies requests to the target URL, injecting script in HTML responses */
  private createProxyHandler(): http.RequestListener {
    const target = new URL(this.targetUrl);

    return (req, res) => {
      const url = req.url ?? '/';

      // Serve highlighter assets locally (don't forward to Django)
      if (url.startsWith(INJECTED_ROUTE)) {
        return this.serveAsset(url, res);
      }

      const options: http.RequestOptions = {
        hostname: target.hostname,
        port: target.port || 80,
        path: url,
        method: req.method,
        headers: {
          ...req.headers,
          host: target.host,
        },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] ?? '';
        const isHtml = contentType.includes('text/html');

        if (isHtml) {
          // Buffer the response to inject the script
          let body = '';
          proxyRes.setEncoding('utf8');
          proxyRes.on('data', (chunk) => (body += chunk));
          proxyRes.on('end', () => {
            const injected = injectScript(body, this.port);
            const headers = { ...proxyRes.headers };
            // Remove headers that would block iframe embedding or break script injection
            delete headers['content-encoding'];       // we re-encode the body
            delete headers['content-length'];         // length changes after injection
            delete headers['x-frame-options'];        // Django SAMEORIGIN blocks iframe
            delete headers['content-security-policy'];// Django CSP may block our script
            delete headers['x-content-type-options']; // allow sniffing for injected types
            headers['content-type'] = 'text/html; charset=utf-8';
            res.writeHead(proxyRes.statusCode ?? 200, headers);
            res.end(injected);
          });
        } else {
          // Pass through non-HTML responses (CSS, JS, images, etc.)
          // Still strip framing-related headers to avoid blocking
          const headers = { ...proxyRes.headers };
          delete headers['x-frame-options'];
          delete headers['content-security-policy'];
          res.writeHead(proxyRes.statusCode ?? 200, headers);
          proxyRes.pipe(res, { end: true });
        }
      });

      proxyReq.on('error', (err) => {
        console.error('Proxy error:', err.message);
        res.writeHead(502);
        res.end(`<html><body><h2>Proxy Error</h2><p>${err.message}</p><p>Is the server running at <strong>${this.targetUrl}</strong>?</p></body></html>`);
      });

      req.pipe(proxyReq, { end: true });
    };
  }

  /** Serves highlight.js / highlight.css from the media folder */
  private serveAsset(url: string, res: http.ServerResponse): void {
    const filename = path.basename(url.split('?')[0]);
    const allowed = ['highlight.js', 'highlight.css'];
    if (!allowed.includes(filename)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const content = readMediaFile(this.context, filename);
      const ct = filename.endsWith('.css') ? 'text/css' : 'application/javascript';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Asset not found');
    }
  }

  // ── WebSocket helpers ────────────────────────────────────────────────────────

  private broadcast(message: object): void {
    const data = JSON.stringify(message);
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  /** Handle messages sent FROM the browser — reserved for future use */
  private handleClientMessage(_raw: string): void {
    // Reverse flow (preview → editor) removed by design.
  }
}
