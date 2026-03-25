import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';
import { ProxyServer } from './ProxyServer';

let proxyServer: ProxyServer | undefined;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  console.log('HTML Live Highlighter is now active');

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'html-highlighter.openPreview';
  statusBarItem.tooltip = 'Open HTML Live Highlighter Preview';
  context.subscriptions.push(statusBarItem);

  // Start proxy server on activation
  await startProxy(context);

  // ── Commands ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('html-highlighter.openPreview', () => {
      // ① Feed the current file to the proxy BEFORE showing the panel
      const editor = vscode.window.activeTextEditor;
      const config = vscode.workspace.getConfiguration('htmlHighlighter');
      if (editor && editor.document.languageId === 'html' && !config.get<string>('targetUrl', '')) {
        proxyServer?.setStaticContent(editor.document.getText(), editor.document.uri.fsPath);
      }
      PreviewPanel.createOrShow(context, proxyServer!);
    }),

    vscode.commands.registerCommand('html-highlighter.setTargetUrl', async () => {
      const config = vscode.workspace.getConfiguration('htmlHighlighter');
      const current = config.get<string>('targetUrl', '');
      const input = await vscode.window.showInputBox({
        prompt: 'Enter the target server URL (e.g. http://127.0.0.1:8000) or leave empty for static file mode',
        value: current,
        placeHolder: 'http://127.0.0.1:8000',
      });
      if (input !== undefined) {
        await config.update('targetUrl', input, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`HTML Highlighter target set to: ${input || '(static file mode)'}`);
        await restartProxy(context);
      }
    }),

    vscode.commands.registerCommand('html-highlighter.restartProxy', async () => {
      await restartProxy(context);
      vscode.window.showInformationMessage('HTML Highlighter proxy restarted.');
    }),
  );

  // ── Cursor change → highlight ──────────────────────────────
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const editor = event.textEditor;
      if (editor.document.languageId !== 'html') {
        return;
      }
      const position = editor.selection.active;
      proxyServer?.broadcastCursorPosition(editor.document.getText(), position.line, position.character);
    })
  );

  // ── Live reload on document change ────────────────────────
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== 'html') {
        return;
      }
      const config = vscode.workspace.getConfiguration('htmlHighlighter');
      if (!config.get<boolean>('liveReload', true)) {
        return;
      }
      const delay = config.get<number>('reloadDelay', 300);
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        const targetUrl = config.get<string>('targetUrl', '');
        if (targetUrl) {
          // External server mode: just signal a reload
          proxyServer?.broadcastReload();
        } else {
          // Static file mode: update content directly
          proxyServer?.setStaticContent(event.document.getText(), event.document.uri.fsPath);
          proxyServer?.broadcastReload();
        }
      }, delay);
    })
  );

  // ── Active tab change → reload proxy with new file ──────
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || editor.document.languageId !== 'html') {
        return;
      }
      const config = vscode.workspace.getConfiguration('htmlHighlighter');
      if (!config.get<string>('targetUrl', '')) {
        proxyServer?.setStaticContent(editor.document.getText(), editor.document.uri.fsPath);
        proxyServer?.broadcastReload();
      }
    })
  );

  updateStatusBar();
}

async function startProxy(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('htmlHighlighter');
  const port = config.get<number>('proxyPort', 3131);
  const targetUrl = config.get<string>('targetUrl', '');

  proxyServer = new ProxyServer(context, port, targetUrl);
  await proxyServer.start();
  updateStatusBar(port, targetUrl);
}

async function restartProxy(context: vscode.ExtensionContext): Promise<void> {
  if (proxyServer) {
    await proxyServer.stop();
  }
  await startProxy(context);
  PreviewPanel.reload();
}

function updateStatusBar(port?: number, targetUrl?: string): void {
  if (port && targetUrl) {
    statusBarItem.text = `⚡ Preview: :${port} → ${new URL(targetUrl).host}`;
  } else if (port) {
    statusBarItem.text = `⚡ Preview: :${port} (static)`;
  } else {
    statusBarItem.text = `⚡ HTML Highlighter`;
  }
  statusBarItem.show();
}

export function deactivate(): Promise<void> {
  return proxyServer?.stop() ?? Promise.resolve();
}
