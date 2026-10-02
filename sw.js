// Service worker: l'app funziona offline. Tutti i file sono messi in cache
// all'installazione; quando cambia VERSION si scarica tutto di nuovo.
const VERSION = '1.3.0';
const CACHE = `dk3-roster-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/importer.js', 'js/polyfills.js', 'js/state.js', 'js/timefmt.js', 'js/util.js', 'js/version.js',
  'js/views-calendar.js', 'js/views-map.js', 'js/map.js', 'js/worldmap.js', 'js/views-detail.js', 'js/views-list.js', 'js/views-more.js', 'js/views-recurrent.js', 'js/views-stats.js',
  'src/parser.js', 'src/trips.js', 'src/geo.js', 'src/airports-geo.js', 'src/tz.js', 'src/timeline.js', 'src/recurrent.js', 'src/diff.js', 'src/merge.js', 'src/stats.js', 'src/ics.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
