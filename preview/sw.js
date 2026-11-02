const VERSION='wsetrev-v1.1.0';
const ATLAS='wsetrev-atlas-8fdac19b8f';
const ASSETS=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION&&k!==VERSION+'-fonts'&&k!==ATLAS).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.hostname==='api.github.com') return;
  if(u.hostname.endsWith('googleapis.com')||u.hostname.endsWith('gstatic.com')){
    e.respondWith(caches.open(VERSION+'-fonts').then(c=>c.match(e.request).then(hit=>{const net=fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r;}).catch(()=>hit);return hit||net;})));return;}
  if(u.origin!==location.origin) return;
  // the Atlas: cached whole the first time it is opened, kept until its files change (D43)
  if(u.pathname.includes('/atlas/')){
    e.respondWith(caches.open(ATLAS).then(c=>c.match(e.request,{ignoreSearch:true}).then(hit=>hit||fetch(e.request).then(r=>{if(r.status===200)c.put(e.request,r.clone());return r;}))));return;}
  if(e.request.mode==='navigate'){e.respondWith(caches.match('index.html').then(r=>r||fetch(e.request)));return;}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
