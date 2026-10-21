// Synthetic browser checks only. All external requests are intercepted and
// Supabase DNS is blocked. No existing browser profile or real login is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep, extname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { academicTermBrowserFixture } from './lib/academic-term-browser-fixture.mjs';
const fixture = academicTermBrowserFixture();
fixture.reset();

const root = resolve('dist');
// Derive public project storage names from the built browser bundle, so the
// fixture follows this checkout without reading credentials or environment files.
const publicProjectRefs = [...new Set(readdirSync(join(root, 'assets'))
  .filter(name => /^supabaseClient-.*\.js$/.test(name))
  .flatMap(name => [...readFileSync(join(root, 'assets', name), 'utf8').matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co/g)].map(match => match[1])))];
assert.ok(publicProjectRefs.length, 'public Supabase project reference found in built bundle');
const server = createServer((req, res) => {
  let file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { if (!statSync(file).isFile()) file = join(root, 'index.html'); } catch { file = join(root, 'index.html'); }
  const type = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' }[extname(file)] || 'text/html';
  res.writeHead(200, { 'Content-Type': type }); res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), 'kandid-term-danger-zone-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
  '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });

const user = fixture.user;
const admin = fixture.admin();
const current = fixture.terms().find(t=>t.status==='active');
const next = { id: 999, academic_year: '2027-2028', semester: '1st Semester', status: 'draft' };
const later = { ...next, id: 998, academic_year: '2028-2029' };
let mode = 'success', ws, send, serial = 0;
const pending = new Map(), errors = [], diagnostics = [], requests = [], results = [];

try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome debugger ready');
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const fulfill = (id, status, body, allowedHeaders = 'authorization,apikey,x-client-info,content-type,x-supabase-api-version') => send('Fetch.fulfillRequest', {
    requestId: id, responseCode: status, responseHeaders: [
      { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin },
      { name: 'Access-Control-Allow-Headers', value: allowedHeaders },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,HEAD,OPTIONS' },
    ], body: Buffer.from(status === 204 ? '' : JSON.stringify(body)).toString('base64'),
  });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded') diagnostics.push(m.params.entry.text);
    if (m.method === 'Network.loadingFailed') diagnostics.push(m.params.errorText);
    if (m.method !== 'Fetch.requestPaused') return;
    void (async () => {
      const p = m.params, url = new URL(p.request.url);
      if (url.origin === origin) return send('Fetch.continueRequest', { requestId: p.requestId });
      if (!url.hostname.endsWith('.supabase.co')) return send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
      if (p.request.method === 'OPTIONS') return fulfill(p.requestId, 204, null,
        Object.entries(p.request.headers).find(([key]) => key.toLowerCase() === 'access-control-request-headers')?.[1]);
      const body = p.request.postData ? JSON.parse(p.request.postData) : {};
      requests.push({ method: p.request.method, path: url.pathname, action: body.action });
      if (url.pathname === '/auth/v1/user') return fulfill(p.requestId, 200, user);
      if (url.pathname.startsWith('/rest/v1/')) {
        assert.ok(['GET', 'HEAD'].includes(p.request.method), 'no table writes');
        const table = url.pathname.split('/').pop();
        const single = Object.entries(p.request.headers).some(([k, v]) => k.toLowerCase() === 'accept' && v.includes('object+json'));
        if (table === 'academic_terms' && mode === 'error') return fulfill(p.requestId, 403, { message: 'Synthetic read denied', code: '42501' });
        if (table === 'academic_terms' && mode === 'unavailable') return fulfill(p.requestId, 404, { message: 'Synthetic missing table', code: '42P01' });
        const terms = mode === 'noactive' ? [next] : mode === 'multiple' ? [current, { ...next, status: 'active' }] : mode === 'nodraft' ? [current, later] : fixture.terms();
        const rows = table === 'admin_users' ? [admin] : table === 'academic_terms' ? terms : table === 'system_settings' ? [fixture.settings()].filter(Boolean) : [];
        return fulfill(p.requestId, 200, single ? rows[0] || null : rows);
      }
      if (url.pathname.endsWith('/admin-academic-terms')) {
        if (mode === 'backend_missing') return fulfill(p.requestId,404,{code:'NOT_FOUND',message:'Requested function was not found'});
        const result = await fixture.invoke(body);
        if (mode === 'lost_response' && body.action === 'activate' && result.status === 200) return fulfill(p.requestId,503,{error:'Synthetic response interruption. Check transition status before retrying.'});
        return fulfill(p.requestId,result.status,result.body);
      }
      if (url.pathname.endsWith('/admin-user-management')) return fulfill(p.requestId, 200, { data: { admins: [admin] } });
      return fulfill(p.requestId, 200, { data: [], notifications: [] });
    })().catch(e => { if (!e.message.includes('Invalid InterceptionId')) errors.push(e.message); });
  };
  const value = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 300; i++) { if (await value(`Boolean(${expression})`)) return; await delay(100); }
    throw Error('UI assertion timed out: ' + expression + ' / ' + await value('document.body.innerText.slice(-1500)') + ' / ' + JSON.stringify({ errors, diagnostics, requests: requests.slice(-20) }));
  };
  const click = selector => value(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const selectNext = () => value("(()=>{const e=document.querySelector('#next-academic-term');e.value=e.options[1].value;e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  const button = label => `[...document.querySelectorAll('.academic-term-danger-zone button')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
  const clickText = label => value(`${button(label)}.click()`);
  const noOverflow = async () => assert.equal(await value('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  const expiry = Math.floor(Date.now() / 1000) + 3600, enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ ...user, sub: user.id, exp: expiry, iat: expiry - 3600 })}.synthetic-only`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('user',${JSON.stringify(JSON.stringify(admin))});for(const ref of ${JSON.stringify(publicProjectRefs)})localStorage.setItem('sb-'+ref+'-auth-token',${JSON.stringify(JSON.stringify({ access_token: token, refresh_token: 'synthetic', expires_at: expiry, expires_in: 3600, token_type: 'bearer', user }))});localStorage.setItem('kandid-pwa-install-dismissed-until',String(Date.now()+3600000));}` });

  const navigate = async () => {
    await send('Page.navigate',{url:'about:blank'});
    await send('Page.navigate',{url:origin+'/super-admin/settings'});
    await wait("document.querySelector('#next-academic-term') && document.querySelector('#system-name')");
    await wait("[...document.querySelectorAll('.academic-term-danger-zone button')].some(e=>e.textContent==='Create Draft Term'&&!e.disabled)");
  };
  const draft = async () => {
    const before = fixture.value('select jsonb_build_array((select id from public.academic_terms where status=\'active\'),(select count(*) from public.student_notifications));');
    await clickText('Create Draft Term');
    await wait("document.querySelector('#next-academic-term')?.options.length===2");
    assert.deepEqual(fixture.value('select jsonb_build_array((select id from public.academic_terms where status=\'active\'),(select count(*) from public.student_notifications));'),before);
    await selectNext();
  };
  const preview = async () => { await clickText('Preview activation impact'); await wait("!!document.querySelector('.term-impact-counts')"); };
  const confirm = async () => {
    await wait("!!document.querySelector('#term-confirmation')");
    assert.equal(await value("document.querySelector('.term-activate-button').disabled"),true);
    await click('.term-acknowledgement input');
    await value("document.querySelector('#term-confirmation').focus()");
    await send('Input.insertText',{text:'ACTIVATE'});
    assert.equal(await value("document.querySelector('.term-activate-button').disabled"),true);
    await value("document.querySelector('#term-confirmation').select()");
    await send('Input.insertText',{text:'ACTIVATE 1st Semester AY 2027-2028'});
    await wait("!document.querySelector('.term-activate-button').disabled");
  };
  for (const width of [1280, 768, 390]) {
    fixture.reset(); mode='success';
    await send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await navigate(); await draft();
    assert.equal(await value("document.querySelector('.term-current-register').innerText.includes('2nd Semester')"),true);
    await preview(); await confirm();
    assert.equal(await value("document.querySelectorAll('.term-impact-counts > div').length"),11);
    assert.equal(await value("document.querySelector('.term-impact-counts').innerText.includes('Unavailable')"),false);
    const geometry=await value("(()=>{const title=getComputedStyle(document.querySelector('h1')),h=getComputedStyle(document.querySelector('#term-management-title'));return {page:parseFloat(title.fontSize),section:parseFloat(h.fontSize),radius:getComputedStyle(document.querySelector('#next-academic-term')).borderRadius}})()");
    assert.ok(geometry.page>geometry.section); assert.equal(geometry.radius,'0px'); await noOverflow();
    await value('window.scrollTo(0,0)');
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    writeFileSync('.tmp/academic-term-danger-zone-'+width+'.png',Buffer.from(shot.data,'base64'));
    const before=requests.filter(r=>r.action==='activate').length;
    await value("document.querySelector('.term-activate-button').click();document.querySelector('.term-activate-button')?.click()");
    await wait("document.querySelector('.term-review-feedback')?.innerText.includes('8 student notifications recorded')");
    await wait("document.querySelector('.term-current-register')?.innerText.includes('2027-2028')");
    assert.equal(requests.filter(r=>r.action==='activate').length,before+1);
    assert.equal(fixture.value("select count(*) from public.student_notifications where type='academic_term_activated';"),16);
    assert.equal(fixture.value("select count(*) from public.audit_logs where event_type='academic_term_activated';"),2);
    await noOverflow(); results.push({viewport:width,draft:true,realPreview:true,explicitConfirmation:true,atomicActivation:true,doubleClickPrevented:true,overflow:false});
    console.log('Verified real local Edge/PostgreSQL browser workflow '+width+'px');
  }
  fixture.reset(); mode='lost_response'; await navigate(); await draft(); await preview(); await confirm(); await click('.term-activate-button');
  await wait("document.querySelector('.academic-term-danger-zone').innerText.includes('Synthetic response interruption')");
  await send('Page.reload'); await wait("[...document.querySelectorAll('button')].some(e=>e.textContent==='Check transition status'&&!e.disabled)");
  await clickText('Check transition status');
  await wait("document.querySelector('.term-review-feedback')?.innerText.includes('8 student notifications recorded')");
  assert.equal(fixture.value("select count(*) from public.student_notifications where type='academic_term_activated';"),16);
  results.push({lostResponseRecoveryAcrossReload:true,noDuplicateNotifications:true});

  fixture.reset();mode='success';await navigate();await draft();await preview();await confirm();
  fixture.sql("update public.students set status='pending' where id=1;");
  await click('.term-activate-button');
  await wait("document.querySelector('.academic-term-danger-zone').innerText.includes('expired or changed')");
  await clickText('Check transition status');
  await wait("document.querySelector('.academic-term-danger-zone').innerText.includes('server invalidated')");
  assert.equal(fixture.value("select count(*) from public.student_notifications where type='academic_term_activated';"),8);
  await preview();await wait("!!document.querySelector('#term-confirmation')");
  await clickText('Refresh terms');await wait("!document.querySelector('#term-confirmation')");
  results.push({staleReviewRejected:true,statusInvalidatesStaleReview:true,refreshClearsConfirmation:true});

  fixture.reset();mode='success';fixture.sql("update public.elections set status='draft',end_date=null where id=20;");
  await navigate();await draft();await preview();
  await wait("document.querySelector('.term-load-error')?.innerText.includes('ongoing, scheduled')");
  assert.equal(await value("!!document.querySelector('#term-confirmation')"),false);
  results.push({blockingElectionPreventsConfirmation:true});

  fixture.reset();mode='backend_missing';await navigate();await clickText('Create Draft Term');
  await wait("document.querySelector('.academic-term-danger-zone').innerText.includes('not deployed')");
  assert.equal(fixture.terms().some(t=>t.academic_year==='2027-2028'),false);
  results.push({missingBackendVisible:true,noSimulatedSuccess:true});

  fixture.reset();mode='success';fixture.sql('delete from public.system_settings;');
  await send('Page.navigate',{url:'about:blank'});await send('Page.navigate',{url:origin+'/super-admin/settings'});
  await wait("document.body.innerText.includes('System settings are not initialized')");
  assert.equal(await value("!!document.querySelector('#system-name')"),false);
  fixture.sql('insert into public.system_settings(id) values(1);');
  await value("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Retry settings load')).click()");
  await wait("!!document.querySelector('#system-name')"); results.push({missingSettingsHonest:true,settingsRetryWorks:true});

  for (const state of ['error','unavailable','noactive','multiple','nodraft']) {
    mode=state;await send('Page.navigate',{url:'about:blank'});await send('Page.navigate',{url:origin+'/super-admin/settings'});
    const expected={error:'could not be loaded',unavailable:'database contract is unavailable',noactive:'No active academic term',multiple:'Multiple active terms',nodraft:'No immediate next draft'}[state];
    await wait("document.querySelector('.academic-term-danger-zone')?.innerText.includes("+JSON.stringify(expected)+")");
    assert.equal(await value("!!document.querySelector('.term-review')"),false);await noOverflow();
    if(state==='error'||state==='unavailable'){mode='success';await clickText('Refresh terms');await wait("!!document.querySelector('#next-academic-term')");}
    results.push({state,pass:true});
  }
  assert.equal(requests.some(r => r.path.endsWith('/admin-academic-terms')), true);
  assert.equal(requests.some(r => /student_term_enrollments|student_organization_terms/.test(r.path)), false);
  assert.deepEqual(errors, []);
  const report = JSON.stringify({ results, realSupabaseRequests: 0, productionWrites: 0 }, null, 2);
  writeFileSync('.tmp/academic-term-danger-zone-browser.json', report);
  console.log(report);
} finally {
  if (ws?.readyState === WebSocket.OPEN) await Promise.race([send('Browser.close').catch(() => {}), delay(1000)]);
  for (const p of pending.values()) clearTimeout(p.timer);
  ws?.terminate(); chrome.kill(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fixture.drop();
}
