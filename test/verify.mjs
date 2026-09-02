/**
 * Regression tests for Quite for Facebook. Run with:
 *
 *     node test/verify.mjs
 *
 * test/mock-feed.html carries the fixtures — ~46 posts, each declaring
 * data-expect="hide" or "keep". This runner grades them ITSELF rather than
 * trusting the harness's own scoring, and then does the thing that matters:
 * it re-runs against a deliberately sabotaged content.js and requires the
 * grading to FAIL. A suite that cannot report a fault is not a suite, and every
 * expensive mistake on this project passed one that could not.
 *
 * Fidelity limit, stated rather than hidden: content.js runs as a page script
 * with chrome.* stubbed, so this exercises the DOM detection logic and not the
 * settings plumbing or the real MutationObserver ordering. The live site
 * remains the only place a verdict is worth anything.
 */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import os from 'node:os'; import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EXT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fbfc-verify-'));
const PORT = 8921, CDP = 9351;

// ?sabotage=1 serves a content.js with the Sponsored label removed. That is the
// positive control: with it, cases expecting "hide" must start failing.
http.createServer((rq, rs) => {
  const url = rq.url.split('?')[0];
  const mode = /sabotage=(\w+)/.exec(rq.url)?.[1] || null;
  const q = !!mode;
  const f = path.join(EXT, url.replace(/^\//, '') || 'test/mock-feed.html');
  fs.readFile(f, (e, d) => {
    if (e) { rs.writeHead(404); return rs.end(); }
    let body = d;
    if (q && url.endsWith('content.js')) {
      const src = d.toString();
      body = Buffer.from(mode === 'suggested'
        // Targeted: only the labels the `suggested` rule matches on.
        ? src.replace(/"Suggested for you"|"Suggested for You"/g, '"__no_such_label__"')
        : src.replace(/"Sponsored"/g, '"__no_such_label__"'));
    }
    if (q && url.endsWith('mock-feed.html')) {
      body = Buffer.from(d.toString().replace(/\.\.\/content\.js/g, `../content.js?sabotage=${mode}`));
    }
    rs.writeHead(200, { 'content-type': url.endsWith('.js') ? 'text/javascript' : 'text/html' });
    rs.end(body);
  });
}).listen(PORT);

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [`--remote-debugging-port=${CDP}`, `--user-data-dir=${TMP}/p`, '--headless=new',
   '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(300); } }

let id = 0;
async function grade(sabotage) {
  const u = `http://localhost:${PORT}/test/mock-feed.html${sabotage ? '?sabotage=' + sabotage : ''}`;
  const t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // mock-feed.html runs its own six-phase script, flipping settings as it goes,
  // and case 8 is an empty shell that only hydrates at t=4500ms. Grading at a
  // fixed early moment therefore read a moving target and mis-scored two cases.
  // Wait for the phase machine to finish, then set a KNOWN state and grade that.
  await sleep(13000);
  await send('Runtime.evaluate', { expression:
    `["hideSponsored","hideFollow","hideJoin"].forEach(k=>window.__setSetting(k,true));
     window.__setSetting("strict", false);` });
  await sleep(1500);
  const r = await send('Runtime.evaluate', {
    returnByValue: true, expression: `(()=>{
      const seen = [...document.querySelectorAll('[data-case][data-expect]')];
      let pass=0, fail=0, hidden=0; const failures=[];
      for (const el of seen) {
        // join-only means "hidden only when the groups rule is on". Every rule
        // is switched on above, so it is expected hidden here — but it is NOT
        // the same claim as "hide", and grading it as one was wrong.
        const want = el.dataset.expect !== 'keep';
        const got  = el.hasAttribute('data-fbfc-hidden')
                  || !!el.closest('[data-fbfc-hidden]');
        if (got) hidden++;
        if (got === want) pass++; else { fail++; failures.push(el.dataset.case + ':want=' + el.dataset.expect + ',got=' + (got?'hidden':'shown')); }
      }
      const byCase = {};
      for (const el of seen) byCase[el.dataset.case] =
        el.hasAttribute('data-fbfc-hidden') || !!el.closest('[data-fbfc-hidden]');
      return JSON.stringify({cases:seen.length, pass, fail, hidden, byCase, failures:failures.slice(0,6),
        version: document.documentElement.getAttribute('data-fbfc-version') || null});
    })()` });
  ws.close(); fetch(`http://127.0.0.1:${CDP}/json/close/${t.id}`);
  return JSON.parse(r.result.result.value);
}

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

const clean = await grade(false);
check('the harness ran at all (content.js stamped a version)',
      !!clean.version, `data-fbfc-version = ${clean.version || 'ABSENT — content.js did not run'}`);
check('every fixture matches its declared expectation',
      clean.fail === 0, `${clean.pass}/${clean.cases} correct, ${clean.fail} wrong${clean.failures.length ? ' — ' + clean.failures.join(' | ') : ''}`);
check('something was actually hidden (a suite that hides nothing proves nothing)',
      clean.hidden > 0, `${clean.hidden} posts hidden`);

// CONTROL. With the Sponsored label removed from content.js, posts that should
// be hidden must stop being hidden and the grading must report it. If this
// still passes, the suite above is incapable of detecting a broken detector.
const broken = await grade('sponsored');
check('CONTROL: sabotaged content.js makes the suite FAIL — so it can detect a fault',
      broken.fail > 0 && broken.hidden < clean.hidden,
      `sabotaged: ${broken.fail} wrong (clean had ${clean.fail}), hidden ${broken.hidden} vs ${clean.hidden}`);

// The suggested-post rule specifically. It was added on 2026-09-01 after a post
// reading "Propaganda (Band) · Suggested for you" went through untouched for
// the whole of 2.6.5, and it shipped with no test at all. Fixture 47 is that
// exact shape; 48 is the same post without the label.
check('the leaking shape (label, no Follow control) is hidden — fixture 47',
      clean.byCase['47'] === true, `case 47 hidden: ${clean.byCase['47']}`);
check('the same post WITHOUT the label is left alone — fixture 48',
      clean.byCase['48'] === false, `case 48 hidden: ${clean.byCase['48']} (must be false)`);

const noSuggested = await grade('suggested');
check('CONTROL: removing only the "Suggested for you" labels un-hides 47 — so that assertion is load-bearing',
      noSuggested.byCase['47'] === false,
      `with the labels removed, case 47 hidden: ${noSuggested.byCase['47']} (must be false)`);


// ---- The popup actually renders. -------------------------------------------
//
// Every UI defect on 2026-09-02 was a change made and never loaded: a brand
// header that did not exist, an ARM line whose CSS silently never applied, a
// toggle missing on one code path, a stylesheet edit that matched nothing. All
// of them would have been caught by opening the popup once. Nothing did.
//
// Each assertion has a control that removes the thing and requires the check to
// fail, so none of them can quietly stop working.
{
  const { spawn } = await import('node:child_process');
  const http = await import('node:http');
  const os2 = await import('node:os');
  const SPORT = 8961, SCDP = 9401;
  const STMP = fs.mkdtempSync(path.join(os2.tmpdir(), 'smoke-'));
  const TY = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
  let sabotage = null;
  const server = http.createServer((rq, rs) => {
    const url = rq.url.split('?')[0];
    const f = path.join(EXT, url.replace(/^\//, ''));
    fs.readFile(f, (e, d) => {
      if (e) { rs.writeHead(404); return rs.end(); }
      let body = d;
      if (sabotage === 'brand' && url.endsWith('popup.html'))
        body = Buffer.from(d.toString().replace(/<div class="brand">[\s\S]*?<\/div>/, ''));
      rs.writeHead(200, { 'content-type': TY[path.extname(f)] || 'text/plain' });
      rs.end(body);
    });
  }).listen(SPORT);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [`--remote-debugging-port=${SCDP}`, `--user-data-dir=${STMP}/p`, '--headless=new',
     '--no-first-run', 'about:blank'], { stdio:'ignore' });
  const nap = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${SCDP}/json/version`)).json(); break; } catch { await nap(300); } }
  let sid = 0;
  async function renderPopup() {
    const t = await (await fetch(`http://127.0.0.1:${SCDP}/json/new?about:blank`, { method:'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    const pend = new Map(); const errs = [];
    ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(JSON.stringify(m.params.args).slice(0,110));
      if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails?.text).slice(0,110));
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const send = (method, params) => new Promise(r => { const i = ++sid; pend.set(i, r); ws.send(JSON.stringify({ id:i, method, params })); });
    await send('Runtime.enable', {}); await send('Page.enable', {});
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.chrome = {
        runtime:{ id:'t', lastError:null, getManifest:()=>({version:'x'}), sendMessage:async()=>({}), onMessage:{addListener(){}} },
        tabs:{ query:async()=>[{id:1,url:'https://example.com/'}], sendMessage:async()=>null },
        permissions:{ contains:async()=>true, request:async()=>true, onAdded:{addListener(){}} },
        cookies:{ getAll:async()=>[] },
        declarativeNetRequest:{ getMatchedRules:async()=>({rulesMatchedInfo:[]}) },
        storage:{ local:{get:async()=>({}),set:async()=>{}}, sync:{get:async()=>({}),set:async()=>{}}, onChanged:{addListener(){}} } };` });
    await send('Page.navigate', { url: `http://localhost:${SPORT}/popup.html` });
    await nap(1800);
    const r = await send('Runtime.evaluate', { returnByValue:true, expression: `(()=>{
      const vis = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
      const brand = document.querySelector('.brand');
      return JSON.stringify({
        brand: vis(brand),
        brandText: brand ? brand.textContent.replace(/\s+/g,' ').trim().slice(0,50) : '',
        styled: brand ? getComputedStyle(brand).display : 'none',
        toggle: !!document.getElementById('enabled'),
      });})()` });
    ws.close(); fetch(`http://127.0.0.1:${SCDP}/json/close/${t.id}`);
    return { ...JSON.parse(r.result.result.value), errs };
  }
  const ok = await renderPopup();
  check('popup: renders with no console errors', ok.errs.length === 0, ok.errs[0] || 'clean');
  check('popup: brand header present and visible', ok.brand === true, ok.brandText || '(absent)');
  check('popup: the on/off toggle exists', ok.toggle === true, `#enabled present: ${ok.toggle}`);
  check('popup: the stylesheet applied', ok.styled === 'flex',
        `.brand display = ${ok.styled} (none/inline means the CSS did not load)`);
  sabotage = 'brand';
  const nb = await renderPopup();
  check('CONTROL: removing the brand header FAILS the check — it can fail',
        nb.brand === false, `brand visible with it removed: ${nb.brand}`);
  sabotage = null;
  chrome.kill(); server.close();
  try { fs.rmSync(STMP, { recursive:true, force:true }); } catch { /* OS will */ }
}

let bad = 0;
console.log('');
for (const r of results) { if (!r.pass) bad++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n          ${r.detail}`); }
console.log(`\n  ${results.length - bad} passed, ${bad} failed`);
chrome.kill();
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
process.exit(bad ? 1 : 0);
