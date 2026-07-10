import { useEffect, useRef, useState, useCallback } from 'react'

const FEEDS = {
  day: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  week: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
  month: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson',
}

export function useEarthquakes(range = 'day') {
  const [state, setState] = useState({ quakes: [], loading: true, error: null, updatedAt: null })
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(FEEDS[range] || FEEDS.day, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`USGS ${res.status}`)
      const gj = await res.json()
      const quakes = gj.features
        .filter((f) => f.properties.mag != null)
        .map((f) => ({
          id: f.id,
          coord: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
          depth: f.geometry.coordinates[2] ?? 0,
          mag: f.properties.mag,
          place: f.properties.place || '未知位置',
          time: f.properties.time,
          url: f.properties.url,
          tsunami: f.properties.tsunami === 1,
        }))
        .sort((a, b) => b.time - a.time)
      setState({ quakes, loading: false, error: null, updatedAt: Date.now() })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }))
    }
  }, [range])

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    load()
    timerRef.current = setInterval(load, 120000) // 2 分钟自动刷新
    return () => clearInterval(timerRef.current)
  }, [load])

  return { ...state, refresh: load }
}
