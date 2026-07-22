import { ROUTES, MID_COUNTRIES } from '../data/shipData.js'

// 真实船名库(按船型)
const NAMES = {
  cargo: ['OCEAN PACIFIC', 'EASTERN GLORY', 'PACIFIC STAR', 'GOLDEN BRIDGE', 'ORIENTAL WIND', 'BLUE OCEAN', 'SEA VOYAGER', 'PACIFIC DAWN', 'OCEAN TRIUMPH', 'GLOBAL HARMONY'],
  tanker: ['OCEANIA CARRIER', 'PACIFIC ENERGY', 'MAERSK TIGER', 'SINOTRANS OIL', 'PETRO SEA', 'OCEAN LEADER', 'ENERGY PROGRESS', 'COSCO TANKER', 'GULF NAVIGATOR', 'OCEAN PEARL'],
  container: ['EVER GREEN', 'COSCO SHIPPING', 'MAERSK EMDEN', 'MSC OSCAR', 'CMA CGM', 'OOCL GERMANY', 'ONE AQUILA', 'HMM GDANSK', 'YANG MING', 'WAN HAI'],
  passenger: ['STAR CRUISE', 'OCEAN PRINCESS', 'PACIFIC FERRY', 'SEA TRAVELER', 'MARINE QUEEN'],
  fishing: ['YUAN YU', 'DONG FANG', 'HAI FENG', 'ZHOU SHAN', 'NANTONG', 'FU XING'],
  tug: ['HARBOUR TUG 1', 'PORT ASSIST', 'SEA HORSE', 'ANCHOR PULLER'],
  other: ['SURVEY VESSEL', 'CABLE LAYER', 'DREDGER KING', 'SUPPLY SHIP'],
}

// 真实航线目的港
const DESTINATIONS = ['SINGAPORE', 'PORT KLANG', 'JAKARTA', 'BANGKOK', 'HO CHI MINH', 'YANGON', 'SURABAYA', 'SHANGHAI', 'HONG KONG', 'GUANGZHOU', 'TOKYO', 'BUSAN']

// 常用 MID(国籍)分布:巴拿马/利比里亚/马绍尔/中国/日本/新加坡/香港 为主
const COMMON_MIDS = [
  351, 352, 353, 354, 355, 356, 357, 358, 359, 360, // 巴拿马
  636, 637, 638, 639, 640, 641, 642, 643, 644, 645, // 利比里亚
  538, 539, 540, 541, 542, 543, 544, 545, 546, 547, // 马绍尔群岛
  412, 413, 414, 470, 471, // 中国
  431, 432, // 日本
  440, 441, // 韩国
  563, 564, 565, 566, // 新加坡
  477, // 香港
  525, 526, // 印度尼西亚
  574, 576, // 越南
  567, // 泰国
  305, 306, 307, 308, 309, // 其他常见
]

function rand(seed) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

// 沿航线插值
function lerp(a, b, t) { return a + (b - a) * t }

function pointAlongRoute(points, dist) {
  // dist: 0-1 归一化距离
  let total = 0
  const segs = []
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0]
    const dy = points[i + 1][1] - points[i][1]
    const len = Math.hypot(dx, dy)
    segs.push(len)
    total += len
  }
  let target = dist * total
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const t = target / segs[i]
      const lon = lerp(points[i][0], points[i + 1][0], t)
      const lat = lerp(points[i][1], points[i + 1][1], t)
      const bearing = (Math.atan2(
        points[i + 1][0] - points[i][0],
        points[i + 1][1] - points[i][1]
      ) * 180) / Math.PI
      return { coord: [lon, lat], bearing: ((bearing % 360) + 360) % 360 }
    }
    target -= segs[i]
  }
  const last = points[points.length - 1]
  return { coord: [last[0], last[1]], bearing: 0 }
}

// 生成一批模拟船舶(种子确定,重载可复现)
export function generateShips(count = 400, seed = 42) {
  const rnd = rand(seed)
  const ships = []
  const typeKeys = ['cargo', 'tanker', 'container', 'passenger', 'fishing', 'tug', 'other']
  const typeWeights = [0.3, 0.2, 0.18, 0.04, 0.12, 0.08, 0.08]

  for (let i = 0; i < count; i++) {
    const route = ROUTES[Math.floor(rnd() * ROUTES.length)]
    let r = rnd()
    let type = 'cargo'
    let acc = 0
    for (let k = 0; k < typeKeys.length; k++) {
      acc += typeWeights[k]
      if (r <= acc) { type = typeKeys[k]; break }
    }
    const mid = COMMON_MIDS[Math.floor(rnd() * COMMON_MIDS.length)]
    const mmsi = mid * 1000000 + Math.floor(rnd() * 900000) + 100000
    const namePool = NAMES[type] || NAMES.other
    const name = namePool[Math.floor(rnd() * namePool.length)] + (rnd() < 0.3 ? ` ${Math.floor(rnd() * 900 + 100)}` : '')
    const speed = type === 'tug' ? 4 + rnd() * 4 : type === 'fishing' ? 6 + rnd() * 5 : 10 + rnd() * 8 // 节
    const dist0 = rnd()
    ships.push({
      id: String(mmsi),
      mmsi,
      name,
      type,
      country: MID_COUNTRIES[mid] || '未知',
      route: route.id,
      dist: dist0,
      dir: 1, // 沿航线方向
      speedKnots: speed,
      dest: DESTINATIONS[Math.floor(rnd() * DESTINATIONS.length)],
      imo: 9000000 + Math.floor(rnd() * 999999),
      dwt: type === 'tanker' ? 50000 + rnd() * 200000 : type === 'container' ? 20000 + rnd() * 100000 : 10000 + rnd() * 60000,
      length: type === 'tug' ? 25 + rnd() * 15 : type === 'fishing' ? 40 + rnd() * 30 : 150 + rnd() * 250,
    })
  }
  return ships
}

// 每帧推进船舶位置
export function advanceShips(ships, dtMs, simSpeed = 1) {
  const dtHours = (dtMs / 3600000) * simSpeed
  for (const s of ships) {
    const route = ROUTES.find((r) => r.id === s.route)
    if (!route) continue
    // 航速(节) → 度/小时(粗略:1节 ≈ 0.0185°/h 在低纬度近似)
    const degPerHour = s.speedKnots * 0.016
    let total = 0
    for (let i = 0; i < route.points.length - 1; i++) {
      total += Math.hypot(
        route.points[i + 1][0] - route.points[i][0],
        route.points[i + 1][1] - route.points[i][1]
      )
    }
    s.dist += (degPerHour * dtHours) / total * s.dir
    // 到达终点后反向(简化:往返)
    if (s.dist >= 1) { s.dist = 1; s.dir = -1 }
    else if (s.dist <= 0) { s.dist = 0; s.dir = 1 }
    const pos = pointAlongRoute(route.points, s.dist)
    s.coord = pos.coord
    s.bearing = pos.bearing
    if (s.dir < 0) s.bearing = (pos.bearing + 180) % 360
  }
  return ships
}
