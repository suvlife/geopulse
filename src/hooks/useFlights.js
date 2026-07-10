import { useCallback, useEffect, useRef, useState } from 'react'

const API = 'https://geopulse-api.guofeng.me'
const DIRECT = 'https://api.airplanes.live/v2' // Worker 不可达时浏览器直连兜底(CORS *)

// adsb.lol / airplanes.live 均为 readsb 格式
function normalize(d) {
  return (d.ac || [])
    .filter((a) => a.lat != null && a.lon != null)
    .map((a) => {
      const onGround = a.alt_baro === 'ground'
      const altFt = typeof a.alt_baro === 'number' ? a.alt_baro : null
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
        track: a.track ?? a.true_heading ?? null,
        vrateMs: a.baro_rate != null ? +(a.baro_rate * 0.00508).toFixed(1) : null,
        squawk: a.squawk || '',
        emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
        distKm: a.dst != null ? Math.round(a.dst * 1.852) : null,
        time: Date.now(),
      }
    })
}

export function useFlights(center, enabled) {
  const [state, setState] = useState({ flights: [], loading: false, error: null, updatedAt: null, source: null })
  const trailsRef = useRef(new Map()) // hex → [{coord, altM, time}]
  const centerRef = useRef(center)
  centerRef.current = center

  const load = useCallback(async () => {
    const [lon, lat] = centerRef.current
    const qs = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&dist=250`
    let data, source
    try {
      const r = await fetch(`${API}/flights?${qs}`, { signal: AbortSignal.timeout(12000) })
      if (!r.ok) throw new Error(`worker ${r.status}`)
      data = await r.json()
      source = 'adsb.lol'
    } catch {
      try {
        const r = await fetch(`${DIRECT}/point/${lat.toFixed(2)}/${lon.toFixed(2)}/250`, { signal: AbortSignal.timeout(12000) })
        if (!r.ok) throw new Error(`direct ${r.status}`)
        data = await r.json()
        source = 'airplanes.live'
      } catch (e) {
        setState((s) => ({ ...s, loading: false, error: e.message }))
        return
      }
    }
    const flights = normalize(data)
    // 轨迹累积:每次轮询追加新位置,选中的飞机即可画出历史航路
    const trails = trailsRef.current
    const seen = new Set()
    const now = Date.now()
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
      if (!seen.has(hex) && now - arr[arr.length - 1].time > 600000) trails.delete(hex)
    }
    setState({ flights, loading: false, error: null, updatedAt: now, source })
  }, [])

  useEffect(() => {
    if (!enabled) return
    setState((s) => ({ ...s, loading: true }))
    load()
    const t = setInterval(load, 12000)
    return () => clearInterval(t)
    // centerKey 变化(0.5° 网格)时立即重拉,与 Worker 缓存粒度一致
  }, [enabled, load, Math.round(center[0] * 2) / 2, Math.round(center[1] * 2) / 2])

  return { ...state, trails: trailsRef.current, refresh: load }
}
