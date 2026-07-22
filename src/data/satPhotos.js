// 著名卫星照片(Wikimedia Commons,可自由使用;img 标签加载无需 CORS)
// key: NORAD ID 或按名称前缀匹配
export const SAT_PHOTOS = {
  25544: { // ISS
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/International_Space_Station_after_undocking_of_STS-132.jpg/500px-International_Space_Station_after_undocking_of_STS-132.jpg',
    credit: 'NASA / STS-132 crew, CC0',
  },
  20580: { // Hubble
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/HST-SM4.jpeg/500px-HST-SM4.jpeg',
    credit: 'NASA, Public Domain',
  },
  48274: { // CSS / 中国空间站核心舱天和
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Chinese_Tiangong_Space_Station.jpg/500px-Chinese_Tiangong_Space_Station.jpg',
    credit: 'Shujianyang, CC BY-SA 4.0',
  },
}

// 按卫星名称前缀匹配的照片(星座代表图)
export const NAME_PHOTOS = [
  {
    match: /^STARLINK/,
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Starlink_Mission_%2847926144123%29.jpg/500px-Starlink_Mission_%2847926144123%29.jpg',
    credit: 'Official SpaceX Photos, CC0',
    desc: 'Starlink 发射任务',
  },
  {
    match: /^NAVSTAR|^GPS BIIF|^GPS BIII|^USA-\d/,
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/GPS_Block_IIIA.jpg/500px-GPS_Block_IIIA.jpg',
    credit: 'USAF, Public Domain',
    desc: 'GPS Block IIIA',
  },
  {
    match: /^BEIDOU|BDS-/,
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Chinese_news_rendering_of_Beidou_satellite.png/500px-Chinese_news_rendering_of_Beidou_satellite.png',
    credit: 'CNSA news rendering',
    desc: '北斗导航卫星',
  },
  {
    match: /^GALILEO/,
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Galileo_satellite_model.jpg/500px-Galileo_satellite_model.jpg',
    credit: 'ESA, CC BY-SA 3.0-igo',
    desc: '伽利略卫星模型',
  },
  {
    match: /^IRIDIUM/,
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Iridium_satellite.jpg/500px-Iridium_satellite.jpg',
    credit: 'Iridium / NASA, Public Domain',
    desc: '铱星',
  },
]

// 轨道类型配图(无专属照片时的兜底,按高度区间)
export const ORBIT_FALLBACK = [
  { maxAlt: 2000e3, label: '低地球轨道 (LEO)', color: '#4da3ff' },
  { maxAlt: 40000e3, label: '中地球轨道 (MEO)', color: '#ffd84a' },
  { maxAlt: Infinity, label: '地球同步轨道 (GEO)', color: '#d253d9' },
]

export function getSatPhoto(sat) {
  if (!sat) return null
  const direct = SAT_PHOTOS[sat.norad]
  if (direct) return direct
  for (const p of NAME_PHOTOS) {
    if (p.match.test(sat.name)) return p
  }
  return null
}
