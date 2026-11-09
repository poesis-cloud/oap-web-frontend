#!/usr/bin/env node
/**
 * Visual smoke test of the built application, without any new dependency.
 *
 * Serves `dist/` with a tiny static server (SPA fallback), drives a headless Chrome through
 * the DevTools protocol (Node 22 ships a WebSocket client), walks the slice-1 journeys
 * (explorer like GitHub with the viewer over the listing, conversation as a chat, the ★ gate as a four-step flow
 * decided in its conversation, Supervision gates, runs with sessions and logs and statistics, board, organization,
 * consultation and out-of-scope, phone and tablet widths) and saves screenshots plus a JSON report. Fails on any
 * console error or uncaught exception.
 *
 *   node tools/smoke.mjs [--out ../../evidence/smoke] [--base /oap-web-frontend] [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
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
const DIST = resolve(here, '..', opt('--dist', 'dist'));
const OUT = resolve(here, opt('--out', '../../../evidence/smoke'));
const CHROME = opt('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PORT = Number(opt('--port', '4410'));
/** Base path the build was made for (`ng build --base-href /x/`), without trailing slash; '' at the root. */
const BASE = opt('--base', '').replace(/\/$/, '');
const at = (path) => `${BASE}${path}`;
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
    const pathname = BASE && url.pathname.startsWith(`${BASE}/`) ? url.pathname.slice(BASE.length) : url.pathname;
    const path = resolve(DIST, `.${decodeURIComponent(pathname)}`);
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
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${at(path)}` });
    await this.waitFor(`document.querySelector('sai-root main')?.textContent?.trim().length > 20`, `page ${path}`);
    await sleep(400);
  }
  /** In-app navigation: the demo state lives in memory, so a full reload would reset it. */
  async nav(path) {
    const clicked = await this.eval(
      `(() => { const a = document.querySelector('a[href="${at(path)}"], [routerlink="${path}"]'); if (!a) return false; a.click(); return true; })()`,
    );
    if (!clicked) throw new Error(`no in-app link to ${path}`);
    await this.waitFor(`location.pathname === ${JSON.stringify(at(path))}`, `route ${path}`);
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

    await step('Supervision › Gates, with the seeded scenario (one gate waits for the user)', async () => {
      await cdp.goto('/supervision/gates');
      await cdp.waitFor(`document.querySelector('sai-gate-flow') && document.body.textContent.includes('Decide in the gate conversation')`, 'seeded gate');
      report.screenshots.push(await cdp.shot('01-gates'));
    });
    await step('Workspace › Explorer: tree, directory like GitHub, viewer over the listing', async () => {
      await cdp.nav('/workspace/explorer');
      await cdp.waitFor(`document.querySelector('p-tree') && document.querySelectorAll('.sai-item').length > 2`, 'explorer root');
      report.screenshots.push(await cdp.shot('02-explorer-root'));
      const enter = async (folder) => {
        await cdp.waitFor(`[...document.querySelectorAll('.pane.is-content .sai-item')].some(e => e.textContent.includes(${JSON.stringify(folder)}))`, 'row ' + folder);
        await cdp.click('.pane.is-content .sai-item', folder);
        await cdp.waitFor(`location.search.includes(${JSON.stringify(folder)})`, 'folder ' + folder);
        await sleep(200);
      };
      for (const folder of ['portfolio', 'art', 'platform', 'program-backlog', 'customer-subscriptions-api']) await enter(folder);
      report.screenshots.push(await cdp.shot('03-explorer-directory'));
      await cdp.click('.pane.is-content .sai-item', 'customer-subscriptions-api.feature.md');
      await cdp.waitFor(`document.querySelector('sai-viewer') && document.body.textContent.includes('Acceptance criteria')`, 'viewer markdown');
      report.screenshots.push(await cdp.shot('04-viewer-markdown'));
      await cdp.click('button[aria-label="Versions"]');
      await cdp.waitFor(`document.querySelector('.sai-viewer-side')`, 'versions panel');
      report.screenshots.push(await cdp.shot('05-viewer-versions'));
      await cdp.click('button[aria-label="Versions"]');
      await cdp.click('button[aria-label="Raw source"]');
      await cdp.waitFor(`document.querySelector('sai-viewer pre.sai-raw')`, 'raw source');
      report.screenshots.push(await cdp.shot('06-viewer-raw'));
      await cdp.click('button[aria-label="Close"]');
      await cdp.waitFor(`!document.querySelector('sai-viewer')`, 'viewer closed');
      await cdp.click('.sai-crumb');
      await cdp.waitFor(`!location.search.includes('dir=')`, 'root');
      await enter('organization');
      await enter('conf');
      await cdp.waitFor(`[...document.querySelectorAll('.pane.is-content .sai-item')].some(e => e.textContent.includes('workspace.conf.yaml'))`, 'conf listing');
      await cdp.click('.pane.is-content .sai-item', 'workspace.conf.yaml');
      await cdp.waitFor(`document.querySelector('sai-viewer sai-data-tree')`, 'yaml tree');
      report.screenshots.push(await cdp.shot('07-viewer-yaml-organization'));
      await cdp.click('button[aria-label="Close"]');
    });
    let architectureConversationPath = '';
    await step('Conversation: list, new thread, proposal, launch', async () => {
      await cdp.nav('/conversation');
      await cdp.waitFor(`document.querySelector('sai-conversation-list')`, 'conversation list');
      report.screenshots.push(await cdp.shot('08-conversation-empty'));
      await cdp.nav('/conversation/new');
      await cdp.click('button', 'Use the scenario');
      report.screenshots.push(await cdp.shot('09-conversation-new'));
      await cdp.click('button', 'Start');
      await cdp.waitFor(`location.pathname.startsWith(${JSON.stringify(at('/conversation/conv-'))})`, 'conversation route');
      await cdp.waitFor(`document.querySelector('[role=dialog]')`, 'AI notice');
      await cdp.click('[role=dialog] button', 'I understand');
      await cdp.waitFor(`document.body.textContent.includes('Confirm and launch')`, 'launch proposal', 30000);
      await cdp.waitFor(`!document.querySelector('.animate-pulse.text-ai')`, 'streaming done', 30000);
      report.screenshots.push(await cdp.shot('10-chat-proposal'));
      architectureConversationPath = await cdp.eval('location.pathname');
      await cdp.click('button', 'Confirm and launch');
      await cdp.waitFor(`document.querySelector('.runcard')`, 'run card');
      report.screenshots.push(await cdp.shot('11-chat-run-started'));
    });
    await step('Gate: the orchestrator ends the workflow with the gate in this conversation; reviewed in the viewer, rejected here', async () => {
      await cdp.waitFor(`[...document.querySelectorAll('sai-gate-flow button')].some(b => b.textContent.includes('Open the artifact'))`, 'gate raised in the launching conversation', 60000);
      await sleep(600);
      report.screenshots.push(await cdp.shot('12-chat-gate-raised'));
      await cdp.click('button[aria-label="Notifications"]');
      await cdp.waitFor(`document.querySelector('p-popover') && document.body.textContent.includes('waits for your decision')`, 'notification popover');
      report.screenshots.push(await cdp.shot('13-notifications'));
      await cdp.click('.p-popover button', 'waits for your decision');
      await cdp.waitFor(`location.pathname.startsWith(${JSON.stringify(at('/conversation/conv-'))}) && document.querySelector('sai-gate-flow')`, 'conversation with the gate', 10000);
      await sleep(400);
      report.screenshots.push(await cdp.shot('14-gate-conversation-review'));
      await cdp.click('sai-gate-flow button', 'Open the artifact');
      await cdp.waitFor(`document.querySelector('sai-viewer') && document.body.textContent.includes('Decision scope')`, 'artifact under review');
      report.screenshots.push(await cdp.shot('15-gate-artifact-viewer'));
      await cdp.click('button[aria-label="Close"]');
      await cdp.waitFor(`document.querySelector('sai-gate-flow textarea')`, 'decision step');
      report.screenshots.push(await cdp.shot('16-gate-decide'));
      await cdp.type('sai-gate-flow textarea', 'Partners need mTLS, not only bearer tokens.');
      await cdp.click('sai-gate-flow button', 'Reject');
      await cdp.waitFor(`document.body.textContent.includes('Gate rejected')`, 'gate decided', 10000);
      report.screenshots.push(await cdp.shot('17-gate-rejected'));
    });
    await step('Supervision › Gates leads to the second gate; approved in its conversation', async () => {
      await cdp.nav('/supervision/gates');
      await cdp.waitFor(`document.querySelector('sai-gate-flow a[href="${architectureConversationPath}"]')`, 'second gate waiting', 60000);
      await sleep(500);
      report.screenshots.push(await cdp.shot('18-gates-waiting'));
      await cdp.click(`sai-gate-flow a[href="${architectureConversationPath}"]`);
      await cdp.waitFor(`location.pathname.startsWith(${JSON.stringify(at('/conversation/conv-'))}) && document.querySelector('sai-gate-flow')`, 'second gate conversation', 10000);
      await cdp.click('sai-gate-flow button', 'Open the artifact');
      await cdp.waitFor(`document.querySelector('sai-viewer')`, 'reworked artifact');
      await cdp.click('button[aria-label="Close"]');
      await cdp.waitFor(`document.querySelector('sai-gate-flow textarea')`, 'decision step');
      await cdp.click('sai-gate-flow button', 'Approve');
      await cdp.waitFor(`document.body.textContent.includes('Gate approved')`, 'second gate decided', 10000);
      report.screenshots.push(await cdp.shot('19-gate-approved'));
    });
    await step('Supervision › Runs: list, statistics, run sessions and log', async () => {
      await cdp.nav('/supervision/runs');
      await cdp.waitFor(`document.body.textContent.includes('AI cost') && document.querySelector('a[href^="${at('/supervision/runs/run-')}"]')`, 'runs list');
      report.screenshots.push(await cdp.shot('20-runs'));
      await cdp.click('.sai-segment button', 'Statistics');
      await cdp.waitFor(`document.body.textContent.includes('By agent')`, 'statistics');
      report.screenshots.push(await cdp.shot('21-runs-statistics'));
      await cdp.click('.sai-segment button', 'Runs');
      await cdp.click(`a[href^="${at('/supervision/runs/run-')}"]`);
      await cdp.waitFor(`location.pathname.startsWith(${JSON.stringify(at('/supervision/runs/run-'))}) && document.body.textContent.includes('Overview')`, 'run route');
      await sleep(400);
      report.screenshots.push(await cdp.shot('22-run-overview'));
      await cdp.click('.pane.is-list .sai-item', 'author-adr');
      await cdp.waitFor(`document.body.textContent.includes('worker session of this step') && document.body.textContent.includes('Open the session conversation')`, 'session');
      report.screenshots.push(await cdp.shot('23-run-session'));
      await cdp.click('button[aria-label="Session log"]');
      await cdp.waitFor(`document.querySelector('.sai-table') && document.body.textContent.includes('resolve-step-model') || document.body.textContent.includes('No log entry')`, 'session log');
      report.screenshots.push(await cdp.shot('24-run-session-log'));
      await cdp.click('button', 'Open the session conversation');
      await cdp.waitFor(`location.pathname.startsWith(${JSON.stringify(at('/conversation/conv-'))}) && document.body.textContent.includes('session') && document.body.textContent.includes('Delivered')`, 'session conversation', 10000);
      report.screenshots.push(await cdp.shot('24b-session-conversation'));
    });
    await step('Workspace › Board and Supervision › Organization', async () => {
      await cdp.nav('/workspace/board');
      await cdp.waitFor(`document.body.textContent.includes('Secure REST API for customer subscriptions')`, 'board');
      report.screenshots.push(await cdp.shot('25-board'));
      await cdp.click('.sai-card', 'Secure REST API');
      await cdp.waitFor(`document.querySelector('sai-viewer')`, 'board viewer');
      report.screenshots.push(await cdp.shot('26-board-viewer'));
      await cdp.click('button[aria-label="Close"]');
      await cdp.nav('/supervision/organization');
      await cdp.waitFor(`document.body.textContent.includes('What the organization declares')`, 'organization');
      report.screenshots.push(await cdp.shot('27-organization'));
      await cdp.click('sai-organization-page button', 'System Architect');
      await cdp.waitFor(`document.querySelector('sai-viewer') && document.body.textContent.includes('system-architect')`, 'agent viewer');
      report.screenshots.push(await cdp.shot('28-organization-agent-viewer'));
      await cdp.click('button[aria-label="Close"]');
    });
    await step('Consultation and out-of-scope; phone and tablet widths', async () => {
      await cdp.nav('/conversation');
      await cdp.nav('/conversation/new');
      await cdp.type('#nc-intent', 'Please consult both the architect and security on the subscriptions API.');
      await cdp.click('button', 'Start');
      await cdp.waitFor(`document.body.textContent.includes('Both consultations returned')`, 'resume message', 30000);
      await cdp.waitFor(`!document.querySelector('.animate-pulse.text-ai')`, 'streaming done', 30000);
      report.screenshots.push(await cdp.shot('29-chat-consult'));
      await cdp.type('#composer', 'What is the weather like in Lyon today?');
      await cdp.click('form.sai-composer button[type=submit]');
      await cdp.waitFor(`document.body.textContent.includes('no free chat')`, 'out of scope', 30000);
      await cdp.waitFor(`!document.querySelector('.animate-pulse.text-ai')`, 'streaming done', 30000);
      report.screenshots.push(await cdp.shot('30-chat-out-of-scope'));
      report.screenshots.push(await cdp.shot('31-tablet-chat', 900, 1180));
      report.screenshots.push(await cdp.shot('32-phone-chat', 390, 844));
      await cdp.nav('/supervision/gates');
      report.screenshots.push(await cdp.shot('33-phone-gates', 390, 844));
      await cdp.nav('/workspace/explorer');
      report.screenshots.push(await cdp.shot('34-phone-explorer', 390, 844));
      report.screenshots.push(await cdp.shot('35-tablet-explorer', 900, 1180));
    });
    await step('Light theme', async () => {
      await cdp.shot('_reset', 1440, 900);
      await cdp.click('button[aria-label="Light mode"], button[aria-label="Dark mode"]');
      await sleep(300);
      report.screenshots.push(await cdp.shot('36-light-explorer'));
      await cdp.nav('/supervision/runs');
      await sleep(300);
      report.screenshots.push(await cdp.shot('37-light-runs'));
      await cdp.nav('/conversation');
      await cdp.click('.sai-item', 'Subscriptions API');
      await cdp.waitFor(`document.querySelector('sai-gate-flow')`, 'conversation with gates');
      await sleep(300);
      report.screenshots.push(await cdp.shot('38-light-gate-conversation'));
    });

    await step('Improvement: source evidence, retrospective thread and returned conclusion', async () => {
      await cdp.nav('/workspace/improvement');
      await cdp.waitFor(`document.body.textContent.includes('ADR status missing before the commit gate')`, 'seeded pain point');
      report.screenshots.push(await cdp.shot('39-improvement', 1440, 1000));
      await cdp.click('sai-improvement-page button', 'Read evidence');
      await cdp.waitFor(`document.querySelector('sai-viewer') && document.body.textContent.includes('sourceSession')`, 'traceable evidence');
      await cdp.click('button[aria-label="Close"]');
      await cdp.click('button', 'Start retrospective');
      await cdp.waitFor(`document.querySelector('input[aria-label="Thread conclusion"]')`, 'pain point thread');
      await cdp.type('input[aria-label="Thread conclusion"]', 'Add an ADR status preflight; observe three runs before resolving this pain point.');
      await cdp.click('button', 'Return conclusion');
      await cdp.waitFor(`document.body.textContent.includes('returned') && !document.querySelector('input[aria-label="Thread conclusion"]')`, 'returned conclusion');
      report.screenshots.push(await cdp.shot('40-retrospective'));
    });
    await step('Organization change: readable diff, scorecard and human approval', async () => {
      await cdp.nav('/workspace/improvement');
      await cdp.click('sai-improvement-page button', 'Propose an improvement');
      await cdp.waitFor(`document.body.textContent.includes('Confirm and launch')`, 'change proposal');
      await cdp.click('button', 'Confirm and launch');
      await cdp.waitFor(`document.querySelector('sai-change-review sai-diff') && document.querySelector('sai-gate-flow')`, 'organization gate', 60000);
      await cdp.waitFor(`document.body.textContent.includes('Insufficient observations')`, 'honest scorecard');
      report.screenshots.push(await cdp.shot('41-organization-diff-scorecard', 1440, 1100));
      report.screenshots.push(await cdp.shot('42-phone-organization-diff', 390, 844));
      if (await cdp.eval('document.documentElement.scrollWidth > innerWidth + 2')) throw new Error('Organization review overflows the phone viewport');
      await cdp.shot('_reset-learning', 1440, 1000);
      await cdp.click('sai-gate-flow button', 'Open the artifact');
      await cdp.waitFor(`document.querySelector('sai-viewer')`, 'change artifact');
      await cdp.click('button[aria-label="Close"]');
      await cdp.click('sai-gate-flow button', 'Approve');
      await cdp.waitFor(`document.body.textContent.includes('Gate approved')`, 'change approved');
      await cdp.nav('/supervision/organization');
      await cdp.waitFor(`document.body.textContent.includes('1 files changed')`, 'one changed instruction');
    });
    await step('Rollback: separate run and gate, exact restoration to nominal', async () => {
      await cdp.nav('/workspace/improvement');
      await cdp.click('sai-improvement-page button', 'Propose a rollback');
      await cdp.waitFor(`document.body.textContent.includes('Confirm and launch')`, 'rollback proposal');
      await cdp.click('button', 'Confirm and launch');
      await cdp.waitFor(`document.querySelector('sai-change-review sai-diff') && document.querySelector('sai-gate-flow')`, 'rollback gate', 60000);
      report.screenshots.push(await cdp.shot('43-rollback-gate'));
      await cdp.click('sai-gate-flow button', 'Open the artifact');
      await cdp.waitFor(`document.querySelector('sai-viewer')`, 'rollback artifact');
      await cdp.click('button[aria-label="Close"]');
      await cdp.click('sai-gate-flow button', 'Approve');
      await cdp.waitFor(`document.body.textContent.includes('Gate approved')`, 'rollback approved');
      await cdp.nav('/supervision/organization');
      await cdp.waitFor(`document.body.textContent.includes('none, identical to the package')`, 'nominal restored');
      report.screenshots.push(await cdp.shot('44-organization-restored'));
      await cdp.nav('/workspace/improvement');
      report.screenshots.push(await cdp.shot('45-improvement-history'));
      report.screenshots.push(await cdp.shot('46-phone-improvement', 390, 844));
      if (await cdp.eval('document.documentElement.scrollWidth > innerWidth + 2')) throw new Error('Improvement overflows the phone viewport');
    });
    await step('Agentic Organizations: create an isolated workspace, then return to the original', async () => {
      await cdp.shot('_reset-organizations', 1440, 1000);
      await cdp.nav('/organizations');
      report.screenshots.push(await cdp.shot('47-organizations'));
      await cdp.click('button', 'Create a workspace');
      await cdp.type('#workspace-name', 'Partner Experience');
      report.screenshots.push(await cdp.shot('48-create-workspace'));
      await cdp.click('[role=dialog] button', 'Create workspace');
      await cdp.waitFor(`location.pathname.endsWith('/workspace/explorer') && document.body.textContent.includes('Partner Experience')`, 'new workspace');
      await cdp.nav('/workspace/improvement');
      await cdp.waitFor(`document.body.textContent.includes('No pain points yet') && document.body.textContent.includes('No organization changes yet')`, 'isolated workspace');
      await cdp.nav('/organizations');
      await cdp.click('sai-organizations-page button', 'Customer Platform');
      await cdp.nav('/workspace/improvement');
      await cdp.waitFor(`document.body.textContent.includes('ADR status missing before the commit gate')`, 'original workspace preserved');
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
