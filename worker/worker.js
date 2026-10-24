// GeoPulse 数据代理:统一 CORS + 边缘缓存,前端只访问本 Worker
// /flights?lat=&lon=&dist=   实时航班(adsb.lol 主源,adsb.fi 备源,边缘缓存 180s)
//                            缓存未命中时"搭便车"把区域内飞机位置记入 KV(写入节流 600s)
// /trail?icao24=&lat=&lon=   服务端历史轨迹(KV,只要有访客看过该区域就有积累)
// /route?callsign=           航线信息:航司/起降机场(adsbdb,缓存 24h)
// /photo?hex=                飞机照片(planespotters 要求合规 UA,必须代理,缓存 24h)
// /typhoon/list?year=        台风列表(istrongcloud 年度文件,缓存 300s,跨年自动回退)
// /typhoon/detail?id=        台风详情(istrongcloud,缓存 300s)
// /tle?group= /satcat        卫星 TLE / 卫星档案(CelesTrak,服务端代理)
// /ais                       AIS WebSocket(aisstream,DO 单例复用,Key 仅存 Worker secret)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Cache, X-Source',
  'Access-Control-Max-Age': '86400',
}

// 缓存键带版本号:上游/格式变更或旧条目有问题时可整体失效
const CACHE_VERSION = 'v3'
const cacheKeyFor = (upstreamUrl) =>
  new Request(`https://cache.geopulse.internal/${CACHE_VERSION}?u=${encodeURIComponent(upstreamUrl)}`)

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...CORS, ...extra },
  })

// 以规范化的 upstream URL 为缓存键;坐标已在调用方取整,全体用户共享同一份缓存
async function cachedProxy(upstreamUrl, ttl, ctx, opts = {}) {
  const { fallbackUrl = null, contentType = 'application/json', minBytes = 0 } = opts
  const cache = caches.default
  const cacheKey = cacheKeyFor(upstreamUrl)
  const hit = await cache.match(cacheKey)
  if (hit) {
    const out = new Response(hit.body, hit)
    out.headers.set('X-Cache', 'HIT')
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v))
    return out
  }

  const UA = 'GeoPulse/1.0 (satellite tracker; +https://geopulse.guofeng.me)'
  let up
  let used = upstreamUrl
  try {
    up = await fetch(upstreamUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) })
    if (!up.ok && fallbackUrl) throw new Error(`upstream ${up.status}`)
  } catch (e) {
    if (!fallbackUrl) return json({ error: String(e) }, 502, { 'Cache-Control': 'no-store' })
    try {
      used = fallbackUrl
      up = await fetch(fallbackUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) })
    } catch (e2) {
      return json({ error: String(e2) }, 502, { 'Cache-Control': 'no-store' })
    }
  }
  if (!up.ok) return json({ error: `upstream ${up.status}` }, 502, { 'Cache-Control': 'no-store' })

  const ct = (up.headers.get('content-type') || '').toLowerCase()
  if (contentType === 'application/json' && ct.includes('text/html')) {
    // 上游把错误页/维护页当 200 返回时,不要污染缓存
    return json({ error: 'upstream returned html' }, 502, { 'Cache-Control': 'no-store' })
  }

  const body = await up.arrayBuffer()
  if (body.byteLength < minBytes) {
    return json({ error: `upstream too small (${body.byteLength})` }, 502, { 'Cache-Control': 'no-store' })
  }
  const res = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ttl}`,
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
      'X-Cache': 'MISS',
      'X-Source': used === upstreamUrl ? 'primary' : 'fallback',
    },
  })
  if (ttl >= 60) ctx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
}

const GRID = (v) => Math.round(v * 2) / 2

// 搭便车记录:把一次上游响应里的飞机位置追加进该网格的 KV 轨迹
// KV 免费额度 1000 写/天 → 每网格写入节流 600s(单格 ≈ 144 写/天),
// 只记最近 150 架、空结果不写,避免触发配额上限
const TRAIL_WRITE_MS = 600000
async function recordTrails(env, cell, planes, now) {
  if (!planes?.length) return
  try {
    const key = `trail:${cell}`
    const existing = (await env.TRAILS.get(key, 'json')) || { updated: 0, planes: {} }
    if (now - existing.updated < TRAIL_WRITE_MS) return
    const cutoff = now - 6 * 3600e3
    const ts = Math.round(now / 1000)
    const near = planes
      .filter((a) => a.hex && Number.isFinite(a.lat) && Number.isFinite(a.lon)
        && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180)
      .sort((a, b) => (a.dst ?? 1e9) - (b.dst ?? 1e9))
      .slice(0, 150)
    for (const a of near) {
      const altM = a.alt_baro === 'ground' ? 0 : typeof a.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null
      const arr = existing.planes[a.hex] || []
      arr.push([ts, +(+a.lon).toFixed(3), +(+a.lat).toFixed(3), altM])
      existing.planes[a.hex] = arr.slice(-60) // 每机最多 60 点(10 分钟间隔 ≈ 10 小时航路)
    }
    for (const [hex, arr] of Object.entries(existing.planes)) {
      const kept = arr.filter((pt) => pt[0] * 1000 > cutoff)
      if (kept.length) existing.planes[hex] = kept
      else delete existing.planes[hex]
    }
    existing.updated = now
    await env.TRAILS.put(key, JSON.stringify(existing), { expirationTtl: 21600 })
  } catch { /* KV 配额耗尽等失败静默跳过,不影响主响应 */ }
}

const FLIGHT_UA = 'GeoPulse/1.0 (aircraft tracker; +https://geopulse.guofeng.me)'

async function fetchAircraft(url, fallbackUrl) {
  const res = await fetch(url, { headers: { 'User-Agent': FLIGHT_UA }, signal: AbortSignal.timeout(9000) })
  if (!res.ok) throw new Error(`${url.includes('adsb.fi') ? 'adsb.fi' : 'adsb.lol'} ${res.status}`)
  const data = await res.json()
  const ac = Array.isArray(data?.ac) ? data.ac : Array.isArray(data?.aircraft) ? data.aircraft : []
  if (ac.length) return { ac, source: url === fallbackUrl ? 'adsb.fi' : 'adsb.lol' }
  return { ac, source: null }
}

async function handleFlights(url, env, ctx) {
  const lat = GRID(parseFloat(url.searchParams.get('lat') || '31'))
  const lon = GRID(parseFloat(url.searchParams.get('lon') || '121'))
  const dist = Math.min(250, parseInt(url.searchParams.get('dist') || '250', 10) || 250)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return json({ error: 'bad coords' }, 400)
  }

  const primary = `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`
  const backup = `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${dist}`
  const cache = caches.default
  const cacheKey = cacheKeyFor(primary)
  const hit = await cache.match(cacheKey)
  if (hit) {
    const out = new Response(hit.body, hit)
    out.headers.set('X-Cache', 'HIT')
    out.headers.set('Cache-Control', 'public, max-age=30') // 边缘 180s,浏览器只缓存 30s
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v))
    return out
  }

  let result = null
  const errs = []
  try {
    result = await fetchAircraft(primary)
  } catch (e) { errs.push(e.message) }
  // 主源失败或空结果时用 adsb.fi 补位
  if (!result?.ac.length) {
    try {
      const fb = await fetchAircraft(backup, backup)
      if (fb.ac.length || !result) result = fb
    } catch (e) { errs.push(e.message) }
  }

  if (!result) {
    // 把两个源各自的失败原因都带上,方便判断是限流还是封禁
    return json({ error: errs.join(' / ') || 'all sources failed' }, 502, { 'Cache-Control': 'no-store' })
  }

  const now = Date.now()
  ctx.waitUntil(recordTrails(env, `${lat},${lon}`, result.ac, now))
  // 空结果只短缓存,避免把偶发上游抖动放大成 2 分钟空白
  const body = JSON.stringify({ ac: result.ac, source: result.source || 'none', now })
  const res = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30',
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
      'X-Cache': 'MISS',
      'X-Source': result.source || 'none',
    },
  })
  // Cache API 的 TTL 由存储副本的 Cache-Control 决定,单独放宽到 180s
  // (adsb.lol 免费配额 500 次/天/出口 IP;180s 单网格 ≈ 480 次/天,留出余量)
  const edgeTtl = result.ac.length ? 180 : 30
  const cached = new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${edgeTtl}` },
  })
  ctx.waitUntil(cache.put(cacheKey, cached))
  return res
}

const AIS_ORIGIN_OK = (origin) =>
  !origin || /^https:\/\/([a-z0-9-]+\.)?guofeng\.me$/.test(origin) ||
  /^https:\/\/([a-z0-9-]+\.)?geopulse\.pages\.dev$/.test(origin) ||
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

export { AISHub } from './AISHub.js'

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(request.url)
    const p = url.pathname

    if (p === '/flights') return handleFlights(url, env, ctx)

    if (p === '/trail') {
      const icao = (url.searchParams.get('icao24') || '').toLowerCase()
      if (!/^~?[0-9a-f]{6}$/.test(icao)) return json({ error: 'bad icao24' }, 400)
      const lat = GRID(parseFloat(url.searchParams.get('lat') || '31'))
      const lon = GRID(parseFloat(url.searchParams.get('lon') || '121'))
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
        return json({ error: 'bad coords' }, 400)
      }
      const blob = await env.TRAILS.get(`trail:${lat},${lon}`, 'json')
      return json({ icao24: icao, path: blob?.planes?.[icao] || [], updated: blob?.updated || null })
    }

    if (p === '/route') {
      const cs = (url.searchParams.get('callsign') || '').trim().toUpperCase()
      if (!/^[A-Z0-9]{3,8}$/.test(cs)) return json({ error: 'bad callsign' }, 400)
      return cachedProxy(`https://api.adsbdb.com/v0/callsign/${cs}`, 86400, ctx)
    }

    if (p === '/photo') {
      const hex = (url.searchParams.get('hex') || '').toLowerCase()
      if (!/^~?[0-9a-f]{6}$/.test(hex)) return json({ error: 'bad hex' }, 400)
      return cachedProxy(`https://api.planespotters.net/pub/photos/hex/${hex}`, 86400, ctx)
    }

    if (p === '/typhoon/list') {
      const q = parseInt(url.searchParams.get('year') || '', 10)
      const year = Number.isFinite(q) && q >= 2000 && q <= 2100 ? q : new Date().getUTCFullYear()
      return cachedProxy(
        `https://data.istrongcloud.com/v2/data/complex/${year}.json`,
        300,
        ctx,
        { fallbackUrl: `https://data.istrongcloud.com/v2/data/complex/${year - 1}.json`, minBytes: 100 }
      )
    }

    if (p === '/typhoon/detail') {
      const id = url.searchParams.get('id') || ''
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return json({ error: 'bad id' }, 400)
      return cachedProxy(`https://data.istrongcloud.com/v2/data/complex/${id}.json`, 300, ctx, { minBytes: 100 })
    }

    // 卫星 TLE/档案:CelesTrak 对浏览器 Origin 请求返回 403,必须服务端代理
    if (p === '/tle') {
      const group = url.searchParams.get('group') || 'active'
      if (!/^[a-z0-9-]{2,30}$/.test(group)) return json({ error: 'bad group' }, 400)
      return cachedProxy(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
        7200, // 2h,与 CelesTrak 数据更新周期一致
        ctx,
        { contentType: 'text/plain; charset=utf-8', minBytes: 10000 }
      )
    }

    if (p === '/satcat') {
      return cachedProxy('https://celestrak.org/pub/satcat.csv', 86400, ctx, {
        contentType: 'text/csv; charset=utf-8',
        minBytes: 100000,
      })
    }

    // 运维诊断:AIS 上游连接状态(不含 Key),用于判断是 Key 失效还是边缘 IP 被拒
    if (p === '/ais/status') {
      const id = env.AIS_HUB.idFromName('global-v5')
      return env.AIS_HUB.get(id).fetch(new Request('https://ais.internal/status'))
    }

    // AIS 实时流代理:Durable Object 单例共享一条 aisstream 连接(免费账号仅 1 并发)
    // key 存 Worker secret(AIS_API_KEY),客户端零配置
    if (p === '/ais') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expect websocket' }, 426)
      if (!AIS_ORIGIN_OK(request.headers.get('Origin'))) return json({ error: 'origin not allowed' }, 403)
      if (!env.AIS_API_KEY) return json({ error: 'AIS_API_KEY not set' }, 500)
      const id = env.AIS_HUB.idFromName('global-v5')
      return env.AIS_HUB.get(id).fetch(request)
    }

    return json(
      { service: 'geopulse-api', endpoints: ['/flights', '/trail', '/route', '/photo', '/typhoon/list', '/typhoon/detail', '/tle', '/satcat', '/ais', '/ais/status'] },
      p === '/' ? 200 : 404
    )
  },
}
