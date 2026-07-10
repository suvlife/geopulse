import { useEffect, useState, useCallback } from 'react'
import { windToCat } from '../utils/scales.js'
import { buildSampleTyphoon } from '../data/sampleTyphoon.js'

// 实时数据源（浙江水利厅台风路径系统同源 CDN，允许跨域）
const LIST_URL = 'https://data.istrongcloud.com/v2/data/complex/active.json'
const DETAIL_URL = (id) => `https://data.istrongcloud.com/v2/data/complex/${id}.json`

const AGENCY_MAP = { 中国: 'CMA', 中央气象台: 'CMA', 日本: 'JMA', 美国: 'JTWC' }

function parseTime(s) {
  if (typeof s === 'number') return s
  return new Date(String(s).replace(' ', 'T') + '+08:00').getTime()
}

function parseRadii(s) {
  if (!s || s === '0') return null
  const parts = String(s).split('|').map(Number)
  if (parts.length !== 4 || parts.every((v) => !v)) return null
  const [ne, se, sw, nw] = parts
  return { ne, se, sw, nw }
}

function parseCat(strong, wind) {
  if (strong) {
    const m = String(strong).match(/\((\w+)\)/)
    if (m) return m[1]
    if (/超强台风/.test(strong)) return 'SuperTY'
    if (/强台风/.test(strong)) return 'STY'
    if (/^台风/.test(strong)) return 'TY'
    if (/强热带风暴/.test(strong)) return 'STS'
    if (/热带风暴/.test(strong)) return 'TS'
    if (/热带低压/.test(strong)) return 'TD'
  }
  return windToCat(wind || 0)
}

function normalize(raw) {
  const obj = Array.isArray(raw) ? raw[0] : raw
  if (!obj?.points?.length) return null
  const track = obj.points.map((p) => {
    const wind = Number(p.speed) || 0
    return {
      time: parseTime(p.time),
      coord: [Number(p.lng), Number(p.lat)],
      wind,
      pressure: Number(p.pressure) || null,
      power: Number(p.power) || null,
      moveSpeed: Number(p.movespeed ?? p.moveSpeed) || null,
      moveDir: p.movedirection ?? p.moveDirection ?? '',
      cat: parseCat(p.strong, wind),
      r7: parseRadii(p.radius7),
      r10: parseRadii(p.radius10),
      r12: parseRadii(p.radius12),
    }
  })
  // 预报可能挂在最后一个观测点或对象顶层
  const fcRaw = obj.points[obj.points.length - 1]?.forecast || obj.forecast || []
  const forecasts = {}
  for (const f of fcRaw) {
    const agency = AGENCY_MAP[f.tm] || f.tm || '其他'
    const pts = (f.forecastpoints || f.points || []).map((p) => {
      const wind = Number(p.speed) || 0
      return {
        time: parseTime(p.time),
        coord: [Number(p.lng), Number(p.lat)],
        wind,
        pressure: Number(p.pressure) || null,
        cat: parseCat(p.strong, wind),
      }
    })
    if (pts.length) forecasts[agency] = pts
  }
  return {
    id: String(obj.tfid ?? obj.id),
    name: obj.name || obj.enname,
    enname: obj.enname || '',
    no: String(obj.tfid ?? '').slice(-4),
    track,
    forecasts,
  }
}

export function useTyphoons() {
  const [state, setState] = useState({
    typhoons: [],
    source: 'loading', // 'live' | 'sample' | 'loading'
    error: null,
    updatedAt: null,
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch(LIST_URL, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`list ${res.status}`)
      const list = await res.json()
      const active = (Array.isArray(list) ? list : []).filter((t) => t.tfid || t.id)
      if (!active.length) throw new Error('no-active')
      const details = await Promise.all(
        active.slice(0, 4).map(async (t) => {
          const r = await fetch(DETAIL_URL(t.tfid ?? t.id), { signal: AbortSignal.timeout(10000) })
          if (!r.ok) return null
          return normalize(await r.json())
        })
      )
      const typhoons = details.filter(Boolean)
      if (!typhoons.length) throw new Error('no-detail')
      setState({ typhoons, source: 'live', error: null, updatedAt: Date.now() })
    } catch (e) {
      // 数据源不可达或当前无活跃台风 → 演示数据兜底，页面始终可用
      setState({
        typhoons: [buildSampleTyphoon()],
        source: 'sample',
        error: e.message === 'no-active' ? null : e.message,
        updatedAt: Date.now(),
      })
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 300000) // 5 分钟自动刷新
    return () => clearInterval(t)
  }, [load])

  return { ...state, refresh: load }
}
