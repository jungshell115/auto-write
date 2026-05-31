const CACHE = "auto-write-v3";
const STATIC = ["/", "/styles.css", "/app.js", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()))
);

self.addEventListener("activate", e =>
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", e => {
  const { pathname } = new URL(e.request.url);

  // API / 공유 링크 → 네트워크 우선, 실패 시 오프라인 응답
  if (pathname.startsWith("/v1/") || pathname.startsWith("/share/") || pathname === "/health") {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "오프라인 상태입니다." }), {
          status: 503, headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // 정적 파일 → 캐시 우선, 없으면 네트워크 후 캐시 갱신
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
    })
  );
});
