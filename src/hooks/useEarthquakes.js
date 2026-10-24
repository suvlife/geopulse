import { useEffect, useRef, useState, useCallback } from 'react'

// USGS 免费 GeoJSON 订阅源。30 天档用 4.5_month(约 0.5MB),
// all_month 有 7MB,每 2 分钟拉一次会烧掉数 GB/天流量
const FEEDS = {
  day: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  week: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
  month: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson',
}
const POLL_MS = 120000

// 该档最小震级(用于面板提示,避免用户以为 30 天没有小震)
export const FEED_MIN_MAG = { day: 0, week: 0, month: 4.5 }

export function useEarthquakes(range = 'day') {
  const [state, setState] = useState({ quakes: [], loading: true, error: null, updatedAt: null })
  const seqRef = useRef(0)
  const ctrlRef = useRef(null)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    try {
      const res = await fetch(FEEDS[range] || FEEDS.day, {
        signal: AbortSignal.any
          ? AbortSignal.any([ctrl.signal, AbortSignal.timeout(20000)])
          : ctrl.signal,
      })
      if (!res.ok) throw new Error(`USGS ${res.status}`)
      const gj = await res.json()
      if (seq !== seqRef.current) return
      const quakes = (gj.features || [])
        .filter((f) => f.properties?.mag != null && f.geometry?.coordinates?.length >= 2)
        .map((f) => ({
          id: f.id,
          coord: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
          depth: f.geometry.coordinates[2] ?? 0,
          mag: f.properties.mag,
          place: f.properties.place || '未知位置',
          time: f.properties.time,
          url: f.properties.url,
          // USGS tsunami 字段表示“震中位于海啸可能影响区”,不等于已发布海啸预警
          tsunami: f.properties.tsunami === 1,
        }))
        .filter((q) => Number.isFinite(q.coord[0]) && Number.isFinite(q.coord[1]))
        .sort((a, b) => b.time - a.time)
      const generated = Date.parse(gj.metadata?.generated)
      setState({
        quakes,
        loading: false,
        error: null,
        updatedAt: Number.isFinite(generated) ? generated : Date.now(),
      })
    } catch (e) {
      if (seq !== seqRef.current || e.name === 'AbortError') return
      // 刷新失败保留上一份数据,只把错误提示出来
      setState((s) => ({ ...s, loading: false, error: e.message }))
    }
  }, [range])

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    load()
    const t = setInterval(() => {
      // 后台标签页不轮询,回到前台立即补一次
      if (!document.hidden) load()
    }, POLL_MS)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      ctrlRef.current?.abort()
    }
  }, [load])

  return { ...state, refresh: load }
}
