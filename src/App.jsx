import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useEarthquakes } from './hooks/useEarthquakes.js'
import { useTyphoons } from './hooks/useTyphoons.js'
import { useFlights } from './hooks/useFlights.js'
import { useSatellites } from './hooks/useSatellites.js'
import { buildQuakeLayers, quakePulseLayers } from './layers/quakeLayers.js'
import { buildTyphoonLayers, typhoonPulseLayers } from './layers/typhoonLayers.js'
import { buildFlightLayers, flightPulseLayers } from './layers/flightLayers.js'
import QuakePanel from './components/QuakePanel.jsx'
import TyphoonPanel from './components/TyphoonPanel.jsx'
import FlightPanel from './components/FlightPanel.jsx'
import SatelliteGlobe from './components/SatelliteGlobe.jsx'
import SatellitePanel from './components/SatellitePanel.jsx'
import Legend from './components/Legend.jsx'
import { fmtTime } from './utils/geo.js'
import { TY_CATS } from './utils/scales.js'
import { BASEMAPS, getBasemap, loadBasemapPref, saveBasemapPref, pickFastestBasemap } from './utils/basemaps.js'

function getTooltip({ object }) {
  if (!object) return null
  const style = {
    background: 'rgba(12,16,30,0.92)', color: '#e8ecf6', fontSize: '12px',
    padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)',
    maxWidth: '260px',
  }
  if (object.place != null) {
    return {
      html: `<b>M${object.mag.toFixed(1)}</b> ${object.place}<br/>
        ${fmtTime(object.time)} · 深度 ${object.depth.toFixed(0)} km${object.tsunami ? '<br/>⚠️ 伴随海啸预警' : ''}`,
      style,
    }
  }
  if (object.cat != null) {
    const cat = TY_CATS[object.cat]?.label || object.cat
    const head = object.agency ? `【${object.agency} 预报】` : ''
    return {
      html: `${head}<b>${cat}</b><br/>${fmtTime(object.time)}<br/>
        风速 ${object.wind} m/s${object.pressure ? ` · 气压 ${object.pressure} hPa` : ''}`,
      style,
    }
  }
  if (object.hex != null && object.callsign != null) {
    return {
      html: `<b>${object.callsign}</b>${object.type ? ` · ${object.type}` : ''}<br/>
        ${object.onGround ? '地面' : object.altM != null ? `高度 ${object.altM} m` : ''}${object.speedKmh != null ? ` · ${object.speedKmh} km/h` : ''}<br/>
        <span style="opacity:0.7">点击追踪航路</span>`,
      style,
    }
  }
  return null
}

export default function App() {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)

  const [mode, setMode] = useState('typhoon')
  const [now, setNow] = useState(Date.now())

  // ── 底图：本地偏好 → 默认腾讯（国内快），无偏好时后台测速自动切换 ──
  const [basemapId, setBasemapId] = useState(() => loadBasemapPref() || 'tencent-dark')
  const [mapReady, setMapReady] = useState(false)
  const appliedBasemapRef = useRef(basemapId)

  // ── 地震状态 ──
  const [quakeParams, setQuakeParams] = useState({ range: 'day', minMag: 0, colorBy: 'mag', heatmap: false })
  const eq = useEarthquakes(quakeParams.range)
  const [selectedQuake, setSelectedQuake] = useState(null)
  const quakes = useMemo(
    () => eq.quakes.filter((q) => q.mag >= quakeParams.minMag),
    [eq.quakes, quakeParams.minMag]
  )

  // ── 台风状态 ──
  const ty = useTyphoons()
  const [activeId, setActiveId] = useState(null)
  const typhoon = useMemo(
    () => ty.typhoons.find((t) => t.id === activeId) || ty.typhoons[0] || null,
    [ty.typhoons, activeId]
  )
  const [timeIdx, setTimeIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [agencies, setAgencies] = useState({})

  // ── 航班状态 ──
  const BEIJING = [116.4, 39.9]
  const [flightCenter, setFlightCenter] = useState(BEIJING)
  const firstFlightVisitRef = useRef(true)
  const fl = useFlights(flightCenter, mode === 'flight')
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [flightInfo, setFlightInfo] = useState(null) // { route, photo }

  // ── 卫星状态 ──
  const sat = useSatellites(mode === 'satellite')
  const [selectedSat, setSelectedSat] = useState(null)
  const [showOrbits, setShowOrbits] = useState(true)
  const [showFootprints, setShowFootprints] = useState(false)
  const [showLabels, setShowLabels] = useState(true)

  // 初始化地图
  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: getBasemap(appliedBasemapRef.current).style,
      center: [128, 22],
      zoom: 3.6,
      minZoom: 1,
    })
    map.on('load', () => setMapReady(true))
    // 地图移动后更新航班查询中心(防抖)
    let moveTimer
    map.on('moveend', () => {
      clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        const c = map.getCenter()
        setFlightCenter([c.lng, c.lat])
      }, 700)
    })
    const overlay = new MapboxOverlay({ interleaved: false, layers: [], getTooltip })
    map.addControl(overlay)
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    mapRef.current = map
    overlayRef.current = overlay
    window.__map = map // 调试用
    window.__overlay = overlay
    // 无手动偏好时测速选最快底图
    if (!loadBasemapPref()) pickFastestBasemap().then((id) => setBasemapId(id))
    return () => map.remove()
  }, [])

  // 底图切换
  useEffect(() => {
    const map = mapRef.current
    if (!map || appliedBasemapRef.current === basemapId) return
    appliedBasemapRef.current = basemapId
    map.setStyle(getBasemap(basemapId).style)
  }, [basemapId])

  // 倒计时/相对时间时钟
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(t)
  }, [])

  // 台风数据到达 → 跳到最新位置
  useEffect(() => {
    if (typhoon) setTimeIdx(typhoon.track.length - 1)
  }, [typhoon?.id, typhoon?.track.length])

  // 回放推进
  useEffect(() => {
    if (!playing || !typhoon) return
    const iv = setInterval(() => {
      setTimeIdx((i) => {
        if (i >= typhoon.track.length - 1) { setPlaying(false); return i }
        return i + 1
      })
    }, 800 / speed)
    return () => clearInterval(iv)
  }, [playing, speed, typhoon])

  // 模式切换 → 镜头
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (mode === 'quake') {
      map.flyTo({ center: [150, 8], zoom: 1.6, duration: 1200 })
    } else if (mode === 'flight') {
      if (firstFlightVisitRef.current) {
        // 首次进入航班页:无论此前地图在哪,都以北京为起始视角
        firstFlightVisitRef.current = false
        setFlightCenter(BEIJING)
        map.flyTo({ center: BEIJING, zoom: 5.5, duration: 1200 })
      } else if (map.getZoom() < 4) {
        map.flyTo({ center: flightCenter, zoom: 5, duration: 1000 })
      }
    } else if (typhoon) {
      const pts = [...typhoon.track.map((p) => p.coord), ...Object.values(typhoon.forecasts).flat().map((p) => p.coord)]
      const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
      // 手机:面板贴底占 46vh → 用下方 padding;桌面:面板悬浮在左 → 用左侧 padding
      const mobile = window.innerWidth <= 860
      map.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        {
          padding: mobile
            ? { left: 30, right: 30, top: 70, bottom: Math.round(window.innerHeight * 0.5) }
            : { left: 400, right: 60, top: 80, bottom: 60 },
          duration: 1200,
          maxZoom: 6,
        }
      )
    }
  }, [mode, typhoon?.id])

  const onSelectQuake = useCallback((q) => {
    setSelectedQuake(q)
    mapRef.current?.flyTo({ center: q.coord, zoom: 5.5, duration: 900 })
  }, [])

  const onClickTrackPoint = useCallback((info) => {
    if (info?.index != null) { setPlaying(false); setTimeIdx(info.index) }
  }, [])

  const onSelectFlight = useCallback((f) => {
    setSelectedFlight(f.hex)
    setFlightInfo(null)
    fl.loadServerTrail(f.hex)
    fl.loadFlightInfo(f.hex, f.callsign).then(setFlightInfo)
    const map = mapRef.current
    if (map && map.getZoom() < 6) map.flyTo({ center: f.coord, zoom: 6.5, duration: 800 })
  }, [fl.loadServerTrail, fl.loadFlightInfo])

  // 构建静态图层（不含动画帧）
  const layers = useMemo(() => {
    if (mode === 'quake') {
      return buildQuakeLayers({
        quakes, colorBy: quakeParams.colorBy, heatmap: quakeParams.heatmap,
        onClick: (info) => info.object && onSelectQuake(info.object),
      })
    }
    if (mode === 'flight') {
      return buildFlightLayers({
        flights: fl.flights, trails: fl.trails, selectedHex: selectedFlight,
        selectedRoute: flightInfo?.route || null, center: flightCenter,
        onClick: (info) => info.object && onSelectFlight(info.object),
      })
    }
    return buildTyphoonLayers({ typhoon, timeIdx, agencies, onClickPoint: onClickTrackPoint })
  }, [mode, quakes, quakeParams.colorBy, quakeParams.heatmap, typhoon, timeIdx, agencies, onSelectQuake, onClickTrackPoint, fl.flights, fl.trails, fl.trailsVersion, selectedFlight, flightInfo, flightCenter, onSelectFlight])

  // 脉冲动画源
  const pulseSource = useMemo(() => {
    if (mode === 'quake') {
      if (quakeParams.heatmap) return null
      const recent = quakes.filter((q) => now - q.time < 24 * 3.6e6 && q.mag >= 4.5)
      return recent.length ? { type: 'quake', data: recent } : null
    }
    if (mode === 'flight') {
      const sel = fl.flights.find((f) => f.hex === selectedFlight)
      return sel ? { type: 'flight', data: sel } : null
    }
    const current = typhoon?.track[timeIdx]
    return current ? { type: 'typhoon', data: current } : null
  }, [mode, quakes, quakeParams.heatmap, typhoon, timeIdx, now, fl.flights, selectedFlight])

  // rAF 动画循环：直接更新 overlay，不触发 React 渲染
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    // 静态图层立即应用（rAF 在后台标签页会被节流，不能依赖它做首次渲染）
    overlay.setProps({ layers })
    if (!pulseSource) return
    let raf, last = 0
    const loop = (t) => {
      // window.__animPaused: 测试/截图时暂停动画,让渲染管线进入空闲
      if (!window.__animPaused && t - last > 66) {
        last = t
        const pulse = pulseSource.type === 'quake'
          ? quakePulseLayers(pulseSource.data, t)
          : pulseSource.type === 'flight'
            ? flightPulseLayers(pulseSource.data, t)
            : typhoonPulseLayers(pulseSource.data, t)
        overlay.setProps({ layers: [...layers, ...pulse] })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [layers, pulseSource])

  const updatedAt = mode === 'quake' ? eq.updatedAt : mode === 'flight' ? fl.updatedAt : mode === 'satellite' ? sat.updatedAt : ty.updatedAt
  const refresh = mode === 'quake' ? eq.refresh : mode === 'flight' ? fl.refresh : mode === 'satellite' ? sat.refresh : ty.refresh

  const isSatellite = mode === 'satellite'

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-logo">🌐</span>
          <span className="brand-name">GeoPulse</span>
          <span className="brand-sub">台风 · 地震实时追踪</span>
        </div>
        <nav className="tabs">
          <button className={mode === 'typhoon' ? 'tab active' : 'tab'} onClick={() => setMode('typhoon')}>🌀 台风</button>
          <button className={mode === 'quake' ? 'tab active' : 'tab'} onClick={() => setMode('quake')}>🌍 地震</button>
          <button className={mode === 'flight' ? 'tab active' : 'tab'} onClick={() => setMode('flight')}>✈️ 航班</button>
          <button className={mode === 'satellite' ? 'tab active' : 'tab'} onClick={() => setMode('satellite')}>🛰 卫星</button>
        </nav>
        <div className="header-right">
          {!isSatellite && (
            <select
              className="basemap-select"
              value={basemapId}
              onChange={(e) => { setBasemapId(e.target.value); saveBasemapPref(e.target.value) }}
              title="切换底图"
            >
              {BASEMAPS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <span className="pulse-dot" />
          <span className="updated">{updatedAt ? `更新于 ${fmtTime(updatedAt)}` : '加载中…'}</span>
          <button className="refresh-btn" onClick={refresh} title="立即刷新">⟳</button>
        </div>
      </header>

      <div className="map-wrap">
        {isSatellite ? (
          <SatelliteGlobe
            satellites={sat.satellites}
            selectedId={selectedSat?.id}
            showOrbits={showOrbits}
            showFootprints={showFootprints}
            showLabels={showLabels}
            onClick={setSelectedSat}
          />
        ) : (
          <>
            <div ref={mapEl} className="map" />
            {!mapReady && <div className="map-loading"><span className="spinner" />底图加载中…</div>}
          </>
        )}
        {isSatellite ? (
          <SatellitePanel
            satellites={sat.satellites}
            selected={selectedSat}
            onSelect={setSelectedSat}
            groups={sat.groups}
            setGroups={sat.setGroups}
            showOrbits={showOrbits}
            setShowOrbits={setShowOrbits}
            showFootprints={showFootprints}
            setShowFootprints={setShowFootprints}
            showLabels={showLabels}
            setShowLabels={setShowLabels}
            loading={sat.loading}
            error={sat.error}
            updatedAt={sat.updatedAt}
          />
        ) : mode === 'quake' ? (
          <QuakePanel
            quakes={quakes} params={quakeParams} setParams={setQuakeParams}
            selected={selectedQuake} onSelect={onSelectQuake}
            loading={eq.loading} error={eq.error} now={now}
          />
        ) : mode === 'flight' ? (
          <FlightPanel
            flights={fl.flights} selected={selectedFlight} onSelect={onSelectFlight} flightInfo={flightInfo}
            loading={fl.loading} error={fl.error} updatedAt={fl.updatedAt} source={fl.source} now={now}
          />
        ) : (
          <TyphoonPanel
            typhoons={ty.typhoons} activeId={typhoon?.id} setActiveId={setActiveId} typhoon={typhoon}
            timeIdx={timeIdx} setTimeIdx={setTimeIdx}
            playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed}
            agencies={agencies} setAgencies={setAgencies}
            source={ty.source} now={now}
          />
        )}
        <Legend mode={mode} colorBy={quakeParams.colorBy} />
      </div>
    </div>
  )
}
