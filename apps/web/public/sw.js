// Service worker de BioCiencia: guarda la interfaz para abrirla sin conexión.
// Los datos científicos NO pasan por aquí: viven en SQLite (OPFS).
// Las llamadas a API externas nunca se guardan en caché.
//
// v2: la interfaz (HTML) se sirve SIEMPRE desde la red cuando hay conexión, y solo
// se usa la copia guardada si no hay internet. Al subir el número de versión, la
// caché vieja se borra sola y el menú/pantallas se ven al día (ya no queda la
// versión anterior «pegada»).
// v3: las llamadas a /api/ (datos en vivo, p. ej. Google Académico) NUNCA se guardan
// ni se sirven desde la caché: siempre van a la red, para que las citas se actualicen.
const CACHE = "biociencia-shell-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API externas: directo a la red
  if (url.pathname.startsWith("/api/")) return; // datos en vivo (Google Académico, etc.): siempre a la red

  const isDocument = req.mode === "navigate" || req.destination === "document";
  if (isDocument) {
    // Red primero: siempre la versión más reciente de la interfaz.
    // Solo si no hay conexión se usa la copia guardada (modo sin conexión).
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Recursos con nombre único (JS/CSS con número): la copia guardada es válida para siempre.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
