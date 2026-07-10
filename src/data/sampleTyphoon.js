import { windToCat } from '../utils/scales.js'

// 沿海重点城市（用于波及倒计时）
export const CITIES = [
  { name: '上海', coord: [121.47, 31.23] },
  { name: '杭州', coord: [120.16, 30.29] },
  { name: '宁波', coord: [121.55, 29.87] },
  { name: '台州', coord: [121.42, 28.66] },
  { name: '温州', coord: [120.7, 28.0] },
  { name: '福州', coord: [119.3, 26.08] },
  { name: '厦门', coord: [118.09, 24.48] },
  { name: '汕头', coord: [116.68, 23.35] },
  { name: '台北', coord: [121.56, 25.03] },
]

const H = 3.6e6

function windRadii(wind, scale = 1) {
  // 简化：风圈半径随强度增大，东北象限略大（西太平洋常见形态）
  const base = Math.max(0, (wind - 15) * 9) * scale
  if (base <= 0) return null
  return {
    ne: Math.round(base * 1.25),
    se: Math.round(base * 1.05),
    sw: Math.round(base * 0.85),
    nw: Math.round(base * 0.95),
  }
}

// 演示数据：模拟一个自西北太平洋逼近浙闽沿海的台风
// 内部格式与真实数据源适配结果完全一致，可无缝切换
export function buildSampleTyphoon(now = Date.now()) {
  const track = []
  const N = 13 // 过去 72h，每 6h 一点
  for (let i = 0; i < N; i++) {
    const time = now - (N - 1 - i) * 6 * H
    const f = i / (N - 1)
    const lon = 137.6 - 13.4 * f - 1.2 * Math.sin(f * Math.PI)
    const lat = 15.4 + 9.8 * f + 0.8 * Math.sin(f * Math.PI * 0.7)
    const wind = Math.round(17 + 36 * Math.sin(Math.PI * Math.min(f * 1.12, 0.94)))
    const prev = track[i - 1]
    track.push({
      time,
      coord: [+lon.toFixed(2), +lat.toFixed(2)],
      wind,
      pressure: Math.round(1010 - wind * 1.65),
      power: Math.min(17, Math.round(wind / 3.3) + 3),
      moveSpeed: prev ? 22 : 20,
      moveDir: '西北',
      cat: windToCat(wind),
      r7: windRadii(wind, 1),
      r10: wind >= 24.5 ? windRadii(wind, 0.45) : null,
      r12: wind >= 32.7 ? windRadii(wind, 0.22) : null,
    })
  }

  const last = track[track.length - 1]
  // 三家机构预报：未来 48h，每 6h 一点，路径略有分歧
  const mkForecast = (dLon, dLat, dWind) => {
    const pts = []
    for (let i = 1; i <= 8; i++) {
      const f = i / 8
      const lon = last.coord[0] - 2.6 * f + dLon * f
      const lat = last.coord[1] + 3.4 * f + dLat * f
      const wind = Math.max(15, Math.round(last.wind - 14 * f + dWind * f))
      pts.push({
        time: last.time + i * 6 * H,
        coord: [+lon.toFixed(2), +lat.toFixed(2)],
        wind,
        pressure: Math.round(1010 - wind * 1.65),
        cat: windToCat(wind),
      })
    }
    return pts
  }

  return {
    id: 'DEMO-202609',
    name: '巴威',
    enname: 'BAVI',
    no: '2609',
    track,
    forecasts: {
      CMA: mkForecast(0, 0, 0),
      JMA: mkForecast(0.9, -0.5, -3),
      JTWC: mkForecast(-0.8, 0.6, 4),
    },
  }
}
