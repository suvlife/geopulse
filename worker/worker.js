// GeoPulse 数据代理:统一 CORS + 边缘缓存,前端只访问本 Worker
// /flights?lat=&lon=&dist=   实时航班(adsb.lol 主源,airplanes.live 兜底,缓存 12s)
//                            缓存未命中时"搭便车"把区域内所有飞机位置记入 KV(写入节流 150s)
// /trail?icao24=&lat=&lon=   服务端历史轨迹(KV,只要有访客看过该区域就有积累)
// /route?callsign=           航线信息:航司/起降机场(adsbdb,缓存 24h)
// /photo?hex=                飞机照片(planespotters 要求合规 UA,必须代理,缓存 24h)
// /typhoon/list              当年台风列表(istrongcloud 年度文件,active.json 已下线,缓存 300s)
// /typhoon/detail?id=        台风详情(istrongcloud,缓存 300s)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })

// 以规范化的 upstream URL 为缓存键;坐标已在调用方取整,全体用户共享同一份缓存
async function cachedProxy(upstreamUrl, ttl, ctx, fallbackUrl = null) {
  const cache = caches.default
  const cacheKey = new Request(upstreamUrl)
  const hit = await cache.match(cacheKey)
  if (hit) {
    const out = new Response(hit.body, hit)
    out.headers.set('X-Cache', 'HIT')
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v))
    return out
  }
  let up
  try {
    up = await fetch(upstreamUrl, {
      headers: { 'User-Agent': 'GeoPulse/1.0 (+https://geopulse.guofeng.me)' },
      signal: AbortSignal.timeout(9000),
    })
    if (!up.ok && fallbackUrl) throw new Error(`upstream ${up.status}`)
  } catch (e) {
    if (!fallbackUrl) return json({ error: String(e) }, 502)
    try {
      up = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'GeoPulse/1.0 (+https://geopulse.guofeng.me)' },
        signal: AbortSignal.timeout(9000),
      })
    } catch (e2) {
      return json({ error: String(e2) }, 502)
    }
  }
  if (!up.ok) return json({ error: `upstream ${up.status}` }, 502)
  const body = await up.arrayBuffer()
  const res = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttl}`,
      ...CORS,
      'X-Cache': 'MISS',
    },
  })
  ctx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
}

const GRID = (v) => Math.round(v * 2) / 2

// 搭便车记录:把一次上游响应里的所有飞机位置追加进该网格的 KV 轨迹
// KV 免费额度 1000 写/天 → 每网格写入节流 150s(一个持续活跃网格 ≈ 576 写/天)
async function recordTrails(env, cell, bodyText) {
  try {
    const key = `trail:${cell}`
    const now = Date.now()
    const existing = (await env.TRAILS.get(key, 'json')) || { updated: 0, planes: {} }
    if (now - existing.updated < 150000) return
    const data = JSON.parse(bodyText)
    const cutoff = now - 6 * 3600e3
    const ts = Math.round(now / 1000)
    for (const a of data.ac || []) {
      if (a.lat == null || a.lon == null || !a.hex) continue
      const altM = a.alt_baro === 'ground' ? 0 : typeof a.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null
      const arr = existing.planes[a.hex] || []
      arr.push([ts, +(+a.lon).toFixed(3), +(+a.lat).toFixed(3), altM])
      existing.planes[a.hex] = arr.slice(-60) // 每机最多 60 点(150s 间隔 ≈ 2.5 小时航路)
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

async function handleFlights(url, env, ctx) {
  const lat = GRID(parseFloat(url.searchParams.get('lat') || '31'))
  const lon = GRID(parseFloat(url.searchParams.get('lon') || '121'))
  const dist = Math.min(250, parseInt(url.searchParams.get('dist') || '250', 10) || 250)
  if (!isFinite(lat) || !isFinite(lon) || lat < -85 || lat > 85) return json({ error: 'bad coords' }, 400)

  const upstreamUrl = `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`
  const cache = caches.default
  const cacheKey = new Request(upstreamUrl)
  const hit = await cache.match(cacheKey)
  if (hit) {
    const out = new Response(hit.body, hit)
    out.headers.set('X-Cache', 'HIT')
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v))
    return out
  }

  let up
  try {
    up = await fetch(upstreamUrl, { headers: { 'User-Agent': 'GeoPulse/1.0 (github.com/suvlife/geopulse)' }, signal: AbortSignal.timeout(9000) })
    if (!up.ok) throw new Error(`adsb.lol ${up.status}`)
  } catch {
    try {
      up = await fetch(`https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`, { headers: { 'User-Agent': 'GeoPulse/1.0' }, signal: AbortSignal.timeout(9000) })
      if (!up.ok) throw new Error(`airplanes.live ${up.status}`)
    } catch (e) {
      return json({ error: String(e) }, 502)
    }
  }

  const body = await up.text()
  ctx.waitUntil(recordTrails(env, `${lat},${lon}`, body))
  const res = new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=12', ...CORS, 'X-Cache': 'MISS' },
  })
  ctx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
}

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
      const year = new Date().getFullYear()
      return cachedProxy(`https://data.istrongcloud.com/v2/data/complex/${year}.json`, 300, ctx)
    }

    if (p === '/typhoon/detail') {
      const id = url.searchParams.get('id') || ''
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return json({ error: 'bad id' }, 400)
      return cachedProxy(`https://data.istrongcloud.com/v2/data/complex/${id}.json`, 300, ctx)
    }

    // 卫星 TLE:CelesTrak 对浏览器 Origin 请求返回 403,必须服务端代理
    if (p === '/tle') {
      const group = url.searchParams.get('group') || 'active'
      if (!/^[a-z0-9-]{2,30}$/.test(group)) return json({ error: 'bad group' }, 400)
      return cachedProxy(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
        7200, // 2h,与前端刷新周期一致
        ctx
      )
    }

    if (p === '/satcat') {
      return cachedProxy('https://celestrak.org/pub/satcat.csv', 86400, ctx)
    }

    return json({ service: 'geopulse-api', endpoints: ['/flights', '/trail', '/route', '/photo', '/typhoon/list', '/typhoon/detail', '/tle', '/satcat'] }, p === '/' ? 200 : 404)
  },
}
