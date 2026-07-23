var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// AISHub.js
var AISHub = class {
  static {
    __name(this, "AISHub");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.upstream = null;
    this.clients = /* @__PURE__ */ new Set();
    this.connecting = false;
  }
  async connectUpstream() {
    if (this.upstream && this.upstream.readyState === 1) return;
    if (this.connecting) return;
    this.connecting = true;
    try {
      const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
      this.upstream = ws;
      ws.addEventListener("open", () => {
        this.connecting = false;
        try {
          ws.send(JSON.stringify({
            APIKey: this.env.AIS_API_KEY,
            BoundingBoxes: [[[-90, -180], [90, 180]]]
          }));
        } catch {
        }
      });
      ws.addEventListener("message", (e) => {
        for (const c of this.clients) {
          try {
            c.send(e.data);
          } catch {
            this.clients.delete(c);
          }
        }
      });
      const cleanup = /* @__PURE__ */ __name(() => {
        this.upstream = null;
        this.connecting = false;
        for (const c of this.clients) {
          try {
            c.close(1011, "upstream lost");
          } catch {
          }
        }
        this.clients.clear();
      }, "cleanup");
      ws.addEventListener("close", cleanup);
      ws.addEventListener("error", cleanup);
    } catch (e) {
      this.connecting = false;
      this.upstream = null;
    }
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expect websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.clients.add(server);
    server.addEventListener("close", () => {
      this.clients.delete(server);
    });
    server.addEventListener("error", () => {
      this.clients.delete(server);
    });
    this.state.waitUntil(this.connectUpstream());
    return new Response(null, { status: 101, webSocket: client });
  }
};

// worker.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
var json = /* @__PURE__ */ __name((obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", ...CORS, ...extra }
}), "json");
async function cachedProxy(upstreamUrl, ttl, ctx, fallbackUrl = null) {
  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const out = new Response(hit.body, hit);
    out.headers.set("X-Cache", "HIT");
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  }
  let up;
  try {
    up = await fetch(upstreamUrl, {
      headers: { "User-Agent": "GeoPulse/1.0 (+https://geopulse.guofeng.me)" },
      signal: AbortSignal.timeout(9e3)
    });
    if (!up.ok && fallbackUrl) throw new Error(`upstream ${up.status}`);
  } catch (e) {
    if (!fallbackUrl) return json({ error: String(e) }, 502);
    try {
      up = await fetch(fallbackUrl, {
        headers: { "User-Agent": "GeoPulse/1.0 (+https://geopulse.guofeng.me)" },
        signal: AbortSignal.timeout(9e3)
      });
    } catch (e2) {
      return json({ error: String(e2) }, 502);
    }
  }
  if (!up.ok) return json({ error: `upstream ${up.status}` }, 502);
  const body = await up.arrayBuffer();
  const res = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttl}`,
      ...CORS,
      "X-Cache": "MISS"
    }
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
__name(cachedProxy, "cachedProxy");
var GRID = /* @__PURE__ */ __name((v) => Math.round(v * 2) / 2, "GRID");
async function recordTrails(env, cell, bodyText) {
  try {
    const key = `trail:${cell}`;
    const now = Date.now();
    const existing = await env.TRAILS.get(key, "json") || { updated: 0, planes: {} };
    if (now - existing.updated < 15e4) return;
    const data = JSON.parse(bodyText);
    const cutoff = now - 6 * 36e5;
    const ts = Math.round(now / 1e3);
    for (const a of data.ac || []) {
      if (a.lat == null || a.lon == null || !a.hex) continue;
      const altM = a.alt_baro === "ground" ? 0 : typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : null;
      const arr = existing.planes[a.hex] || [];
      arr.push([ts, +(+a.lon).toFixed(3), +(+a.lat).toFixed(3), altM]);
      existing.planes[a.hex] = arr.slice(-60);
    }
    for (const [hex, arr] of Object.entries(existing.planes)) {
      const kept = arr.filter((pt) => pt[0] * 1e3 > cutoff);
      if (kept.length) existing.planes[hex] = kept;
      else delete existing.planes[hex];
    }
    existing.updated = now;
    await env.TRAILS.put(key, JSON.stringify(existing), { expirationTtl: 21600 });
  } catch {
  }
}
__name(recordTrails, "recordTrails");
async function handleFlights(url, env, ctx) {
  const lat = GRID(parseFloat(url.searchParams.get("lat") || "31"));
  const lon = GRID(parseFloat(url.searchParams.get("lon") || "121"));
  const dist = Math.min(250, parseInt(url.searchParams.get("dist") || "250", 10) || 250);
  if (!isFinite(lat) || !isFinite(lon) || lat < -85 || lat > 85) return json({ error: "bad coords" }, 400);
  const upstreamUrl = `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`;
  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const out = new Response(hit.body, hit);
    out.headers.set("X-Cache", "HIT");
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  }
  const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  let up;
  try {
    up = await fetch(upstreamUrl, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(9e3) });
    if (!up.ok) throw new Error(`adsb.lol ${up.status}`);
  } catch {
    try {
      up = await fetch(upstreamUrl, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(9e3) });
      if (!up.ok) throw new Error(`adsb.lol retry ${up.status}`);
    } catch {
      try {
        up = await fetch(`https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(9e3) });
        if (!up.ok) throw new Error(`airplanes.live ${up.status}`);
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }
  }
  let body = await up.text();
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed.ac) && parsed.ac.length === 0) {
      const fb = await fetch(`https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(9e3) });
      if (fb.ok) {
        const fbText = await fb.text();
        const fbParsed = JSON.parse(fbText);
        if (Array.isArray(fbParsed.ac) && fbParsed.ac.length > 0) body = fbText;
      }
    }
  } catch {
  }
  ctx.waitUntil(recordTrails(env, `${lat},${lon}`, body));
  const res = new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30", ...CORS, "X-Cache": "MISS" }
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
__name(handleFlights, "handleFlights");
var worker_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === "/flights") return handleFlights(url, env, ctx);
    if (p === "/trail") {
      const icao = (url.searchParams.get("icao24") || "").toLowerCase();
      if (!/^~?[0-9a-f]{6}$/.test(icao)) return json({ error: "bad icao24" }, 400);
      const lat = GRID(parseFloat(url.searchParams.get("lat") || "31"));
      const lon = GRID(parseFloat(url.searchParams.get("lon") || "121"));
      const blob = await env.TRAILS.get(`trail:${lat},${lon}`, "json");
      return json({ icao24: icao, path: blob?.planes?.[icao] || [], updated: blob?.updated || null });
    }
    if (p === "/route") {
      const cs = (url.searchParams.get("callsign") || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{3,8}$/.test(cs)) return json({ error: "bad callsign" }, 400);
      return cachedProxy(`https://api.adsbdb.com/v0/callsign/${cs}`, 86400, ctx);
    }
    if (p === "/photo") {
      const hex = (url.searchParams.get("hex") || "").toLowerCase();
      if (!/^~?[0-9a-f]{6}$/.test(hex)) return json({ error: "bad hex" }, 400);
      return cachedProxy(`https://api.planespotters.net/pub/photos/hex/${hex}`, 86400, ctx);
    }
    if (p === "/typhoon/list") {
      const year = (/* @__PURE__ */ new Date()).getFullYear();
      return cachedProxy(`https://data.istrongcloud.com/v2/data/complex/${year}.json`, 300, ctx);
    }
    if (p === "/typhoon/detail") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return json({ error: "bad id" }, 400);
      return cachedProxy(`https://data.istrongcloud.com/v2/data/complex/${id}.json`, 300, ctx);
    }
    if (p === "/tle") {
      const group = url.searchParams.get("group") || "active";
      if (!/^[a-z0-9-]{2,30}$/.test(group)) return json({ error: "bad group" }, 400);
      return cachedProxy(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
        7200,
        // 2h,与前端刷新周期一致
        ctx
      );
    }
    if (p === "/satcat") {
      return cachedProxy("https://celestrak.org/pub/satcat.csv", 86400, ctx);
    }
    if (p === "/ais") {
      const upgrade = request.headers.get("Upgrade");
      if (upgrade !== "websocket") return json({ error: "expect websocket" }, 426);
      if (!env.AIS_API_KEY) return json({ error: "AIS_API_KEY not set" }, 500);
      const id = env.AIS_HUB.idFromName("global");
      const stub = env.AIS_HUB.get(id);
      return stub.fetch(request);
    }
    return json({ service: "geopulse-api", endpoints: ["/flights", "/trail", "/route", "/photo", "/typhoon/list", "/typhoon/detail", "/tle", "/satcat", "/ais"] }, p === "/" ? 200 : 404);
  }
};

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-scheduled.ts
var scheduled = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  const url = new URL(request.url);
  if (url.pathname === "/__scheduled") {
    const cron = url.searchParams.get("cron") ?? "";
    await middlewareCtx.dispatch("scheduled", { cron });
    return new Response("Ran scheduled event");
  }
  const resp = await middlewareCtx.next(request, env);
  if (request.headers.get("referer")?.endsWith("/__scheduled") && url.pathname === "/favicon.ico" && resp.status === 500) {
    return new Response(null, { status: 404 });
  }
  return resp;
}, "scheduled");
var middleware_scheduled_default = scheduled;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-xapBvr/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_scheduled_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-xapBvr/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  AISHub,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
