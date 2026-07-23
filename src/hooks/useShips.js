import { useCallback, useEffect, useRef, useState } from 'react'
import { generateShips, advanceShips } from '../utils/shipSim.js'
import { mmsiCountry } from '../data/shipData.js'

// 数据模式:'demo'(模拟航道演示) | 'live'(aisstream 真实流,经 Worker 代理)
// key 存 Worker secret(AIS_API_KEY),客户端零配置连 Worker 即可
const AIS_WS_URL = 'wss://geopulse-api.guofeng.me/ais'

// AIS 船型码 → 我们的船型分类
function aisShipType(code) {
  if (code >= 70 && code < 80) return 'cargo'
  if (code >= 80 && code < 90) return 'tanker'
  if (code >= 60 && code < 70) return 'passenger'
  if (code === 30) return 'fishing'
  if (code === 31 || code === 32 || code === 52) return 'tug'
  if (code >= 40 && code < 50) return 'other' // 高速船
  if (code === 50) return 'other' // 引航船
  if (code >= 90) return 'other'
  return 'cargo' // 默认货船(集装箱等 70-79 细分先归 cargo)
}

export function useShips(enabled) {
  const [ships, setShips] = useState([])
  const [mode, setMode] = useState('connecting') // connecting | live | demo
  const [error, setError] = useState(null)
  const shipsRef = useRef(new Map()) // mmsi → ship(Map 便于 AIS 实时更新)
  const simRef = useRef({ time: Date.now(), speed: 60, lastReal: 0 })
  const frameRef = useRef(0)
  const wsRef = useRef(null)
  const ctrlRef = useRef(null)
  const retryRef = useRef(0)

  // 演示船队兜底
  const initDemo = useCallback(() => {
    const demo = generateShips(400, 42)
    shipsRef.current = new Map(demo.map((s) => [String(s.mmsi), s]))
    setShips(demo)
    setMode('demo')
  }, [])

  // AIS 实时流
  useEffect(() => {
    if (!enabled) return
    window.__shipEffectRan = (window.__shipEffectRan || 0) + 1
    // 用 ref 而非闭包变量,避免 StrictMode 双渲染时第二次 effect 拿到第一次的 stopped=true
    const ctrl = { stopped: false, retryTimer: null, ws: null }
    ctrlRef.current = ctrl

    const connect = () => {
      if (ctrl.stopped) return
      if (ctrl.ws && (ctrl.ws.readyState === WebSocket.OPEN || ctrl.ws.readyState === WebSocket.CONNECTING)) return
      setMode('connecting')
      setError(null)
      try {
        ctrl.ws = new WebSocket(AIS_WS_URL)
      } catch (e) {
        setError('WebSocket 不可用')
        initDemo()
        return
      }
      wsRef.current = ctrl.ws
      const ws = ctrl.ws

      ws.onopen = () => {
        retryRef.current = 0
        setMode('live')
        setError(null)
        if (shipsRef.current.size === 0 || ![...shipsRef.current.values()].some((s) => s.live)) {
          shipsRef.current = new Map()
        }
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          const type = msg.MessageType
          if (type === 'PositionReport' || type === 'StandardClassBPositionReport' || type === 'ExtendedClassBPositionReport') {
            const pr = msg.Message?.[type]
            const meta = msg.MetaData || {}
            const mmsi = String(pr.UserID)
            if (!pr.Latitude || !pr.Longitude) return
            const existing = shipsRef.current.get(mmsi)
            const ship = existing || {
              id: mmsi, mmsi: pr.UserID,
              name: meta.ShipName?.trim() || `Vessel ${mmsi}`,
              type: aisShipType(meta.ShipType || 70),
              country: mmsiCountry(pr.UserID),
              live: true,
            }
            ship.coord = [pr.Longitude, pr.Latitude]
            ship.lat = pr.Latitude
            ship.lon = pr.Longitude
            ship.bearing = pr.Cog ?? pr.TrueHeading ?? ship.bearing
            ship.speedKnots = pr.Sog ?? ship.speedKnots
            ship.live = true
            ship.lastSeen = Date.now()
            if (!existing) shipsRef.current.set(mmsi, ship)
          } else if (type === 'ShipStaticData') {
            const sd = msg.Message?.ShipStaticData
            if (!sd) return
            const mmsi = String(sd.UserID)
            const existing = shipsRef.current.get(mmsi)
            if (existing) {
              existing.name = sd.Name?.trim() || existing.name
              existing.type = aisShipType(sd.Type)
              existing.dest = sd.Destination?.trim() || existing.dest
              existing.imo = sd.ImoNumber || existing.imo
              existing.callsign = sd.CallSign || existing.callsign
              if (sd.Dimension) existing.length = (sd.Dimension.A || 0) + (sd.Dimension.B || 0)
              existing.country = mmsiCountry(sd.UserID)
            }
          }
        } catch { /* 单条消息解析失败忽略 */ }
      }

      ws.onerror = () => {}
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
        if (ctrl.stopped) return
        retryRef.current++
        const delay = Math.min(30000, 2000 * Math.pow(1.5, retryRef.current))
        setError(`实时流断开,${Math.round(delay / 1000)}s 后重连(第 ${retryRef.current} 次)`)
        if (retryRef.current > 6) {
          setError('aisstream 连接失败,已切换演示数据')
          initDemo()
          return
        }
        ctrl.retryTimer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      ctrl.stopped = true
      clearTimeout(ctrl.retryTimer)
      try { ctrl.ws?.close() } catch {}
    }
  }, [enabled, initDemo])

  // 低频同步到 React(live: 1.5s;demo: 200ms 推进)
  useEffect(() => {
    if (!enabled) return
    if (mode === 'live') {
      const t = setInterval(() => {
        frameRef.current++
        setShips([...shipsRef.current.values()])
      }, 1500)
      return () => clearInterval(t)
    }
    if (mode === 'demo') {
      let last = Date.now()
      const iv = setInterval(() => {
        const now = Date.now()
        const dt = now - last
        last = now
        const sim = simRef.current
        sim.time += dt * sim.speed
        advanceShips([...shipsRef.current.values()], dt, sim.speed)
        frameRef.current++
        setShips([...shipsRef.current.values()].map((s) => ({ ...s })))
      }, 200)
      return () => clearInterval(iv)
    }
  }, [enabled, mode])

  const setSimSpeed = (s) => { simRef.current.speed = s }
  const resetSim = () => { simRef.current.time = Date.now() }

  return {
    ships, mode, error,
    shipsRef, frameRef, simRef,
    setSimSpeed, resetSim,
    source: mode === 'live' ? 'aisstream.io 实时' : '演示数据(真实航道模拟)',
  }
}
