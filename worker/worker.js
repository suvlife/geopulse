// GeoPulse 数据代理:统一 CORS + 边缘缓存,前端只访问本 Worker
// /flights?lat=&lon=&dist=   实时航班(adsb.lol 主源,airplanes.live 兜底,缓存 12s)
// /track?icao24=             单机航路轨迹(OpenSky,缓存 30s)
// /typhoon/list              活跃台风列表(istrongcloud,缓存 300s)
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
      headers: { 'User-Agent': 'GeoPulse/1.0 (github.com/suvlife/geopulse)' },
      signal: AbortSignal.timeout(9000),
    })
    if (!up.ok && fallbackUrl) throw new Error(`upstream ${up.status}`)
  } catch (e) {
    if (!fallbackUrl) return json({ error: String(e) }, 502)
    try {
      up = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'GeoPulse/1.0' },
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

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(request.url)
    const p = url.pathname

    if (p === '/flights') {
      // 坐标取整到 0.5° 网格:相邻用户命中同一缓存,也保护上游
      const lat = Math.round(parseFloat(url.searchParams.get('lat') || '31') * 2) / 2
      const lon = Math.round(parseFloat(url.searchParams.get('lon') || '121') * 2) / 2
      const dist = Math.min(250, parseInt(url.searchParams.get('dist') || '250', 10) || 250)
      if (!isFinite(lat) || !isFinite(lon) || lat < -85 || lat > 85) return json({ error: 'bad coords' }, 400)
      return cachedProxy(
        `https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`,
        12,
        ctx,
        `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`
      )
    }

    if (p === '/track') {
      const icao = (url.searchParams.get('icao24') || '').toLowerCase()
      if (!/^[0-9a-f]{6}$/.test(icao)) return json({ error: 'bad icao24' }, 400)
      return cachedProxy(`https://opensky-network.org/api/tracks/all?icao24=${icao}&time=0`, 30, ctx)
    }

    if (p === '/typhoon/list') {
      return cachedProxy('https://data.istrongcloud.com/v2/data/complex/active.json', 300, ctx)
    }

    if (p === '/typhoon/detail') {
      const id = url.searchParams.get('id') || ''
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return json({ error: 'bad id' }, 400)
      return cachedProxy(`https://data.istrongcloud.com/v2/data/complex/${id}.json`, 300, ctx)
    }

    return json({ service: 'geopulse-api', endpoints: ['/flights', '/track', '/typhoon/list', '/typhoon/detail'] }, p === '/' ? 200 : 404)
  },
}
