// Cache only the static app shell, never authenticated API data.
const CACHE = 'gauamrut-shell-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/index.html', '/icon.svg', '/manifest.webmanifest']))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('gauamrut-shell-') && k !== CACHE).map(k => caches.delete(k))))); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/index.html'))); return; }
  if (url.pathname.startsWith('/assets/') || ['/icon.svg', '/manifest.webmanifest'].includes(url.pathname)) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); } return response; })));
});
