'use strict';
// No browser or live service is used: run the shipped inline script in a VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\bboot\(\);\s*$/, '');
const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class Element {
  constructor(tag = 'div', attrs = {}, parent = null) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parent = parent;
    this.children = []; this.style = {}; this.value = attrs.value || '';
    this.type = attrs.type || ''; this.checked = 'checked' in attrs;
    this.disabled = 'disabled' in attrs; this.hidden = 'hidden' in attrs;
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), v]));
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle(c, on) { if (on === undefined) on = !classes.has(c); on ? classes.add(c) : classes.delete(c); }
    };
    this.textContent = ''; this._html = ''; this.options = [];
  }
  set innerHTML(value) {
    this._html = String(value); this.children = [];
    const stack = [this];
    const tokens = this._html.match(/<[^>]+>|[^<]+/g) || [];
    for (const token of tokens) {
      if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (!token.startsWith('<')) {
        const current = stack.at(-1); current.textContent += decode(token);
        if (current.tagName === 'TEXTAREA') current.value += decode(token);
        continue;
      }
      if (token.startsWith('<!')) continue;
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const attrs = {};
      const body = token.slice(tag.length + 1, -1);
      for (const match of body.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[match[1]] = decode(match[2] ?? match[3] ?? match[4] ?? '');
      const parent = stack.at(-1), child = new Element(tag, attrs, parent); parent.children.push(child);
      if (!/^(input|img|br|hr|meta|link|source)$/i.test(tag) && !token.endsWith('/>')) stack.push(child);
    }
    for (const select of this.querySelectorAll('select')) {
      select.options = select.querySelectorAll('option').map(option => ({ value: option.attrs.value ?? option.textContent, selected: 'selected' in option.attrs }));
      select.value = (select.options.find(option => option.selected) || select.options[0] || {}).value || '';
    }
  }
  get innerHTML() { return this._html; }
  get firstChild() { return this.children[0]; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const all = []; const visit = node => { for (const child of node.children) { all.push(child); visit(child); } }; visit(this);
    return all.filter(node => selector.split(',').some(part => matchesChain(node, part.trim().split(/\s+/))));
  }
  pause() {}
}
function matches(node, token) {
  const tag = token.match(/^[a-z][\w-]*/i)?.[0]; if (tag && node.tagName !== tag.toUpperCase()) return false;
  const id = token.match(/#([\w-]+)/)?.[1]; if (id && node.attrs.id !== id) return false;
  for (const match of token.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(match[1])) return false;
  for (const match of token.matchAll(/\[([\w-]+)\]/g)) if (!(match[1] in node.attrs)) return false;
  return true;
}
function matchesChain(node, tokens) {
  if (!matches(node, tokens.at(-1))) return false;
  let ancestor = node.parent;
  for (let i = tokens.length - 2; i >= 0; i--) { while (ancestor && !matches(ancestor, tokens[i])) ancestor = ancestor.parent; if (!ancestor) return false; ancestor = ancestor.parent; }
  return true;
}
function fixture() {
  const days = Array.from({ length: 42 }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10), wd: '목', ig: [], reqs: [] }));
  return { at: '2026-11-19 06:43', today: '2026-11-19', tomorrow: '2026-11-20', days, pipelines: [], collected: {}, health: {}, results: [], photos: [
    { rel: 'photos/a.jpg', name: 'a.jpg', mtime: '11-19' }, { rel: 'photos/b.jpg', name: 'b.jpg', mtime: '11-19' }
  ], details: {}, unscheduled: [], requests: [], topics: [] };
}
function harness() {
  const root = new Element(); root.innerHTML = '<div id="app"></div><div id="sbg"></div><div id="sheet"><div id="shT"></div><div id="shX"></div><div id="shB"></div></div><div id="toast"></div>';
  const listeners = new Map(), intervals = new Map(), timeouts = new Map(), storage = new Map();
  let timerId = 0; const urls = { created: [], revoked: [] };
  const document = { visibilityState: 'visible', querySelector: selector => root.querySelector(selector), querySelectorAll: selector => root.querySelectorAll(selector), addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); } };
  const context = vm.createContext({ document, window: { scrollTo() {}, addEventListener() {} }, navigator: {}, location: { reload() {} },
    TextEncoder, TextDecoder, Uint8Array, Blob, Response, Date, console,
    URL: { createObjectURL(file) { const value = 'blob:test/' + (urls.created.length + 1); urls.created.push({ file, value }); return value; }, revokeObjectURL(value) { urls.revoked.push(value); } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    crypto: { getRandomValues: values => values.fill(1), subtle: {} },
    fetch: async () => { throw new Error('Live fetch forbidden in regression tests'); },
    setInterval(fn, ms) { const id = ++timerId; intervals.set(id, { fn, ms }); return id; }, clearInterval: id => intervals.delete(id),
    setTimeout(fn, ms) { const id = ++timerId; timeouts.set(id, { fn, ms }); return id; }, clearTimeout: id => timeouts.delete(id),
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  const run = code => vm.runInContext(code, context, { timeout: 1000 });
  run(source); context.__state = fixture();
  run('S=__state;K={};__originalLoad=load;load=async()=>{};TAB="photo";start()');
  return { context, document, run, urls, listeners, intervals, timeouts, el: id => document.querySelector('#' + id) };
}
function fillPhoto(h) {
  for (const [id, value] of Object.entries({ pT: '테스트 매장', pC: '현장', pF: '카드(사진 위주)', pD: '2026-11-20', pN: '첫 사진을 표지로' })) h.el(id).value = value;
  h.el('pO').checked = true;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('photo draft, existing photo selection and file pick survive render and tab changes', () => {
  const h = harness(); fillPhoto(h);
  h.context.__file = { name: 'a.jpg', type: 'image/jpeg' };
  h.run('PICK=[__file];showPick()');
  h.document.querySelectorAll('[data-mp]')[1].onclick();
  h.run('render()');
  assert.equal(h.el('pT').value, '테스트 매장'); assert.equal(h.el('pN').value, '첫 사진을 표지로');
  assert.equal(h.el('pD').value, '2026-11-20'); assert.equal(h.el('pO').checked, true);
  h.document.querySelectorAll('nav.bot button').find(b => b.dataset.tab === 'today').onclick();
  h.document.querySelectorAll('nav.bot button').find(b => b.dataset.tab === 'photo').onclick();
  assert.equal(h.el('pT').value, '테스트 매장'); assert.equal(h.el('pC').value, '현장');
  assert.equal(h.run('PICK.length'), 1);
  assert.deepEqual(plain(h.run('[...photoDraft.selected]')), ['photos/b.jpg']);
  assert.equal(h.document.querySelectorAll('[data-mp]')[1].style.outline, '3px solid var(--accent)');
});

test('successful background load updates data without replacing an active photo form', async () => {
  const h = harness(); fillPhoto(h); const titleInput = h.el('pT');
  h.context.__fresh = { ...fixture(), at: '2026-11-19 06:44' };
  h.run('ghRaw=async path=>path==="d/state.bin"?TE.encode(JSON.stringify(__fresh)):null;dec=async b=>b;unpack=async b=>b;load=__originalLoad');
  await h.run('load(true)');
  assert.equal(h.run('S.at'), '2026-11-19 06:44'); assert.equal(h.el('pT'), titleInput);
  assert.equal(titleInput.value, '테스트 매장'); assert.equal(h.el('pN').value, '첫 사진을 표지로');
});

test('existing-photo selection retains the displayed file path after background state reorders', async () => {
  const h = harness(); const displayedPhotos = h.document.querySelectorAll('[data-mp]');
  h.context.__fresh = fixture(); h.context.__fresh.photos.reverse();
  h.run('ghRaw=async path=>path==="d/state.bin"?TE.encode(JSON.stringify(__fresh)):null;dec=async b=>b;unpack=async b=>b;load=__originalLoad');
  await h.run('load(true)');
  displayedPhotos[0].onclick();
  assert.deepEqual(plain(h.run('[...photoDraft.selected]')), ['photos/a.jpg']);
  h.run('render()');
  assert.equal(h.document.querySelectorAll('[data-mp]')[1].style.outline, '3px solid var(--accent)');
});

test('upload snapshots files and metadata before await, rejects duplicate calls, and releases previews', async () => {
  const h = harness(); fillPhoto(h); h.el('pO').checked = false;
  h.context.__file = { name: 'a.jpg', type: 'image/jpeg' };
  let release; h.context.__pause = new Promise(resolve => { release = resolve; });
  h.context.__puts = []; h.context.__commands = [];
  h.run('PICK=[__file];showPick();shrink=async f=>{await __pause;return {name:f.name,bytes:new Uint8Array([1,2])}};enc=async b=>b;ghPut=async(...args)=>__puts.push(args);send=async(...args)=>__commands.push(args);start=()=>{}');
  const upload = h.run('sendPhotos()');
  assert.equal(h.run('UPLOADING'), true); assert.equal(h.el('pN').disabled, true);
  await h.run('sendPhotos()');
  h.el('pT').value = 'changed'; h.el('pN').value = 'changed'; h.el('pD').value = '';
  h.run('PICK.push({name:"extra.jpg",type:"image/jpeg"})');
  release(); await upload;
  assert.equal(h.context.__puts.length, 1); assert.equal(h.context.__commands.length, 1);
  const [type, body, , files] = h.context.__commands[0];
  assert.equal(type, 'photos');
  assert.deepEqual(plain(body), { title: '테스트 매장', category: '현장', format: '카드(사진 위주)', date: '2026-11-20', note: '첫 사진을 표지로', only_inbox: false });
  assert.equal(files.length, 1); assert.equal(files[0].orig, 'a.jpg');
  assert.equal(h.run('UPLOADING'), false); assert.equal(h.el('pN').disabled, false);
  assert.equal(h.run('PICKURL.size'), 0); assert.equal(h.urls.revoked.length, 1);
});

test('preview URLs are reused on redraw and revoked when files are removed', () => {
  const h = harness(); h.context.__files = [{ name: 'a.jpg', type: 'image/jpeg' }, { name: 'b.mp4', type: 'video/mp4' }];
  h.run('PICK=__files.slice();showPick();showPick()');
  assert.equal(h.urls.created.length, 2); assert.equal(h.urls.revoked.length, 0);
  h.run('PICK.splice(0,1);showPick()');
  assert.equal(h.urls.created.length, 2); assert.deepEqual(h.urls.revoked, ['blob:test/1']);
  h.run('PICK=[];showPick()'); assert.deepEqual(h.urls.revoked, ['blob:test/1', 'blob:test/2']);
});

test('repeated start keeps one periodic refresh timer and one visibility listener', () => {
  const h = harness(); h.run('start();start();start()');
  assert.equal([...h.intervals.values()].filter(timer => timer.ms === 90000).length, 1);
  assert.equal(h.listeners.get('visibilitychange').length, 1);
});

test('two-click actions recover after thrown errors and handled failures', async () => {
  const h = harness(); const btn = new Element('button'); btn.textContent = '게시'; h.context.__button = btn;
  h.run('armTwice(__button,"확인",async()=>{throw new Error("offline")})');
  await btn.onclick(); assert.equal(btn.textContent, '확인'); await btn.onclick();
  assert.equal(btn.disabled, false); assert.equal(btn.textContent, '게시'); assert.equal(btn.classList.contains('danger'), false);
  h.run('armTwice(__button,"확인",async()=>false)'); await btn.onclick(); await btn.onclick();
  assert.equal(btn.disabled, false); assert.equal(btn.textContent, '게시');
});

test('publish requires explicit review, the preview fingerprint and an unchanged caption', async () => {
  const h = harness(); h.context.__calls = [];
  h.context.__detail = { cards: [], raw: [], caption: '승인한 캡션', check: { items: [], verdict: 'ok' }, publication_preview: null };
  h.run('S.unscheduled=[{rel:"episodes/test",title:"테스트"}];S.details.test=__detail;send=async(...args)=>__calls.push(args);start=()=>{};hydrate=()=>{};openEp("episodes/test")');
  let publish = h.el('ePub'); assert.equal(publish.disabled, true); assert.equal(h.context.__calls.length, 0);
  h.run('__detail.publication_preview={fingerprint:"expected-preview-fingerprint"};__detail.cards=["finished-card-key"];openEp("episodes/test")');
  publish = h.el('ePub'); assert.equal(publish.disabled, true); await publish.onclick(); await publish.onclick(); assert.equal(h.context.__calls.length, 0);
  h.el('eChecked').checked = true; h.el('eChecked').onchange(); assert.equal(publish.disabled, false);
  h.el('eCap').value = '아직 저장하지 않은 수정'; h.el('eCap').oninput(); await publish.onclick(); await publish.onclick(); assert.equal(h.context.__calls.length, 0);
  assert.equal(h.el('eChecked').checked, false); assert.equal(publish.disabled, true);
  h.el('eCap').value = '승인한 캡션'; h.el('eCap').oninput(); h.el('eChecked').checked = true; h.el('eChecked').onchange(); await publish.onclick(); await publish.onclick();
  assert.equal(h.context.__calls.length, 1);
  assert.deepEqual(plain(h.context.__calls[0].slice(0, 2)), ['publish', { folder: 'episodes/test', allow_warn: false, fingerprint: 'expected-preview-fingerprint', reviewed: true, reviewed_fingerprint: 'expected-preview-fingerprint' }]);
});

test('raw-video-only detail shows its video but keeps publishing disabled until a finished asset exists', () => {
  const h = harness();
  h.context.__detail = { cards: [], raw: [], raw_videos: ['raw-video-key'], raw_video_n: 1, caption: '초안', check: { items: [], verdict: 'ok' }, publication_preview: { fingerprint: 'raw-only-fingerprint' } };
  h.run('S.unscheduled=[{rel:"episodes/test",title:"테스트"}];S.details.test=__detail;hydrate=()=>{};openEp("episodes/test")');
  assert.equal(h.el('ePub').disabled, true);
  assert.equal(h.el('shB').querySelectorAll('video').length, 1);
  assert.equal(h.el('shB').querySelectorAll('video')[0].dataset.m, 'raw-video-key');
  h.run('__detail.video="finished-video-key";openEp("episodes/test")');
  assert.equal(h.el('ePub').disabled, true); assert.equal(h.el('eChecked').disabled, false);
  h.el('eChecked').checked = true; h.el('eChecked').onchange();
  assert.equal(h.el('ePub').disabled, false); assert.equal(typeof h.el('ePub').onclick, 'function');
});

test('all registered episodes appear in the review queue and status filters keep the correct items', () => {
  const h = harness();
  h.context.__queue = [
    { rel: 'older/ready', title: '이전 날짜 완성본', status: 'review' },
    { rel: 'future/running', title: '새 사진 제작 중', status: 'running' },
    { rel: 'unscheduled/failed', title: '원본 확인 요청', status: 'failed', reason: '사진을 확인해 주세요' }
  ];
  h.run('S.review_queue=__queue;TAB="today";render()');
  assert.match(h.el('main').innerHTML, /발행 전 검토/);
  assert.equal(h.document.querySelectorAll('[data-open]').length, 3);
  h.document.querySelectorAll('[data-review-filter]').find(el => el.dataset.reviewFilter === 'review').onclick();
  assert.deepEqual(h.document.querySelectorAll('[data-open]').map(el => el.dataset.open), ['older/ready']);
  h.document.querySelectorAll('[data-review-filter]').find(el => el.dataset.reviewFilter === 'working').onclick();
  assert.deepEqual(h.document.querySelectorAll('[data-open]').map(el => el.dataset.open), ['future/running']);
  h.document.querySelectorAll('[data-review-filter]').find(el => el.dataset.reviewFilter === 'attention').onclick();
  assert.deepEqual(h.document.querySelectorAll('[data-open]').map(el => el.dataset.open), ['unscheduled/failed']);
  assert.equal(h.document.querySelectorAll('[data-produce]').length, 1);
});

test('review entries outside the calendar can open their exact-path details', () => {
  const h = harness();
  h.run('S.review_queue=[{rel:"older/same-name",title:"지난 날짜 검토본",status:"review"}];S.details["older/same-name"]={cards:["finished-card"],caption:"완성 캡션",check:{items:[],verdict:"ok"},publication_preview:{fingerprint:"fp-old"}};hydrate=()=>{};openEp("older/same-name")');
  assert.equal(h.el('shT').textContent, '지난 날짜 검토본');
  assert.equal(h.el('eCap').value, '완성 캡션');
  assert.equal(h.el('eChecked').disabled, false);
});

test('an explicitly empty review queue does not resurface old production jobs', () => {
  const h = harness();
  h.run('S.review_queue=[];S.production={jobs:[{rel:"already/posted",title:"이미 게시된 회차",status:"review"}]};TAB="today";render()');
  assert.equal(h.document.querySelectorAll('[data-open]').length, 0);
  assert.doesNotMatch(h.el('main').innerHTML, /이미 게시된 회차/);
});

test('production in progress blocks stale finished assets from approval', () => {
  const h = harness();
  h.run('S.review_queue=[{rel:"episodes/test",title:"제작중 회차",status:"review"}];S.production={jobs:[{rel:"episodes/test",status:"running",message:"새 완성본 제작 중"}]};S.details.test={cards:["old-card"],caption:"이전 캡션",check:{items:[],verdict:"ok"},publication_preview:{fingerprint:"old-fp"}};hydrate=()=>{};openEp("episodes/test")');
  assert.equal(h.el('eChecked').disabled, true); assert.equal(h.el('ePub').disabled, true);
  h.run('S.production.jobs[0].status="review";openEp("episodes/test")');
  assert.equal(h.el('eChecked').disabled, false); assert.equal(h.el('eChecked').checked, false);
});

test('a changed preview fingerprint invalidates a checked and armed publication', async () => {
  const h = harness(); h.context.__calls = [];
  h.run('S.review_queue=[{rel:"episodes/test",title:"회차",status:"review"}];S.details.test={cards:["card"],caption:"캡션",check:{items:[],verdict:"ok"},publication_preview:{fingerprint:"first-fp"}};send=async(...args)=>__calls.push(args);hydrate=()=>{};openEp("episodes/test")');
  h.el('eChecked').checked = true; h.el('eChecked').onchange();
  const publish = h.el('ePub'); await publish.onclick();
  h.run('S.details.test={...S.details.test,publication_preview:{fingerprint:"new-fp"}}');
  await publish.onclick();
  assert.equal(h.context.__calls.length, 0); assert.equal(h.el('eChecked').checked, false); assert.equal(publish.disabled, true);
  h.run('openEp("episodes/test")'); assert.equal(h.el('eChecked').checked, false);
});

test('unchecking review cancels an armed action and cannot be undone by its timeout', async () => {
  const h = harness();
  h.run('S.unscheduled=[{rel:"episodes/test",title:"회차"}];S.details.test={cards:["card"],caption:"캡션",check:{items:[],verdict:"ok"},publication_preview:{fingerprint:"fp"}};hydrate=()=>{};openEp("episodes/test")');
  h.el('eChecked').checked = true; h.el('eChecked').onchange(); await h.el('ePub').onclick();
  const timeout = [...h.timeouts.values()].find(timer => timer.ms === 5000);
  h.el('eChecked').checked = false; h.el('eChecked').onchange(); timeout.fn();
  assert.equal(h.el('ePub').disabled, true); assert.equal(h.el('ePub').classList.contains('danger'), false);
});

test('failed production can be retried without any publication command', async () => {
  const h = harness(); h.context.__calls = [];
  h.run('S.review_queue=[{rel:"episodes/test",title:"회차",status:"failed"}];S.production={jobs:[{rel:"episodes/test",status:"failed",message:"원본 확인 후 다시 제작"}]};send=async(...args)=>__calls.push(args);TAB="today";render()');
  const button = h.document.querySelectorAll('[data-produce]')[0];
  await button.onclick({ stopPropagation() {} });
  assert.deepEqual(plain(h.context.__calls[0].slice(0, 2)), ['produce', { folder: 'episodes/test' }]);
  assert.equal(button.disabled, true); assert.equal(h.context.__calls.length, 1);
});

function historyFixture() {
  const state = fixture();
  const items = Array.from({length:243}, (_,i) => {
    const day = i===242?'2026-05-19':new Date(Date.UTC(2026,10,19-Math.floor(i*184/242))).toISOString().slice(0,10);
    return {id:'post-'+i,media_id:String(18000000000000000n+BigInt(i)),title:i<2?'같은 제목':'기존 게시물 '+i,
      caption:i===242?'오래된 본문의 숨겨진검색어 전체 캡션':'지점 운영 메모 '+i,date:day,month:day.slice(0,7),published_at:day+'T03:00:00+0000',
      kind:i%3===0?'REELS':i%3===1?'CAROUSEL_ALBUM':'IMAGE',status:'api_verified',category:'가게운영',origin:'instagram_only',
      permalink:'https://www.instagram.com/p/fixture'+i+'/',media_count:null,metrics:{views:null,likes:i===0?0:null,saved:null}};
  });
  for(let i=0;i<3;i++)items.push({id:'local-'+i,title:'로컬 기록 '+i,caption:'별도 로컬 캡션 '+i,date:'2026-07-2'+i,month:'2026-07',kind:i===0?'카드':'릴스',status:'local_only',origin:'local_only',metrics:{}});
  items.push({id:'unconfirmed',title:'',caption:'',date:'unknown',kind:'CAROUSEL_ALBUM',status:'api_unconfirmed',permalink:'javascript:alert(1)',media_count:null,metrics:{}});
  state.published_history={items,summary:{api_count:243,local_only_count:3,api_unconfirmed_count:1,total:247,complete:true,synced_at:'2026-11-19T08:44:00+09:00',oldest:'2026-05-19',newest:'2026-11-19'}};
  return state;
}
function showHistory(h) {
  h.context.__historyState=historyFixture();
  h.run('S=__historyState;TAB="cal";CALF="past";vCal()');
}

test('all 243 confirmed posts are searchable beyond the calendar and pagination limit', () => {
  const h=harness();showHistory(h);
  assert.equal(h.run('filteredHistory().length'),243);
  assert.equal(h.document.querySelectorAll('[data-history]').length,50);
  assert.match(h.el('hSummary').innerHTML,/인스타 확인 243개/);
  assert.match(h.el('hSummary').innerHTML,/로컬 기록 3개 별도/);
  h.el('hMore').onclick();
  assert.equal(h.document.querySelectorAll('[data-history]').length,100);
  h.el('hQuery').value='숨겨진검색어';h.el('hQuery').oninput({target:h.el('hQuery')});
  assert.equal(h.run('HISTORY_FILTER.limit'),50);
  assert.equal(h.run('filteredHistory().length'),1);
  assert.equal(h.document.querySelectorAll('[data-history]')[0].dataset.history,'post-242');
  assert.match(h.el('hRows').innerHTML,/2026-05-19/);
  assert.equal(h.el('hMonth').options.some(o=>o.value==='2026-05'),true);
});

test('month, normalized kind, status and caption search combine with accurate counts', () => {
  const h=harness();showHistory(h);
  h.el('hStatus').value='local_only';h.el('hStatus').onchange({target:h.el('hStatus')});
  assert.equal(h.run('filteredHistory().length'),3);
  h.el('hMonth').value='2026-07';h.el('hMonth').onchange({target:h.el('hMonth')});
  h.el('hKind').value='카드';h.el('hKind').onchange({target:h.el('hKind')});
  h.el('hQuery').value='로컬 캡션';h.el('hQuery').oninput({target:h.el('hQuery')});
  assert.equal(h.run('filteredHistory().length'),1);
  assert.equal(h.document.querySelectorAll('[data-history]')[0].dataset.history,'local-0');
  assert.equal(h.el('hCount').textContent,'검색 결과 1개 · 1개 표시');
  h.el('hReset').onclick();
  assert.equal(h.run('filteredHistory().length'),243);
  assert.equal(h.run('historyKind({kind:"CAROUSEL_ALBUM"})'),'카드');
  assert.equal(h.run('historyKind({kind:"REELS"})'),'릴스');
});

test('published history detail is read only even when a matching unposted folder has approval data', () => {
  const h=harness();showHistory(h);h.context.__sent=[];
  h.run('send=async(...args)=>__sent.push(args);S.published_history.items[0].rel="same-folder";S.details["same-folder"]={cards:["x"],caption:"다른 초안",publication_preview:{fingerprint:"draft"}};S.published_history.items[0].media=[{type:"IMAGE",media_url:"https://cdn.example/one.jpg"},{type:"VIDEO",media_url:"https://cdn.example/two.mp4",thumbnail_url:"https://cdn.example/two.jpg"}];openEp=()=>{throw new Error("Published history must not open approval editor")};openPublishedHistory("post-0")');
  assert.equal(h.el('historyCaption').textContent,'지점 운영 메모 0');
  for(const id of ['ePub','eChecked','eSave','eRevGo','eProduce'])assert.equal(h.el(id),null);
  assert.equal(h.el('shB').querySelectorAll('[data-produce]').length,0);
  assert.equal(h.el('shB').querySelectorAll('video')[0].attrs.preload,'none');
  assert.match(h.el('shB').innerHTML,/href="https:\/\/www.instagram.com\/p\/fixture0\//);
  assert.match(h.el('shB').innerHTML,/<b>좋아요<\/b><span>0<\/span>/);
  assert.match(h.el('shB').innerHTML,/<b>조회<\/b><span>미집계<\/span>/);
  assert.equal(h.context.__sent.length,0);
});

test('unknown media count, missing caption and unconfirmed records are never presented as verified zeros', () => {
  const h=harness();showHistory(h);
  h.run('openPublishedHistory("unconfirmed")');
  assert.match(h.el('shB').innerHTML,/현재 인스타 확인 대기/);
  assert.match(h.el('shB').innerHTML,/개수 미확인/);
  assert.match(h.el('shB').innerHTML,/날짜|게시일 미확인/);
  assert.equal(h.el('historyCaption').textContent,'(캡션 없음)');
  assert.equal(h.el('shB').querySelectorAll('a').length,0);
  assert.equal(h.run('historyMetric(0)'),'0');
  assert.equal(h.run('historyMetric(null)'),'미집계');
  assert.equal(h.run('historyMetric(undefined)'),'미집계');
});

test('quiet history refresh preserves the search input node and text while updating results', async () => {
  const h=harness();showHistory(h);
  const input=h.el('hQuery');input.value='숨겨진검색어';input.oninput({target:input});
  h.context.__fresh=historyFixture();h.context.__fresh.at='2026-11-19 09:00';h.context.__fresh.published_history.items[0].caption='추가된 숨겨진검색어';
  h.run('ghRaw=async path=>path==="d/state.bin"?TE.encode(JSON.stringify(__fresh)):null;dec=async b=>b;unpack=async b=>b;load=__originalLoad');
  await h.run('load(true)');
  assert.equal(h.el('hQuery'),input);
  assert.equal(input.value,'숨겨진검색어');
  assert.equal(h.run('S.at'),'2026-11-19 09:00');
  assert.equal(h.el('hCount').textContent,'검색 결과 2개 · 2개 표시');
});

test('today history shortcut opens the full confirmed archive without losing older records', () => {
  const h=harness();h.context.__historyState=historyFixture();h.run('S=__historyState;TAB="today";render()');
  assert.match(h.el('goHistory').textContent,/인스타 243개/);
  h.el('goHistory').onclick();
  assert.equal(h.run('TAB'),'cal');assert.equal(h.run('CALF'),'past');
  assert.equal(h.run('filteredHistory().length'),243);
});
