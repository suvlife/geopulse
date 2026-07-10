import { useMemo } from 'react'
import { TY_CATS, catColor, AGENCY_COLORS } from '../utils/scales.js'
import { cityImpact, fmtCountdown, fmtTime } from '../utils/geo.js'
import { CITIES } from '../data/sampleTyphoon.js'

const AGENCY_NAMES = { CMA: '中央气象台', JMA: '日本气象厅', JTWC: '美国联合警报中心' }

const GUIDES = [
  { icon: '🏠', title: '居家防护', tips: ['关紧门窗，加固易被吹动的搭建物', '阳台花盆、杂物移入室内', '储备 3 天饮用水、食品、照明和充电宝'] },
  { icon: '🚗', title: '出行安全', tips: ['台风登陆前后避免外出', '远离广告牌、临时建筑、大树和电线杆', '不要在低洼地带、地下车库停留'] },
  { icon: '⚡', title: '断电断网', tips: ['提前给设备充满电', '记下当地应急电话', '收藏离线地图与本页面（支持缓存）'] },
]

export default function TyphoonPanel({
  typhoons, activeId, setActiveId, typhoon,
  timeIdx, setTimeIdx, playing, setPlaying, speed, setSpeed,
  agencies, setAgencies, source, now,
}) {
  const current = typhoon?.track[timeIdx]
  const isLatest = typhoon && timeIdx === typhoon.track.length - 1

  const impacts = useMemo(() => {
    if (!typhoon) return []
    const fc = typhoon.forecasts.CMA || Object.values(typhoon.forecasts)[0] || []
    const track = [...typhoon.track.slice(-1), ...fc]
    return CITIES.map((c) => ({ city: c, hit: cityImpact(track, c, 320) }))
      .filter((x) => x.hit)
      .sort((a, b) => a.hit.time - b.hit.time)
  }, [typhoon])

  if (!typhoon) return (
    <div className="panel"><div className="panel-title">🌀 台风追踪</div><div className="empty">正在获取台风数据…</div></div>
  )

  const cat = TY_CATS[current.cat] || TY_CATS.TD

  return (
    <div className="panel">
      <div className="panel-title">
        🌀 台风追踪
        <span className={source === 'live' ? 'badge live' : 'badge demo'}>
          {source === 'live' ? '实时数据' : '演示数据'}
        </span>
      </div>

      {typhoons.length > 1 && (
        <div className="control-row">
          <div className="seg">
            {typhoons.map((t) => (
              <button key={t.id} className={t.id === activeId ? 'seg-btn active' : 'seg-btn'} onClick={() => setActiveId(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ty-head">
        <div className="ty-name">
          {typhoon.name} <span className="ty-en">{typhoon.enname} · 第 {typhoon.no || '—'} 号</span>
        </div>
        <span className="cat-badge" style={{ background: `rgb(${catColor(current.cat).join(',')})` }}>
          {cat.label}
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{current.wind}<span className="unit"> m/s</span></div>
          <div className="stat-label">中心风速</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{current.pressure ?? '—'}<span className="unit"> hPa</span></div>
          <div className="stat-label">中心气压</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{current.power ?? '—'}<span className="unit"> 级</span></div>
          <div className="stat-label">风力等级</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{current.moveSpeed ?? '—'}<span className="unit"> km/h</span></div>
          <div className="stat-label">移速 {current.moveDir && `· ${current.moveDir}`}</div>
        </div>
      </div>

      <div className="section-title">⏱ 路径回放 <span className="section-sub">{fmtTime(current.time)}</span></div>
      <div className="playback">
        <button className="play-btn" onClick={() => {
          if (isLatest && !playing) setTimeIdx(0)
          setPlaying(!playing)
        }}>
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range" min="0" max={typhoon.track.length - 1} value={timeIdx}
          onChange={(e) => { setPlaying(false); setTimeIdx(+e.target.value) }}
        />
        <button className="speed-btn" onClick={() => setSpeed(speed >= 4 ? 1 : speed * 2)}>{speed}x</button>
      </div>
      {!isLatest && (
        <button className="toggle-btn" style={{ width: '100%' }} onClick={() => { setPlaying(false); setTimeIdx(typhoon.track.length - 1) }}>
          ⏭ 回到最新位置（显示预报）
        </button>
      )}

      {isLatest && (
        <>
          <div className="section-title">🛰 预报机构对比</div>
          <div className="agency-row">
            {Object.keys(typhoon.forecasts).map((a) => (
              <button
                key={a}
                className={agencies[a] !== false ? 'agency-chip active' : 'agency-chip'}
                style={{ '--c': `rgb(${(AGENCY_COLORS[a] || [200, 200, 200]).join(',')})` }}
                onClick={() => setAgencies((s) => ({ ...s, [a]: s[a] === false }))}
              >
                <span className="agency-dot" />{AGENCY_NAMES[a] || a}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-title">🏙 城市波及倒计时 <span className="section-sub">距路径 320km 内</span></div>
      <div className="impact-list">
        {impacts.length === 0 && <div className="empty">预报路径暂不影响重点城市</div>}
        {impacts.map(({ city, hit }) => (
          <div key={city.name} className="impact-row">
            <span className="impact-city">{city.name}</span>
            <span className="impact-dist">最近 {hit.dist.toFixed(0)} km</span>
            <span className={hit.time - now <= 0 ? 'impact-eta hit' : 'impact-eta'}>
              {fmtCountdown(hit.time - now)}
            </span>
          </div>
        ))}
      </div>

      <div className="section-title">🧰 应急指南</div>
      {GUIDES.map((g) => (
        <details key={g.title} className="guide">
          <summary>{g.icon} {g.title}</summary>
          <ul>{g.tips.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
      ))}

      <div className="foot-note">
        数据参考：中央气象台 / 浙江水利 / USGS · 信息仅供参考，请以官方预警为准
      </div>
    </div>
  )
}
