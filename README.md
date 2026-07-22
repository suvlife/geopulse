# GeoPulse 🌐

**台风 · 地震 · 航班 · 卫星实时追踪可视化平台**

一个纯前端 + 边缘计算的开源实时追踪站:台风路径与多机构预报、全球地震监测、类 Flightradar24 的航班追踪、**3D 地球卫星星座可视化**,全部基于**免费数据源**构建。

**🔗 在线访问:https://geopulse.guofeng.me**

![React](https://img.shields.io/badge/React-18-61dafb?logo=react) ![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite) ![MapLibre](https://img.shields.io/badge/MapLibre%20GL-4-396cb2) ![deck.gl](https://img.shields.io/badge/deck.gl-9-9146ff) ![satellite.js](https://img.shields.io/badge/satellite.js-SGP4-2ea44f) ![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20Workers%20%2B%20KV-f38020?logo=cloudflare)

---

## 功能

### 🌀 台风追踪(实时)
- **实时活跃台风**:自动获取当前编号台风(数据同源于浙江水利厅台风路径系统),无活跃台风时回看近期台风(标注"已停编"),数据源全挂时降级演示数据(明确标注)
- 观测路径按**强度六级色标**着色:热带低压 → 热带风暴 → 强热带风暴 → 台风 → 强台风 → 超强台风
- **非对称风圈**:7/10/12 级风圈按东北/东南/西南/西北四象限半径绘制真实形状
- **多机构预报对比**:中央气象台/日本气象厅/美国 JTWC/香港天文台/韩国气象厅/台湾气象署(数据源提供哪家显示哪家),虚线路径可逐家开关
- **路径回放**:时间轴拖动 + 播放(1x/2x/4x),点击任意轨迹点跳转到该时刻(风圈/指标同步)
- **城市波及倒计时**:基于预报路径计算沿海重点城市最近距离与预计影响时间
- 中心风速/气压/风力等级/移速指标卡 + 分类应急指南(居家/出行/断电断网)

### 🌍 地震监测(全球)
- **USGS 实时数据**:24 小时 / 7 天 / 30 天三档,2 分钟自动刷新
- 震级气泡(大小=震级)+ 双色彩模式:按**震级**(绿→紫)或按**震源深度**(暖=浅源,冷=深源)
- **热力图模式**一键切换;24h 内 M4.5+ 地震**脉冲扩散动画**
- 最小震级滑杆筛选、最新地震列表点击定位、海啸预警标记
- 统计卡:总数 / 最大震级 / M5+ 数量 / 最近一次时间

### ✈️ 航班追踪(类 Flightradar24)
- 默认**北京视角**起始,视野中心 463km 半径实时航班,**12 秒刷新**,拖动地图自动加载新区域
- 飞机图标**按真实航向旋转**、按**飞行高度着色**(地面灰 → 低空黄 → 3km 绿 → 6km 蓝 → 9km 紫 → 12km+ 品红)
- **点击飞机查看完整档案**:
  - 真实**飞机照片**(planespotters.net,带摄影师署名,点击看大图)
  - **航空公司 + 所属国家**(如 "Cathay Pacific (CX) · Hong Kong")
  - **起降机场卡片**:IATA 码 + 城市 + 国家
  - 高度/地速/航向/垂直速率/应答机码/ICAO24
- **航线可视化**:起飞机场 →(蓝色实线,已飞大圆航段)→ 飞机 →(灰色虚线,待飞)→ 目的机场,两端机场打点标注
- **双层航迹**:服务端 KV 持续记录(任何访客浏览过的区域自动积累历史)+ 本地 12s 轮询实时累积
- 搜索(航班号/注册号/机型)、按距离排序、紧急状态(squawk 7700 等)告警

### 🛰 卫星追踪(3D 地球实时演示)
- **16,000+ 在轨目标全量渲染**:CelesTrak active 全星座,3D 地球可拖拽/缩放/旋转
- **TLE 快照分发**:构建时抓取快照随静态站分发(规避 CelesTrak 对浏览器/数据中心 IP 的 403 限流),用户零 CORS 零限流
- **本地 SGP4 逐帧推算**:卫星逐帧连续运动(60fps),**时间加速 1×-1000×**,暂停/回到现在,UTC 时钟
- **10 星座分组**:星链/一网/空间站/GPS/北斗/GLONASS/伽利略/铱星/气象/其他,独立开关+实时计数
- **点击卫星看档案**:真实照片(Wikimedia Commons)+ SATCAT 档案(所属国、发射日期、轨道周期、倾角、远/近地点)+ 实时位置速度 + 完整轨道线 + 星下点覆盖圈
- 参考效果:trackthesky.com / satellitemap.space

### 通用
- 深色主题 + WebGL 高性能渲染,数千点位流畅交互
- **多源底图自动测速**:腾讯暗色(国内快)/CARTO(海外矢量)/Esri 暗灰,顶栏可手动切换并记住偏好
- **移动端完整适配**:底部抽屉面板、可折叠图例、触控友好、无横向溢出

---

## 架构

```
┌────────────────────────────────────────────────┐
│  前端 (Cloudflare Pages, 纯静态)                │
│  React 18 + Vite + MapLibre GL + deck.gl 9     │
│  台风/地震/航班: MapLibre + MapboxOverlay deck  │
│  卫星: deck.gl _GlobeView (3D 地球)             │
│  https://geopulse.guofeng.me                   │
└──────┬─────────────────────────┬───────────────┘
       │ 直连(支持 CORS 的源)      │ 代理(CORS/UA/限流受限的源)
       ▼                         ▼
┌──────────────┐   ┌─────────────────────────────┐
│ USGS 地震     │   │  Cloudflare Worker + KV     │
│ istrongcloud │   │  geopulse-api.guofeng.me    │
│ adsbdb 航线   │   │  /flights /trail /route     │
│ airplanes.live│  │  /photo /typhoon/*          │
└──────────────┘   │  边缘缓存 + 航迹 KV 存储      │
                   └─────────────────────────────┘
```

**设计要点**

- **动画与渲染分离**:脉冲/扩散动画走独立 rAF 循环直接更新 deck.gl overlay,不触发 React 重渲染;静态图层同步应用,后台标签页不受 rAF 节流影响
- **卫星 SGP4 逐帧推算**:每帧只传播当前时刻,30fps 连续运动;Starlink 抽样 1800 颗保证流畅
- **边缘缓存策略**:航班请求坐标取整到 0.5° 网格 → 相邻用户命中同一缓存(12s TTL),保护免费上游
- **KV 航迹"搭便车"记录**:`/flights` 缓存未命中回源时顺手把整个区域所有飞机位置写入 KV(150s 写节流,适配免费额度 1000 写/天;每机 60 点,6h 过期),不产生任何额外上游请求
- **多级降级**:每个数据源都有直连→代理→兜底数据的降级链,单点故障不白屏

## 数据源(全部免费,无需 API Key)

| 模块 | 来源 | 接入方式 | 说明 |
|---|---|---|---|
| 地震 | [USGS Earthquake Feed](https://earthquake.usgs.gov/earthquakes/feed/) | 直连 | CORS 开放,全球实时 |
| 台风 | data.istrongcloud.com | 直连优先,Worker 兜底 | 年度文件 + `is_current` 筛活跃;含多机构预报与四象限风圈 |
| 航班位置 | [adsb.lol](https://api.adsb.lol) | Worker 代理 | 社区 ADS-B,无 CORS 头必须代理;备源 [airplanes.live](https://airplanes.live)(CORS 开放可直连) |
| 航线/航司 | [adsbdb](https://www.adsbdb.com) | 直连优先,Worker 兜底 | callsign → 航司/起降机场;对数据中心 IP 有限流,故前端直连优先 |
| 飞机照片 | [planespotters.net](https://www.planespotters.net/photo/api) | Worker 代理(24h 缓存) | 要求 UA 携带联系方式,浏览器无法自定义 UA 必须代理 |
| 卫星 TLE | [CelesTrak](https://celestrak.org/NORAD/elements/) | **构建时快照** | gp.php 对浏览器/数据中心 IP 限流(403),构建时抓取快照到 `/data/` 随站分发;SATCAT 档案同方案 |

> ⚠️ 信息仅供参考,台风/地震请以官方预警为准;航班数据来自社区网络,不得用于运行控制。

## 快速开始

```bash
# 前端
npm install
npm run dev        # http://localhost:5188
npm run build      # 产物 dist/,纯静态可部署到任意托管

# 数据代理 Worker(可选;不部署则航班照片等功能降级)
cd worker
npx wrangler kv namespace create TRAILS   # 首次:创建 KV 并把 id 填入 wrangler.toml
npx wrangler deploy
```

自部署需要修改的常量:`src/hooks/useFlights.js` 和 `src/hooks/useTyphoons.js` 里的 `API` 地址指向你的 Worker 域名。

## 部署

- **前端**:push 到 master → GitHub Actions 自动构建并部署 Cloudflare Pages(`.github/workflows/deploy.yml`,需配置 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 两个 Secrets)
- **Worker**:改动 `worker/` 后手动 `wrangler deploy`(低频改动,未纳入 CI)

## 开发说明

- `scripts/screenshot.mjs`:puppeteer 可视化回归截图(页面含持续 WebGL 动画,截图前设置 `window.__animPaused=true`;macOS 上窗口必须真实可见,遮挡会挂起合成器导致 CDP 截图超时)
- 调试全局:`window.__map`(MapLibre 实例)、`window.__overlay`(deck.gl overlay)
- `vite.config.js` 中通过 alias 屏蔽了 satellite.js 的 wasm worker 动态导入(`#wasm-single-thread`/`#wasm-multi-thread` → `src/utils/satellite-wasm-stub.js`),强制使用纯 JS SGP4 实现,避免浏览器打包失败
- 腾讯/高德底图为 GCJ-02 坐标系,与 WGS-84 数据叠加在省级缩放(z≤8)偏差 <1px 可忽略;街道级精度请切 CARTO/Esri

## Roadmap

- [ ] 粒子风场动画(参考 windy.com)
- [ ] 卫星云图 / 雷达降水叠加层(向日葵8号、RainViewer)
- [ ] 中国地震台网(CENC)数据源
- [ ] PWA 离线缓存(断网可看最后数据 + 应急指南)
- [ ] 用户定位:距我最近的地震 / 台风到达我所在城市倒计时
- [ ] 历史台风库与相似路径检索
- [ ] 机场模式:点击机场看进出港航班列表
- [ ] 卫星模式:ISS/Starlink 实时过境预报、地面观察者视角

## License

MIT

## 致谢

数据服务:USGS · istrongcloud · adsb.lol · airplanes.live · adsbdb · planespotters.net · 腾讯地图 · CARTO · Esri —— 感谢这些免费开放的数据与服务让本项目成为可能。
