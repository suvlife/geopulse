import { useEffect, useMemo, useRef } from 'react'
import { Deck } from '@deck.gl/core'
import { getGlobeView, buildSatelliteLayers } from '../layers/satelliteLayers.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

function getTooltip({ object }) {
  // 经度 0(本初子午线)是合法位置,不能用 truthy 判断
  if (!object || object.lon == null || object.alt < 0) return null
  const style = {
    background: 'rgba(12,16,30,0.92)', color: '#e8ecf6', fontSize: '12px',
    padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)',
    maxWidth: '260px',
  }
  const altKm = (object.alt / 1000).toFixed(0)
  return {
    html: `<b>${esc(object.name)}</b><br/>
      NORAD ${esc(object.norad)} · ${altKm} km<br/>
      <span style="opacity:0.7">点击查看详情与照片</span>`,
    style,
  }
}

export default function SatelliteGlobe({
  positionsRef, frameRef, visibleGroupsRef,
  selected, orbitPath, showFootprint, onClick,
}) {
  const canvasRef = useRef(null)
  const deckRef = useRef(null)
  const lastFrameRef = useRef(-1)
  const lastCamRef = useRef('')
  const selectedRef = useRef(selected)
  const orbitPathRef = useRef(orbitPath)
  const footprintRef = useRef(showFootprint)
  selectedRef.current = selected
  orbitPathRef.current = orbitPath
  footprintRef.current = showFootprint

  // 初始化 DeckGL
  useEffect(() => {
    const deck = new Deck({
      canvas: canvasRef.current,
      views: getGlobeView(),
      initialViewState: {
        longitude: 116.4,
        latitude: 39.9,
        zoom: 1.8,
        minZoom: 0.3, // 允许拉远看 GEO 轨道
        maxZoom: 12,
        pitch: 10,
      },
      controller: true,
      layers: [],
      getTooltip,
      parameters: { clearColor: [4, 7, 16, 1] },
      useDevicePixels: Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1),
      onClick: (info) => {
        if (info.object?.lon != null) onClick(info.object)
      },
    })
    deckRef.current = deck
    window.__deck = deck // 调试用

    // 渲染循环:直接读 positionsRef + frameRef,每帧直推 deck.gl,不经 React
    // 限到 ~15fps:1.6 万个点位每帧重建图层是移动端卡顿的主因
    let raf, lastRender = 0
    const render = (t) => {
      const frame = frameRef.current
      const vs = deck.viewState || {}
      const cam = vs.globe || vs // GlobeView 的 viewState 按 viewId 嵌套
      // 相机位置变化时也要重绘(近/远侧轨道分割依赖相机)
      const camKey = `${(cam.longitude || 0).toFixed(2)},${(cam.latitude || 0).toFixed(2)}`
      const changed = frame !== lastFrameRef.current || camKey !== lastCamRef.current
      if (changed && t - lastRender >= 66) {
        lastRender = t
        lastFrameRef.current = frame
        lastCamRef.current = camKey
        const sats = positionsRef.current || []
        const layers = buildSatelliteLayers({
          satellites: sats,
          selected: selectedRef.current,
          orbitPath: orbitPathRef.current,
          visibleGroups: visibleGroupsRef.current,
          showFootprint: footprintRef.current,
          frame, // 作为 updateTrigger
          camera: { lon: cam.longitude ?? 0, lat: cam.latitude ?? 0 },
        })
        deck.setProps({ layers })
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(raf)
      deck.finalize()
    }
  }, [onClick, positionsRef, frameRef, visibleGroupsRef])

  // 分组开关/选中变化 → 强制重绘
  useEffect(() => {
    lastFrameRef.current = -1
  }, [selected, orbitPath, showFootprint, visibleGroupsRef.current])

  // 选中卫星 → 视角跟随:按轨道高度选缩放,让整个轨道椭圆可见
  // (近视角下轨道大圆看起来像切线,必须拉远到全地球视角)
  useEffect(() => {
    const deck = deckRef.current
    if (!deck || !selected) return
    const altKm = selected.alt / 1000
    let zoom
    if (altKm < 2000) zoom = 1.6       // LEO
    else if (altKm < 30000) zoom = 1.0 // MEO
    else zoom = 0.6                    // GEO
    const cur = deck.viewState?.globe || deck.viewState || {}
    deck.setProps({
      initialViewState: {
        ...cur,
        longitude: selected.lon,
        latitude: Math.max(-60, Math.min(60, selected.lat)),
        zoom,
        transitionDuration: 900,
      },
    })
  }, [selected?.id])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}