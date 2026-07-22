import { useEffect, useMemo, useRef } from 'react'
import { Deck } from '@deck.gl/core'
import { getGlobeView, buildSatelliteLayers } from '../layers/satelliteLayers.js'

function getTooltip({ object }) {
  if (!object?.lon || object.alt < 0) return null
  const style = {
    background: 'rgba(12,16,30,0.92)', color: '#e8ecf6', fontSize: '12px',
    padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)',
    maxWidth: '260px',
  }
  const altKm = (object.alt / 1000).toFixed(0)
  return {
    html: `<b>${object.name}</b><br/>
      NORAD ${object.norad} · ${altKm} km<br/>
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
        minZoom: 1,
        maxZoom: 12,
        pitch: 10,
      },
      controller: true,
      layers: [],
      getTooltip,
      parameters: { clearColor: [4, 7, 16, 1] },
      onClick: (info) => {
        if (info.object?.lon != null) onClick(info.object)
      },
    })
    deckRef.current = deck

    // 渲染循环:直接读 positionsRef + frameRef,每帧直推 deck.gl,不经 React
    let raf
    const render = () => {
      const frame = frameRef.current
      const changed = frame !== lastFrameRef.current
      if (changed) {
        lastFrameRef.current = frame
        const sats = positionsRef.current || []
        const layers = buildSatelliteLayers({
          satellites: sats,
          selected: selectedRef.current,
          orbitPath: orbitPathRef.current,
          visibleGroups: visibleGroupsRef.current,
          showFootprint: footprintRef.current,
          frame, // 作为 updateTrigger
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

  // 选中卫星 → 视角跟随
  useEffect(() => {
    const deck = deckRef.current
    if (!deck || !selected) return
    deck.setProps({
      initialViewState: {
        ...deck.viewState,
        longitude: selected.lon,
        latitude: Math.max(-80, Math.min(80, selected.lat)),
        zoom: Math.max(deck.viewState?.zoom ?? 2, 3.2),
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