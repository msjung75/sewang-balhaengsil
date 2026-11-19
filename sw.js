// 세왕 발행실 폰 앱 — 화면 파일만 캐시(데이터는 항상 GitHub API에서 새로)
const C='sw-shell-v5';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('sw-shell-')&&k!==C)await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(!/\/(?:index\.html|config\.json|manifest\.webmanifest)?$/.test(u.pathname)&&!u.pathname.includes('/icons/'))return;
  e.respondWith((async()=>{
    const cache=await caches.open(C);
    try{const r=await fetch(e.request);if(r.ok)await cache.put(e.request,r.clone()).catch(()=>{});return r}
    catch(e){return await cache.match(e.request,{ignoreSearch:true})||new Response('오프라인입니다. 인터넷 연결 후 다시 열어 주세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}
  })());
});
