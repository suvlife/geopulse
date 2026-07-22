import { useCallback, useEffect, useRef, useState } from 'react'
import { generateShips, advanceShips } from '../utils/shipSim.js'
import { mmsiCountry } from '../data/shipData.js'

// 数据模式:'demo'(模拟航道演示) | 'live'(aisstream,需 key)
export function useShips(enabled, aisKey) {
  const [ships, setShips] = useState([])
  const [mode, setMode] = useState('demo')
  const [error, setError] = useState(null)
  const [connected, setConnected] = useState(false)
  const shipsRef = useRef([])
  const simRef = useRef({ time: Date.now(), speed: 60, lastReal: 0 }) // 模拟时间,默认 60x
  const frameRef = useRef(0)

  // 初始化模拟船队
  const initDemo = useCallback(() => {
    shipsRef.current = generateShips(400, 42)
    setShips([...shipsRef.current]) // 立即同步一次
    setMode('demo')
    setError(null)
    window.__shipDebug = { init: true, count: shipsRef.current.length } // 调试
  }, [])

  useEffect(() => {
    if (!enabled) return
    initDemo()
  }, [enabled, initDemo])

  // aisstream 真实数据(有 key 时)
  useEffect(() => {
    if (!enabled || !aisKey) return
    setMode('connecting')
    let ws
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
      ws.onopen = () => {
        ws.send(JSON.stringify({
          APIKey: aisKey,
          BoundingBoxes: [
            [[95, 0], [110, 8]],   // 马六甲海峡
            [[100, -8], [115, 10]], // 爪哇海
          ],
        }))
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.MessageType === 'PositionReport') {
            const pr = msg.Message.PositionReport
            const meta = msg.MetaData
            const mmsi = String(pr.UserID)
            const existing = shipsRef.current.find((s) => s.mmsi === pr.UserID)
            const ship = existing || { id: mmsi, mmsi: pr.UserID, coord: [0, 0] }
            ship.coord = [pr.Longitude, pr.Latitude]
            ship.lat = pr.Latitude
            ship.lon = pr.Longitude
            ship.bearing = pr.Cog ?? ship.bearing
            ship.speedKnots = pr.Sog ?? ship.speedKnots
            ship.name = meta?.ShipName?.trim() || ship.name || `Vessel ${mmsi}`
            ship.country = mmsiCountry(pr.UserID)
            ship.live = true
            if (!existing) shipsRef.current.push(ship)
          }
        } catch { /* 单条消息解析失败忽略 */ }
      }
      ws.onerror = () => {
        setError('aisstream 连接失败,回退演示数据')
        setMode('demo')
        setConnected(false)
      }
      ws.onclose = () => {
        if (mode === 'connecting') {
          setError('aisstream key 无效或连接被关闭,已回退演示数据')
          setMode('demo')
        }
        setConnected(false)
      }
      setConnected(true)
      setMode('live')
    } catch (e) {
      setError(e.message)
      setMode('demo')
    }
    return () => { try { ws?.close() } catch {} }
  }, [enabled, aisKey])

  // 模拟推进(仅 demo 模式)
  useEffect(() => {
    if (!enabled || mode === 'live') return
    let raf, last = 0
    const tick = (realNow) => {
      const sim = simRef.current
      if (sim.lastReal) sim.time += (realNow - sim.lastReal) * sim.speed
      sim.lastReal = realNow
      if (realNow - last > 200) { // 5fps 更新位置(demo 不需要 60fps)
        last = realNow
        advanceShips(shipsRef.current, 200, sim.speed)
        frameRef.current++
        setShips([...shipsRef.current]) // 低频 React 同步
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled, mode])

  // live 模式低频同步到 React
  useEffect(() => {
    if (!enabled || mode !== 'live') return
    const t = setInterval(() => {
      frameRef.current++
      setShips([...shipsRef.current])
    }, 1500)
    return () => clearInterval(t)
  }, [enabled, mode])

  const setSimSpeed = (s) => { simRef.current.speed = s }
  const resetSim = () => { simRef.current.time = Date.now() }

  return {
    ships, mode, error, connected,
    shipsRef, frameRef, simRef,
    setSimSpeed, resetSim,
    source: mode === 'live' ? 'aisstream.io' : '演示数据(真实航道模拟)',
  }
}
