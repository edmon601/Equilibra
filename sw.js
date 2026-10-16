/* Equilibra - service worker
   Busca sempre a versão mais nova quando há internet e usa a cópia guardada quando não há. */
const VERSAO = 'equilibra-v31';
const COMPARTILHADO = 'equilibra-compartilhado'; /* arquivo vindo do "Compartilhar" do banco, até o app abrir */
const ARQUIVOS = ['./equilibra.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO && k !== COMPARTILHADO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).searchParams.has('compartilhar')) {
    e.respondWith((async () => {
      try {
        const f = (await req.formData()).get('arquivo');
        if (f && f.size) await (await caches.open(COMPARTILHADO)).put('./compartilhado', new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }));
      } catch (er) {}
      return Response.redirect(new URL('./equilibra.html?compartilhado=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; /* Google Drive e login passam direto */
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./equilibra.html')))
  );
});

/* notificação que chegou pelo Firebase: com o app aberto na tela, só pede para sincronizar;
   fechado ou em segundo plano, mostra o aviso */
self.addEventListener('push', e => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch (er) {}
  const d = p.data || p, n = p.notification || {};
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const aberto = ws.find(w => w.visibilityState === 'visible');
    ws.forEach(w => w.postMessage({ equilibra: 'push' }));
    if (aberto) return;
    return self.registration.showNotification(String(d.titulo || n.title || 'Equilibra').slice(0, 60), {
      body: String(d.corpo || n.body || 'Novidades no Equilibra').slice(0, 200), icon: './icon-192.png', badge: './badge-96.png',
      tag: String(d.tag || 'equilibra'), renotify: true
    });
  }));
});

/* tocar na notificação abre o app (ou traz para a frente se já estiver aberto) */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.includes('equilibra'));
    return w ? w.focus() : self.clients.openWindow('./equilibra.html');
  }));
});
