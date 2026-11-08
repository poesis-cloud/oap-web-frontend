#!/usr/bin/env node
/**
 * Visual smoke test of the built application, without any new dependency.
 *
 * Serves `dist/` with a tiny static server (SPA fallback), drives a headless Chrome through
 * the DevTools protocol (Node 22 ships a WebSocket client), walks the slice-1 journeys
 * (J4 explorer and preview, J1 launch, J3 gate → validation conversation → decision, J2 run, J4 board, J5 consultation, J6 out of scope) and
 * saves screenshots plus a JSON report. Fails on any console error or uncaught exception.
 *
 *   node tools/smoke.mjs [--out ../../evidence/smoke] [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIST = resolve(here, '..', 'dist');
const OUT = resolve(here, opt('--out', '../../../evidence/smoke'));
const CHROME = opt('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PORT = Number(opt('--port', '4410'));
const CDP_PORT = Number(opt('--cdp-port', '9333'));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

async function serve() {
  const index = await readFile(join(DIST, 'index.html'));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const path = resolve(DIST, `.${decodeURIComponent(url.pathname)}`);
    try {
      // Serve only files inside dist/: a traversal falls through to the SPA index.
      const info = path.startsWith(`${DIST}/`) ? await stat(path) : null;
      if (info && info.isFile()) {
        res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
        res.end(await readFile(path));
        return;
      }
    } catch {
      /* fall through to the SPA index */
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(index);
  });
  await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
  return server;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(
          `exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`,
        );
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(
          `console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`,
        );
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.consoleErrors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails)
      throw new Error(`eval failed: ${result.exceptionDetails.text} :: ${expression.slice(0, 120)}`);
    return result.result.value;
  }
  async waitFor(expression, label, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(`Boolean(${expression})`)) return;
      await sleep(150);
    }
    throw new Error(`timeout waiting for ${label}`);
  }
  async goto(path) {
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` });
    await this.waitFor(`document.querySelector('sai-root main')?.textContent?.trim().length > 20`, `page ${path}`);
    await sleep(400);
  }
  /** In-app navigation: the demo state lives in memory, so a full reload would reset it. */
  async nav(path) {
    const clicked = await this.eval(
      `(() => { const a = document.querySelector('a[href="${path}"], [routerlink="${path}"]'); if (!a) return false; a.click(); return true; })()`,
    );
    if (!clicked) throw new Error(`no in-app link to ${path}`);
    await this.waitFor(`location.pathname === ${JSON.stringify(path)}`, `route ${path}`);
    await sleep(400);
  }
  async click(selector, textIncludes) {
    const clicked = await this.eval(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = ${textIncludes ? `nodes.find(n => n.textContent.includes(${JSON.stringify(textIncludes)}))` : 'nodes[0]'};
      if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`nothing to click for ${selector} ${textIncludes ?? ''}`);
    await sleep(250);
  }
  async type(selector, text) {
    const ok = await this
      .eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
      el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`no field ${selector}`);
    await sleep(120);
  }
  async shot(name, width = 1440, height = 900) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
    await sleep(200);
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    return `${name}.png`;
  }
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const profile = join(tmpdir(), `sai-smoke-${Date.now()}`);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], consoleErrors: [] };
  try {
    let targets = [];
    for (let i = 0; i < 50 && targets.length === 0; i += 1) {
      await sleep(200);
      try {
        targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter((t) => t.type === 'page');
      } catch {
        /* chrome not ready yet */
      }
    }
    if (targets.length === 0) throw new Error('Chrome did not expose a page target');
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok);
      ws.addEventListener('error', fail);
    });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    const step = async (name, fn) => {
      const t = Date.now();
      await fn();
      report.steps.push({ name, ms: Date.now() - t, ok: true });
      console.log(`✓ ${name}`);
    };

    await step('J0 Supervisor empty', async () => {
      await cdp.goto('/supervisor');
      report.screenshots.push(await cdp.shot('01-supervisor-empty'));
    });
    await step('J4 workspace explorer: tree from the structure map, artifact preview', async () => {
      await cdp.nav('/workspace');
      await cdp.waitFor(`document.querySelector('p-tree')`, 'explorer tree');
      report.screenshots.push(await cdp.shot('02-workspace-explorer'));
      await cdp.click('.p-tree-node-content', 'customer-subscriptions-api.feature.md');
      await cdp.waitFor(
        `document.querySelector('sai-artifact-viewer') && document.body.textContent.includes('Acceptance criteria')`,
        'rendered feature',
      );
      report.screenshots.push(await cdp.shot('03-workspace-artifact-md'));
      await cdp.click('.p-tree-node-content', 'product-manifest.yaml');
      await cdp.waitFor(`document.querySelector('sai-data-tree')`, 'yaml tree');
      report.screenshots.push(await cdp.shot('04-workspace-artifact-yaml'));
    });
    await step('J1 new conversation with the scenario intent', async () => {
      await cdp.nav('/conversations');
      await cdp.click('button', 'Use the scenario');
      report.screenshots.push(await cdp.shot('05-conversations-new'));
      await cdp.click('button', 'Start');
      await cdp.waitFor(`location.pathname.startsWith('/conversations/conv-')`, 'conversation route');
      await cdp.waitFor(`document.querySelector('[role=dialog]')`, 'AI notice');
      report.screenshots.push(await cdp.shot('06-ai-notice'));
      await cdp.click('[role=dialog] button', 'I understand');
      await cdp.waitFor(`document.body.textContent.includes('Confirm and launch')`, 'launch proposal', 30000);
      await cdp.waitFor(`!document.querySelector('.animate-pulse.text-ai')`, 'streaming done', 30000);
      report.screenshots.push(await cdp.shot('07-conversation-proposal'));
    });
    await step('J1 confirm the launch', async () => {
      await cdp.click('button', 'Confirm and launch');
      await cdp.waitFor(`document.querySelector('.runcard')`, 'run link card');
      report.screenshots.push(await cdp.shot('08-conversation-run-started'));
    });
    await step('J3 the gate opens a validation conversation and notifies', async () => {
      await cdp.waitFor(`document.body.textContent.includes('validation conversation')`, 'validation opened', 60000);
      await sleep(600);
      report.screenshots.push(await cdp.shot('09-conversation-gate-opened'));
      await cdp.click('button[aria-label="Notifications"]');
      await cdp.waitFor(
        `document.querySelector('p-popover') && document.body.textContent.includes('waits for your decision')`,
        'notification popover',
      );
      report.screenshots.push(await cdp.shot('10-notifications'));
      await cdp.click('.p-popover button', 'waits for your decision');
      await cdp.waitFor(
        `location.pathname.startsWith('/conversations/conv-') && document.querySelector('sai-gate-card')`,
        'validation conversation',
        10000,
      );
      await sleep(400);
      report.screenshots.push(await cdp.shot('11-validation-conversation'));
    });
    await step('J3 reject at the gate with a comment, rework runs again', async () => {
      await cdp.type('sai-gate-card textarea', 'Partners need mTLS, not only bearer tokens.');
      await cdp.click('sai-gate-card button', 'Reject');
      await cdp.waitFor(`document.body.textContent.includes('This validation is closed')`, 'validation closed', 10000);
      report.screenshots.push(await cdp.shot('12-validation-closed-rejected'));
      await cdp.nav('/supervisor');
      await cdp.waitFor(`document.querySelector('sai-gate-card textarea')`, 'second gate in supervisor', 60000);
      await sleep(500);
      report.screenshots.push(await cdp.shot('13-supervisor-second-gate'));
    });
    await step('J3 approve the reworked ADR from Supervisor', async () => {
      await cdp.click('sai-gate-card button', 'Approve');
      await cdp.waitFor(
        `document.body.textContent.includes('Recent decisions') && document.body.textContent.includes('approved')`,
        'decision recorded',
        10000,
      );
      report.screenshots.push(await cdp.shot('14-supervisor-approved'));
    });
    await step('J2 run detail with folded internals', async () => {
      await cdp.click('a[href^="/supervisor/runs/run-"]');
      await cdp.waitFor(`location.pathname.startsWith('/supervisor/runs/run-')`, 'run route');
      await sleep(400);
      report.screenshots.push(await cdp.shot('15-run-detail'));
      await cdp.click('details.sai-fold > summary', 'Harness verdicts');
      await cdp.click('details.sai-fold > summary', 'Journal');
      await sleep(300);
      report.screenshots.push(await cdp.shot('16-run-detail-unfolded'));
    });
    await step('J4 board shows the Feature as ready; ADR rendered with history', async () => {
      await cdp.nav('/workspace');
      await cdp.click('p-tab', 'Board');
      await cdp.waitFor(
        `location.pathname === '/workspace/board' && document.body.textContent.includes('Secure REST API for customer subscriptions')`,
        'feature card',
      );
      report.screenshots.push(await cdp.shot('17-board-features'));
      await cdp.click('[role=tab] button', 'Adr');
      await sleep(300);
      report.screenshots.push(await cdp.shot('18-board-adrs'));
      await cdp.click('p-tab', 'Explorer');
      await cdp.waitFor(
        `location.pathname === '/workspace/explorer' && document.querySelector('p-tree')`,
        'explorer tree',
      );
      await cdp.click('.p-tree-node-content', 'subscriptions-api-security.adr.md');
      await cdp.waitFor(`document.body.textContent.includes('Decision scope')`, 'rendered ADR');
      report.screenshots.push(await cdp.shot('19-artifact-adr'));
      await cdp.click('p-tab', 'History');
      await sleep(300);
      report.screenshots.push(await cdp.shot('20-artifact-adr-history'));
    });
    await step('Organization tab', async () => {
      await cdp.click('p-tab', 'Organization');
      await cdp.waitFor(
        `location.pathname === '/workspace/organization' && document.body.textContent.includes('Trackable item types')`,
        'organization',
      );
      report.screenshots.push(await cdp.shot('21-workspace-organization'));
    });
    await step('J5/J6 consultation and out-of-scope, phone width', async () => {
      await cdp.nav('/conversations');
      await cdp.type('#nc-intent', 'Please consult both the architect and security on the subscriptions API.');
      await cdp.click('button', 'Start');
      await cdp.waitFor(`document.body.textContent.includes('Both consultations returned')`, 'resume message', 30000);
      await cdp.waitFor(`!document.querySelector('.animate-pulse.text-ai')`, 'streaming done', 30000);
      report.screenshots.push(await cdp.shot('22-conversation-consult'));
      await cdp.type('#composer', 'What is the weather like in Lyon today?');
      await cdp.click('form button[type=submit]');
      await cdp.waitFor(`document.body.textContent.includes('no free chat')`, 'out of scope', 30000);
      await cdp.waitFor(`!document.querySelector('.animate-pulse.text-ai')`, 'streaming done', 30000);
      report.screenshots.push(await cdp.shot('23-conversation-out-of-scope'));
      report.screenshots.push(await cdp.shot('24-phone-conversation', 390, 844));
      await cdp.nav('/supervisor');
      report.screenshots.push(await cdp.shot('25-phone-supervisor', 390, 844));
      await cdp.nav('/workspace');
      report.screenshots.push(await cdp.shot('26-phone-workspace', 390, 844));
    });
    report.consoleErrors = cdp.consoleErrors;
    ws.close();
  } catch (error) {
    // Keep what the page showed when the walk failed, for diagnosis.
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(
        (t) => t.type === 'page',
      );
      const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
      await new Promise((ok, fail) => {
        ws.addEventListener('open', ok);
        ws.addEventListener('error', fail);
      });
      const cdp = new Cdp(ws);
      report.failure = {
        message: error.message,
        url: await cdp.eval('location.href'),
        text: (await cdp.eval('document.body.innerText')).slice(0, 4000),
      };
      report.screenshots.push(await cdp.shot('99-failure'));
      ws.close();
    } catch {
      report.failure = { message: error.message };
    }
    await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    chrome.kill('SIGTERM');
    server.close();
  }
  report.endedAt = new Date().toISOString();
  report.ok = report.consoleErrors.length === 0;
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        steps: report.steps.length,
        screenshots: report.screenshots.length,
        consoleErrors: report.consoleErrors,
      },
      null,
      2,
    ),
  );
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
