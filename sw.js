// 세왕 발행실 폰 앱 — 화면 파일만 캐시(데이터는 항상 GitHub API에서 새로)
const C='sw-shell-v2';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==C&&k!=='sw-media')await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||new Response('오프라인입니다',{headers:{'Content-Type':'text/plain; charset=utf-8'}}))));
});
