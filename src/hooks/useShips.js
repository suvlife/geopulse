import { useCallback, useEffect, useRef, useState } from 'react'
import { generateShips, advanceShips } from '../utils/shipSim.js'
import { mmsiCountry } from '../data/shipData.js'

// 数据模式:'demo'(模拟航道演示) | 'live'(aisstream 真实流,浏览器直连)
// aisstream 对数据中心 IP(CF Worker)间歇限流,浏览器住宅 IP 直连最稳定
const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream'
const AIS_KEY = '0065b4e691e5fc630aea2f2e0c08a5c5f1623c67'

// AIS 船型码 → 我们的船型分类(AIS 标准:70-79 货船,80-89 油轮,60-69 客船,30 渔船)
// 集装箱船 AIS 用 70-79,但 aisstream MetaData.ShipType 常缺失,此时从 ShipStaticData.Type 补
function aisShipType(code) {
  const c = Number(code)
  if (c >= 80 && c < 90) return 'tanker'
  if (c >= 70 && c < 80) return 'cargo'
  if (c >= 60 && c < 70) return 'passenger'
  if (c === 30) return 'fishing'
  if (c === 31 || c === 32 || c === 52 || c === 53) return 'tug'
  if (c >= 40 && c < 50) return 'other' // 高速船
  if (c === 50 || c === 51) return 'other' // 引航船/搜救船
  if (c >= 33 && c < 37) return 'other' // 疏浚/军用
  return 'cargo' // 默认
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
        // 发送订阅(aisstream 协议:连接后必须立即发)
        try {
          ws.send(JSON.stringify({
            APIKey: AIS_KEY,
            BoundingBoxes: [[[-90, -180], [90, 180]]],
          }))
        } catch {}
        if (shipsRef.current.size === 0 || ![...shipsRef.current.values()].some((s) => s.live)) {
          shipsRef.current = new Map()
        }
      }

      ws.binaryType = 'arraybuffer' // aisstream 发二进制消息
      ws.onmessage = async (e) => {
        try {
          // aisstream 消息是二进制(Blob/ArrayBuffer),需转文本
          let text
          if (typeof e.data === 'string') {
            text = e.data
          } else if (e.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(e.data)
          } else if (e.data instanceof Blob) {
            text = await e.data.text()
          } else {
            text = String(e.data)
          }
          const msg = JSON.parse(text)
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
