import { useCallback, useEffect, useRef, useState } from 'react'

// 航班位置统一走 Worker:主源 adsb.lol、备源 adsb.fi(均由 Worker 合并/缓存)
// 浏览器直连 airplanes.live 已对非 feeder IP 返回 403,不再使用
const API = 'https://geopulse-api.guofeng.me'
const POLL_MS = 60000 // Worker 边缘缓存 180s;前端 60s 轮询,兼顾时效与 adsb.lol 500 次/天配额

const EMERG_SQUAWK = { 7500: 'unlawful', 7600: 'radio', 7700: 'general' }
const REAL_EMERG = new Set(['general', 'unlawful', 'downed', 'nordo'])

export function emergencyOf(a) {
  const sq = String(a.squawk ?? '').trim()
  if (EMERG_SQUAWK[sq]) return EMERG_SQUAWK[sq]
  // lifeguard / minfuel 是状态提示,不算紧急情况
  return REAL_EMERG.has(a.emergency) ? a.emergency : null
}

function coordOf(lon, lat) {
  const x = Number(lon), y = Number(lat)
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) <= 90 ? [x, y] : null
}

// adsb.lol / adsb.fi 均为 readsb 格式
export function normalize(d, fetchedAt) {
  return (d.ac || [])
    .filter((a) => a.lat != null && a.lon != null && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180)
    .map((a) => {
      const onGround = a.alt_baro === 'ground'
      const altFt = typeof a.alt_baro === 'number' ? a.alt_baro : null
      // seen_pos:距上一次位置更新的秒数,比“抓取时刻”更真实
      const ageS = Number.isFinite(a.seen_pos) ? Math.max(0, a.seen_pos) : 0
      return {
        hex: a.hex,
        callsign: (a.flight || '').trim() || (a.r || '').trim() || a.hex.toUpperCase(),
        reg: (a.r || '').trim(),
        type: (a.t || '').trim(),
        coord: [a.lon, a.lat],
        onGround,
        altM: onGround ? null : altFt != null ? Math.round(altFt * 0.3048) : null,
        altFt,
        speedKmh: a.gs != null ? Math.round(a.gs * 1.852) : null,
        track: a.track ?? a.true_heading ?? a.calc_track ?? null,
        vrateMs: a.baro_rate != null ? +(a.baro_rate * 0.00508).toFixed(1) : null,
        squawk: a.squawk || '',
        emergency: emergencyOf(a),
        distKm: a.dst != null ? Math.round(a.dst * 1.852) : null,
        time: fetchedAt - ageS * 1000,
        posAgeS: Math.round(ageS),
      }
    })
    .filter((f) => f.posAgeS <= 180) // 超过 3 分钟未更新的位置不再展示
}

function signalWithTimeout(ctrl, ms) {
  return AbortSignal.any
    ? AbortSignal.any([ctrl.signal, AbortSignal.timeout(ms)])
    : ctrl.signal
}

export function useFlights(center, enabled) {
  const [state, setState] = useState({ flights: [], loading: false, error: null, updatedAt: null, source: null, trailsVersion: 0 })
  const trailsRef = useRef(new Map()) // hex → [{coord, altM, time}]
  const centerRef = useRef(center)
  centerRef.current = center
  const seqRef = useRef(0)
  const ctrlRef = useRef(null)
  const infoTokenRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const [lon, lat] = centerRef.current
    try {
      const r = await fetch(`${API}/flights?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&dist=250`, {
        signal: signalWithTimeout(ctrl, 15000),
      })
      if (seq !== seqRef.current) return
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (seq !== seqRef.current) return
      if (data?.error) throw new Error(data.error)

      const fetchedAt = Date.now()
      const flights = normalize(data, fetchedAt)
      const source = r.headers.get('X-Source') || 'adsb.lol'

      // 轨迹累积:每次轮询追加新位置,选中的飞机即可画出历史航路
      const trails = trailsRef.current
      const seen = new Set()
      for (const f of flights) {
        seen.add(f.hex)
        const arr = trails.get(f.hex) || []
        const last = arr[arr.length - 1]
        if (!last || last.coord[0] !== f.coord[0] || last.coord[1] !== f.coord[1]) {
          arr.push({ coord: f.coord, altM: f.altM, time: f.time })
          if (arr.length > 150) arr.splice(0, arr.length - 150)
          trails.set(f.hex, arr)
        }
      }
      for (const [hex, arr] of trails) {
        if (!seen.has(hex) && fetchedAt - arr[arr.length - 1].time > 600000) trails.delete(hex)
      }
      setState((s) => ({
        flights,
        loading: false,
        error: null,
        updatedAt: fetchedAt,
        source,
        trailsVersion: s.trailsVersion + 1,
      }))
    } catch (e) {
      if (seq !== seqRef.current || e.name === 'AbortError') return
      // 失败保留上一份航班,避免地图瞬间清空
      setState((s) => ({ ...s, loading: false, error: e.message }))
    }
  }, [])

  // 选中飞机时拉取服务端 KV 历史轨迹,与本地累积合并(服务端点更早,补齐选中前的航路)
  // KV 按“查询中心网格”存储,所以这里也用地视图中心(而不是飞机自身坐标)
  const loadServerTrail = useCallback(async (hex) => {
    try {
      const [lon, lat] = centerRef.current
      const r = await fetch(`${API}/trail?icao24=${hex}&lat=${(+lat).toFixed(2)}&lon=${(+lon).toFixed(2)}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) return
      const d = await r.json()
      const pts = (d.path || []).map(([t, lo, la, alt]) => ({ coord: [lo, la], altM: alt ?? null, time: t * 1000 }))
      if (!pts.length) return
      const merged = [...pts, ...(trailsRef.current.get(hex) || [])]
        .sort((a, b) => a.time - b.time)
        .filter((p, i, xs) => i === 0 || p.time !== xs[i - 1].time)
      trailsRef.current.set(hex, merged.slice(-200))
      setState((s) => ({ ...s, trailsVersion: s.trailsVersion + 1 }))
    } catch { /* 服务端暂无该区域轨迹时静默 */ }
  }, [])

  useEffect(() => {
    if (!enabled) return
    setState((s) => ({ ...s, loading: !s.flights.length }))
    load()
    const t = setInterval(() => {
      if (!document.hidden) load()
    }, POLL_MS)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      ctrlRef.current?.abort()
    }
    // centerKey 变化(0.5° 网格)时立即重拉,与 Worker 缓存粒度一致
  }, [enabled, load, Math.round(center[0] * 2) / 2, Math.round(center[1] * 2) / 2])

  // 选中飞机 → 航线信息(航司/起降机场,adsbdb 直连优先 Worker 兜底)+ 照片(必须走 Worker)
  const loadFlightInfo = useCallback(async (hex, callsign) => {
    const token = ++infoTokenRef.current // 连点 A→B 时,丢弃 A 的迟到响应
    const cs = (callsign || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const out = { route: null, photo: null }
    const jobs = []
    if (/^[A-Z0-9]{3,8}$/.test(cs)) {
      jobs.push(
        (async () => {
          try {
            let d
            try {
              const r = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`, { signal: AbortSignal.timeout(9000) })
              if (!r.ok) throw new Error(`${r.status}`)
              d = await r.json()
            } catch {
              const r = await fetch(`${API}/route?callsign=${cs}`, { signal: AbortSignal.timeout(9000) })
              if (!r.ok) return
              d = await r.json()
            }
            const fr = d?.response?.flightroute
            if (!fr) return
            const airport = (a) => a ? {
              name: a.name, iata: a.iata_code, icao: a.icao_code,
              city: a.municipality, country: a.country_name,
              coord: coordOf(a.longitude, a.latitude),
            } : null
            out.route = {
              airline: fr.airline?.name || null,
              airlineCountry: fr.airline?.country || null,
              airlineIata: fr.airline?.iata || null,
              origin: airport(fr.origin),
              destination: airport(fr.destination),
            }
          } catch { /* 包机/军机等查不到航线,静默 */ }
        })()
      )
    }
    jobs.push(
      (async () => {
        try {
          const r = await fetch(`${API}/photo?hex=${hex}`, { signal: AbortSignal.timeout(9000) })
          if (!r.ok) return
          const d = await r.json()
          const p = (d.photos || [])[0]
          if (p) {
            out.photo = {
              src: p.thumbnail_large?.src || p.thumbnail?.src || null,
              link: p.link || null,
              photographer: p.photographer || null,
            }
          }
        } catch { /* 无照片静默 */ }
      })()
    )
    await Promise.all(jobs)
    return token === infoTokenRef.current ? out : null
  }, [])

  return { ...state, trails: trailsRef.current, refresh: load, loadServerTrail, loadFlightInfo }
}
