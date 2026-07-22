import { useState } from 'react'
import { TY_CATS, AGENCY_COLORS } from '../utils/scales.js'
import { GROUP_COLORS, GROUP_LABELS } from '../layers/satelliteLayers.js'
import { SHIP_TYPE_COLORS, SHIP_TYPE_LABELS } from '../data/shipData.js'

const MAG_ITEMS = [
  ['M<3', [46, 204, 113]], ['M3-4', [241, 196, 15]], ['M4-5', [230, 126, 34]],
  ['M5-6', [231, 76, 60]], ['M6-7', [192, 43, 96]], ['M7+', [155, 29, 184]],
]
const DEPTH_ITEMS = [
  ['<10km', [255, 90, 70]], ['<30', [255, 160, 60]], ['<70', [255, 220, 80]],
  ['<150', [110, 200, 120]], ['<300', [70, 150, 220]], ['300+', [120, 90, 220]],
]
const AGENCY_NAMES = { CMA: '中央气象台', JMA: '日本气象厅', JTWC: '美国 JTWC' }

const ALT_ITEMS = [
  ['地面', [150, 155, 170]], ['低空', [255, 207, 77]], ['3km', [124, 224, 122]],
  ['6km', [77, 163, 255]], ['9km', [143, 107, 255]], ['12km+', [210, 77, 255]],
]

const SAT_ITEMS = Object.entries(GROUP_LABELS).map(([key, label]) => [label, GROUP_COLORS[key]])

export default function Legend({ mode, colorBy }) {
  // 手机上默认折叠,桌面默认展开
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 860))

  if (!open) {
    return (
      <button className="legend legend-collapsed" onClick={() => setOpen(true)}>ℹ️ 图例</button>
    )
  }

  return (
    <div className="legend" onClick={() => { if (window.innerWidth <= 860) setOpen(false) }}>
      {mode === 'quake' ? (
        <>
          <div className="legend-title">{colorBy === 'depth' ? '震源深度' : '震级'}</div>
          <div className="legend-items">
            {(colorBy === 'depth' ? DEPTH_ITEMS : MAG_ITEMS).map(([label, c]) => (
              <span key={label} className="legend-item">
                <i style={{ background: `rgb(${c.join(',')})` }} />{label}
              </span>
            ))}
          </div>
          <div className="legend-note">圆圈大小 = 震级 · 扩散圈 = 24h 内 M4.5+</div>
        </>
      ) : mode === 'flight' ? (
        <>
          <div className="legend-title">飞行高度</div>
          <div className="legend-items">
            {ALT_ITEMS.map(([label, c]) => (
              <span key={label} className="legend-item">
                <i style={{ background: `rgb(${c.join(',')})` }} />{label}
              </span>
            ))}
          </div>
          <div className="legend-note">机头朝向 = 航向 · 虚线圈 = 数据覆盖范围(463km)· 点击飞机显示航路</div>
        </>
      ) : mode === 'satellite' ? (
        <>
          <div className="legend-title">卫星类型</div>
          <div className="legend-items">
            {SAT_ITEMS.map(([label, c]) => (
              <span key={label} className="legend-item">
                <i style={{ background: `rgb(${c.join(',')})` }} />{label}
              </span>
            ))}
          </div>
          <div className="legend-note">3D 地球可拖拽/缩放/旋转 · 点大小~轨道高度</div>
        </>
      ) : mode === 'ship' ? (
        <>
          <div className="legend-title">船型</div>
          <div className="legend-items">
            {Object.entries(SHIP_TYPE_LABELS).map(([k, l]) => (
              <span key={k} className="legend-item">
                <i style={{ background: `rgb(${SHIP_TYPE_COLORS[k].join(',')})` }} />{l}
              </span>
            ))}
          </div>
          <div className="legend-note">船头朝向 = 航向 · ⚓ 黄色圆点 = 港口 · 点击船查看档案</div>
        </>
      ) : (
        <>
          <div className="legend-title">台风等级</div>
          <div className="legend-items">
            {Object.values(TY_CATS).map((c) => (
              <span key={c.label} className="legend-item">
                <i style={{ background: `rgb(${c.color.join(',')})` }} />{c.label}
              </span>
            ))}
          </div>
          <div className="legend-items" style={{ marginTop: 6 }}>
            {Object.entries(AGENCY_COLORS).map(([a, c]) => (
              <span key={a} className="legend-item">
                <i className="dash" style={{ background: `rgb(${c.join(',')})` }} />{AGENCY_NAMES[a]}
              </span>
            ))}
          </div>
          <div className="legend-note">实线 = 已观测路径 · 虚线 = 预报 · 黄/橙/红圈 = 7/10/12 级风圈</div>
        </>
      )}
    </div>
  )
}
