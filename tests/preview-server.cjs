'use strict';
// Local integration fixture. It uses disposable keys, synthetic assets and no remote service.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const host = '127.0.0.1', port = 18876, origin = `http://${host}:${port}`;
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sewang-browser-fixture-'));
const password = 'local-test-only'; // Deliberately public, nonsecret fixture password.
const salt = Buffer.from('synthetic-fixture-salt-v1'), iterations = 2000;
const bits = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha256');
const logFile = path.join(fixtureDir, 'events.jsonl');
function log(event) { fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); }
function encrypt(plain) {
  const iv = crypto.randomBytes(16), cipher = crypto.createCipheriv('aes-256-cbc', bits.subarray(0, 32), iv);
  const body = Buffer.concat([Buffer.from('SW1'), iv, cipher.update(plain), cipher.final()]);
  return Buffer.concat([body, crypto.createHmac('sha256', bits.subarray(32)).update(body).digest()]);
}
function decrypt(envelope) {
  if (envelope.subarray(0, 3).toString() !== 'SW1') throw new Error('Invalid fixture envelope');
  const body = envelope.subarray(0, -32), tag = envelope.subarray(-32);
  if (!crypto.timingSafeEqual(tag, crypto.createHmac('sha256', bits.subarray(32)).update(body).digest())) throw new Error('Fixture HMAC mismatch');
  const decipher = crypto.createDecipheriv('aes-256-cbc', bits.subarray(0, 32), body.subarray(3, 19));
  const plain = Buffer.concat([decipher.update(body.subarray(19)), decipher.final()]);
  if (plain[0] === 82) return plain.subarray(1);
  if (plain[0] === 71) return zlib.gunzipSync(plain.subarray(1));
  return plain;
}
const pack = value => encrypt(Buffer.concat([Buffer.from('R'), Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))]));
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) { const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([size, name, bytes, checksum]); }
function syntheticPNG() {
  const width = 700, height = 875, stride = width * 3 + 1, pixels = Buffer.alloc(height * stride);
  const rect = (x, y, w, h, rgb) => { for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) for (let col = Math.max(0, x); col < Math.min(width, x + w); col++) { const p = row * stride + 1 + col * 3; pixels[p] = rgb[0]; pixels[p + 1] = rgb[1]; pixels[p + 2] = rgb[2]; } };
  rect(0, 0, width, height, [31, 95, 91]); rect(45, 45, 610, 785, [242, 239, 220]); rect(75, 245, 550, 355, [211, 164, 68]);
  for (let i = 0; i < 6; i++) rect(100 + i * 80, 280 + (i % 2) * 35, 48, 270 - (i % 2) * 35, [31 + i * 7, 95 + i * 5, 91 + i * 4]);
  const font = { A:'01110100011000111111100011000110001', C:'01111100001000010000100001000001111', E:'11111100001000011110100001000011111', H:'10001100011000111111100011000110001', L:'10000100001000010000100001000011111', N:'10001110011010110011100011000110001', O:'01110100011000110001100011000101110', P:'11110100011000111110100001000010000', R:'11110100011000111110101001001010001', S:'01111100001000001110000010000111110', T:'11111001000010000100001000010000100', V:'10001100011000110001100010101000100', W:'10001100011000110101101011101110001', Y:'10001100010101000100001000010000100', I:'11111001000010000100001000010011111' };
  const text = (value, x, y, scale, color) => { for (const char of value) { const glyph = font[char]; if (glyph) for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if (glyph[row * 5 + col] === '1') rect(x + col * scale, y + row * scale, scale, scale, color); x += 6 * scale; } };
  text('LOCAL TEST', 85, 100, 8, [31, 95, 91]); text('PHOTO', 178, 655, 10, [31, 95, 91]); text('PREVIEW ONLY', 110, 765, 6, [72, 77, 69]);
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const image = syntheticPNG(), uploadFile = path.join(fixtureDir, 'synthetic-upload.png'); fs.writeFileSync(uploadFile, image);
const media = new Map([['fixture-card-v1', image], ['fixture-photo-v1', image]]), inbox = new Map();
const minute = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const today = minute().slice(0, 10), midnight = Date.parse(today + 'T00:00:00Z');
const dayOffset = offset => new Date(midnight + offset * 86400000).toISOString().slice(0, 10);
const state = { at: minute(), today, tomorrow: dayOffset(1), days: Array.from({ length: 42 }, (_, i) => ({ day: dayOffset(i - 21), wd: '목', ig: [], reqs: [], folder: null })),
  pipelines: [{ day: today, steps: [] }, { day: dayOffset(1), steps: [] }], alerts: [{ level: 'info', msg: '로컬 검증용 앱입니다. 실제 인스타그램에는 게시되지 않습니다.' }],
  collected: { news: minute(), ig: minute() }, health: { onedrive: { installed: true, running: true, cloud_only: 0 } }, results: [], jobs: [], photos: [],
  details: {}, review_queue: [], production: {jobs: []}, unscheduled: [], requests: [], topics: [], world: [], deep: [], deep_requests: [], workflow: { summary: { planned_count: 0 }, plan: [], candidates: [] } };
const config = { v: 1, repo: 'test/app', api: origin, salt: salt.toString('base64'), iter: iterations, tok: encrypt(Buffer.from('local-fixture-token')).toString('base64'), at: 'local-integration-fixture-v1' };
let episodeCount = 0;
function snapshot() { state.at = minute(); fs.writeFileSync(path.join(fixtureDir, 'state.json'), JSON.stringify(state, null, 2)); }
function result(command, ok, msg) { state.results.push({ id: command.id, ok, msg, at: minute() }); state.results = state.results.slice(-20); snapshot(); }
function processCommand(command) {
  const body = command.body || {}; log({ event: 'command', command });
  if (command.type === 'photos' || command.type === 'assign_photos') {
    if (command.type === 'photos' && body.only_inbox) {
      for (const file of command.files || []) state.photos.push({ rel: 'fixture/' + file.name, name: file.orig, thumb: 'fixture-photo-v1', mtime: minute().slice(5) });
      return result(command, true, '검증용 사진함에 등록했습니다');
    }
    const number = ++episodeCount, name = `local-test-${number}`, rel = `episodes/${name}`, day = body.date || today;
    const episode = { rel, title: body.title || '로컬 테스트 회차', hook: body.title || '로컬 테스트 회차', kind: '카드', category: body.category || '현장', thumb: 'fixture-card-v1' };
    const calendarDay = state.days.find(d => d.day === day); if (calendarDay) { calendarDay.ep = episode; calendarDay.folder = rel; } else state.unscheduled.push(episode);
    const raw = (command.files || []).map((file, i) => { const key = `uploaded-${number}-${i}`; media.set(key, inbox.get(file.name) || image); return key; });
    state.review_queue.push({...episode,status:'review',reason:'검증용 완성본',at:minute(),name});
    state.details[name] = { preview_ready:true, cards: ['fixture-card-v1'], raw, raw_n: raw.length, raw_videos: [], raw_video_n: 0, caption: '로컬 검증용 캡션입니다. #로컬테스트 #미리보기 #세왕상사',
      check: { verdict: 'ok', items: [{ item: '검증 환경', level: 'ok', msg: '가상 자료로만 처리합니다' }] }, request: body.note || '', publication_preview: { fingerprint: `local-preview-${number}-v1` } };
    if (!state.pipelines.some(p => p.day === day)) state.pipelines.push({ day, steps: [] });
    state.pipelines.find(p => p.day === day).steps = [{ label: '사진 등록', state: 'ok', note: '검증용' }, { label: '미리보기', state: 'ok', note: '검증용' }, { label: '승인', state: 'wait', note: '검증용' }];
    return result(command, true, '로컬 초안을 만들었습니다 — 미리보기를 확인하세요');
  }
  if (command.type === 'publish') {
    const name = (body.folder || '').split('/').pop(), detail = state.details[name];
    if (!detail || body.fingerprint !== detail.publication_preview.fingerprint) return result(command, false, '미리보기 fingerprint가 일치하지 않습니다');
    if(body.reviewed!==true||body.reviewed_fingerprint!==body.fingerprint)return result(command,false,'최종 내용 확인 체크가 필요합니다');
    const episode = state.days.map(d => d.ep).find(e => e && e.rel === body.folder) || state.unscheduled.find(e => e.rel === body.folder);
    if (episode) episode.posted = { at: minute(), permalink: `${origin}/mock-post/${encodeURIComponent(name)}`, story: 'ok' };
    state.review_queue=state.review_queue.filter(item=>item.rel!==body.folder);
    log({ event: 'mock-published', folder: body.folder, fingerprint: body.fingerprint });
    return result(command, true, '가상 게시 완료 — 실제 인스타그램 전송 없음');
  }
  if (command.type === 'caption') {
    const name = (body.folder || '').split('/').pop(); if (state.details[name]) { state.details[name].caption = body.text; state.details[name].publication_preview.fingerprint += '-caption'; }
    return result(command, true, '검증용 캡션을 저장했습니다');
  }
  return result(command, true, '로컬 검증 요청을 처리했습니다: ' + command.type);
}
snapshot();
function respond(res, status, content, type = 'application/octet-stream') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(content); }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin), pathname = decodeURIComponent(url.pathname);
    if (req.method === 'GET' && pathname === '/config.json') return respond(res, 200, JSON.stringify(config), 'application/json');
    if (req.method === 'GET' && pathname === '/__fixture/status') return respond(res, 200, JSON.stringify({ fixtureDir, uploadFile, episodes: episodeCount, results: state.results }), 'application/json');
    if (req.method === 'GET' && pathname.startsWith('/mock-post/')) return respond(res, 200, '<!doctype html><meta charset="utf-8"><h1>로컬 가상 게시 완료</h1><p>실제 서비스에는 전송하지 않았습니다.</p>', 'text/html; charset=utf-8');
    const apiPrefix = '/repos/test/app/contents/';
    if (pathname.startsWith(apiPrefix)) {
      if (req.headers.authorization !== 'Bearer local-fixture-token') return respond(res, 401, '{"message":"Fixture auth required"}', 'application/json');
      const filePath = pathname.slice(apiPrefix.length);
      if (req.method === 'GET') {
        log({ event: 'read', path: filePath });
        if (filePath === 'd/state.bin') return respond(res, 200, pack(state));
        if (filePath === 'd/ping.json') return respond(res, 200, JSON.stringify({ at: minute(), server: 'local-fixture' }), 'application/json');
        if (filePath.startsWith('d/m/')) { const bytes = media.get(filePath.slice(4).replace(/\.bin$/, '')); return bytes ? respond(res, 200, pack(bytes)) : respond(res, 404, 'No fixture media'); }
        return respond(res, 404, 'Unknown fixture path');
      }
      if (req.method === 'PUT' && filePath.startsWith('inbox/')) {
        const parts = []; for await (const part of req) parts.push(part);
        const request = JSON.parse(Buffer.concat(parts).toString()), plain = decrypt(Buffer.from(request.content, 'base64')), name = filePath.slice(6);
        if (name.startsWith('c_')) processCommand(JSON.parse(plain.toString()));
        else { inbox.set(name, plain); fs.writeFileSync(path.join(fixtureDir, name.replace(/[^\w.-]/g, '_') + '.decrypted'), plain); log({ event: 'uploaded', name, bytes: plain.length }); }
        return respond(res, 201, JSON.stringify({ content: { sha: 'fixture-sha' }, commit: { sha: 'fixture-commit' } }), 'application/json');
      }
      return respond(res, 405, 'Fixture method not supported');
    }
    if (req.method !== 'GET') return respond(res, 405, 'Read only static fixture');
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1), file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || relative.startsWith('.git/')) return respond(res, 404, 'Not found');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
    return respond(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'text/plain');
  } catch (error) { log({ event: 'error', message: error.message }); return respond(res, 500, JSON.stringify({ message: error.message }), 'application/json'); }
});
server.listen(port, host, () => console.log(JSON.stringify({ url: origin, password, fixtureDir, uploadFile, logFile, pid: process.pid })));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
