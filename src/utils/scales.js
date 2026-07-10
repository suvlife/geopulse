// 颜色与尺寸映射

// 震级 → 颜色（绿 → 黄 → 橙 → 红 → 深红）
export function magColor(m) {
  if (m < 3) return [46, 204, 113]
  if (m < 4) return [241, 196, 15]
  if (m < 5) return [230, 126, 34]
  if (m < 6) return [231, 76, 60]
  if (m < 7) return [192, 43, 96]
  return [155, 29, 184]
}

// 震源深度 → 颜色（浅=暖，深=冷）
export function depthColor(d) {
  if (d < 10) return [255, 90, 70]
  if (d < 30) return [255, 160, 60]
  if (d < 70) return [255, 220, 80]
  if (d < 150) return [110, 200, 120]
  if (d < 300) return [70, 150, 220]
  return [120, 90, 220]
}

export function magRadius(m) {
  return Math.max(3, Math.pow(2, m) * 0.35)
}

// 台风等级
export const TY_CATS = {
  TD: { label: '热带低压', color: [98, 176, 245], wind: '10.8-17.1 m/s' },
  TS: { label: '热带风暴', color: [70, 220, 170], wind: '17.2-24.4 m/s' },
  STS: { label: '强热带风暴', color: [255, 216, 74], wind: '24.5-32.6 m/s' },
  TY: { label: '台风', color: [255, 158, 61], wind: '32.7-41.4 m/s' },
  STY: { label: '强台风', color: [255, 92, 92], wind: '41.5-50.9 m/s' },
  SuperTY: { label: '超强台风', color: [217, 83, 217], wind: '≥51.0 m/s' },
}

export function windToCat(w) {
  if (w < 17.2) return 'TD'
  if (w < 24.5) return 'TS'
  if (w < 32.7) return 'STS'
  if (w < 41.5) return 'TY'
  if (w < 51.0) return 'STY'
  return 'SuperTY'
}

export function catColor(cat) {
  return (TY_CATS[cat] || TY_CATS.TD).color
}

export const AGENCY_COLORS = {
  CMA: [255, 99, 99],
  JMA: [99, 178, 255],
  JTWC: [140, 235, 140],
}
