/**
 * HTML Live Highlighter — Browser-side script
 * Injected by the proxy into every HTML page served in the preview.
 * Communicates with the VS Code extension via WebSocket.
 */
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  const script = document.currentScript;
  const WS_PORT = script ? (script.dataset.wsPort || '3131') : '3131';
  const WS_URL = `ws://127.0.0.1:${WS_PORT}/__ws__`;
  const RECONNECT_DELAY = 1500;

  // ── State ───────────────────────────────────────────────────────────────────
  let ws = null;
  let overlay = null;
  let tooltip = null;
  let currentElement = null;
  let highlightColor = '#4db6f0';
  let showTooltip = true;
  let syncScroll = true;

  // ── DOM helpers ──────────────────────────────────────────────────────────────
  function createOverlay() {
    const el = document.createElement('div');
    el.id = '__hl-overlay__';
    el.style.setProperty('--hl-color', highlightColor);
    document.body.appendChild(el);
    return el;
  }

  function createTooltip() {
    const el = document.createElement('div');
    el.id = '__hl-tooltip__';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }

  function getOrCreate() {
    overlay = document.getElementById('__hl-overlay__') || createOverlay();
    tooltip = document.getElementById('__hl-tooltip__') || createTooltip();
  }

  function showOverlay(el, color, tag, id, classes, dims) {
    getOrCreate();
    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    overlay.style.setProperty('--hl-color', color);
    overlay.style.display = 'block';
    overlay.style.top = (rect.top + scrollY) + 'px';
    overlay.style.left = (rect.left + scrollX) + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.position = 'absolute';

    if (showTooltip) {
      let html = `<span class="hl-tag">${tag}</span>`;
      if (id) html += `<span class="hl-id">#${id}</span>`;
      if (classes && classes.length) html += `<span class="hl-cls">.${classes.join('.')}</span>`;
      html += `<span class="hl-dims">${Math.round(rect.width)}×${Math.round(rect.height)}</span>`;
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      // Position tooltip above the element, or below if near top
      const tooltipTop = rect.top + scrollY - 28;
      tooltip.style.top = (tooltipTop < scrollY + 4 ? rect.bottom + scrollY + 4 : tooltipTop) + 'px';
      tooltip.style.left = Math.min(rect.left + scrollX, document.body.scrollWidth - 300) + 'px';
    }
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
    currentElement = null;
  }

  // ── Selector resolution ──────────────────────────────────────────────────────
  function resolveSelector(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }


  // ── WebSocket ────────────────────────────────────────────────────────────────
  function sendMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function connect() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      setTimeout(connect, RECONNECT_DELAY);
      return;
    }

    ws.addEventListener('open', function () {
      console.log('[HTML Highlighter] Connected to VS Code proxy.');
    });

    ws.addEventListener('message', function (event) {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleMessage(msg);
    });

    ws.addEventListener('close', function () {
      console.log('[HTML Highlighter] WS closed. Reconnecting...');
      setTimeout(connect, RECONNECT_DELAY);
    });

    ws.addEventListener('error', function () {
      ws.close();
    });
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'highlight': {
        highlightColor = msg.color || '#4db6f0';
        showTooltip = msg.showTooltip !== false;
        syncScroll = msg.syncScroll !== false;

        const el = resolveSelector(msg.selector);
        if (!el) {
          hideOverlay();
          return;
        }
        currentElement = el;
        showOverlay(el, highlightColor, msg.tag || '', msg.id || '', msg.classes || [], null);

        if (syncScroll) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        break;
      }
      case 'clearHighlight':
        hideOverlay();
        break;
      case 'reload':
        window.location.reload();
        break;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
