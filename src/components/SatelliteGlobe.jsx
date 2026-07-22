import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Deck } from '@deck.gl/core'
import { getGlobeView, buildSatelliteLayers } from '../layers/satelliteLayers.js'

function getTooltip({ object }) {
  if (!object?.lon) return null
  const style = {
    background: 'rgba(12,16,30,0.92)', color: '#e8ecf6', fontSize: '12px',
    padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)',
    maxWidth: '260px',
  }
  const altKm = (object.alt / 1000).toFixed(0)
  return {
    html: `<b>${object.name}</b><br/>
      NORAD ${object.norad}<br/>
      ${object.lon.toFixed(2)}° ${object.lat.toFixed(2)}° · ${altKm} km<br/>
      <span style="opacity:0.7">${object.group === 'starlink' ? 'Starlink 星座' : object.group === 'station' ? '空间站' : object.group === 'gps' ? 'GPS' : '活跃卫星'}</span>`,
    style,
  }
}

export default function SatelliteGlobe({ satellites, selectedId, showOrbits, showFootprints, showLabels, onClick }) {
  const canvasRef = useRef(null)
  const deckRef = useRef(null)

  const layers = useMemo(
    () => buildSatelliteLayers({ satellites, selectedId, showOrbits, showFootprints, showLabels }),
    [satellites, selectedId, showOrbits, showFootprints, showLabels]
  )

  // 初始化 DeckGL
  useEffect(() => {
    const deck = new Deck({
      canvas: canvasRef.current,
      views: getGlobeView(),
      initialViewState: {
        longitude: 116.4,
        latitude: 39.9,
        zoom: 2.5,
        minZoom: 1,
        maxZoom: 8,
        pitch: 15,
      },
      controller: true,
      layers: [],
      getTooltip,
      parameters: {
        clearColor: [5, 8, 18, 1],
      },
      onClick: (info) => {
        if (info.object?.lon) onClick(info.object)
      },
    })
    deckRef.current = deck
    return () => deck.finalize()
  }, [onClick])

  // 更新图层
  useEffect(() => {
    deckRef.current?.setProps({ layers })
  }, [layers])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}