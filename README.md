# GeoPulse 🌐

**台风 · 地震实时追踪可视化平台** — 对标并超越 [chinaupdated.com](https://chinaupdated.com/) 的开源灾害追踪站。

![tech](https://img.shields.io/badge/React%2018-MapLibre%20GL-blue) ![deck.gl](https://img.shields.io/badge/deck.gl-9.x-purple)

## 功能

### 🌀 台风追踪
- 交互式深色地图,观测路径按**强度等级着色**(热带低压 → 超强台风六级色标)
- **非对称风圈**可视化(7/10/12 级风圈四象限多边形)
- **多机构预报对比**:中央气象台 / 日本气象厅 / 美国 JTWC 虚线路径,可逐家开关
- **路径回放动画**:时间轴拖动 + 播放(1x/2x/4x),点击轨迹点跳转
- **城市波及倒计时**:基于预报路径自动计算沿海重点城市的最近距离与预计影响时间
- 中心风速 / 气压 / 风力等级 / 移速指标卡 + 应急指南
- 实时数据源不可达时自动降级为演示数据(界面明确标注)

### 🌍 地震监测
- **USGS 实时数据**(24h / 7 天 / 30 天),2 分钟自动刷新
- 震级气泡图(大小=震级)/ 按震级或**震源深度**双色彩模式
- **热力图模式**一键切换
- 24 小时内 M4.5+ 地震**脉冲扩散动画**
- 最小震级筛选、最新地震列表(点击定位)、海啸预警标记
- 统计卡:总数 / 最大震级 / M5+ 数量 / 最近一次

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5188
npm run build      # 产物在 dist/,纯静态可部署到任意托管
```

## 数据源

| 模块 | 来源 | 说明 |
|---|---|---|
| 地震 | [USGS GeoJSON Feed](https://earthquake.usgs.gov/earthquakes/feed/) | 免费、支持 CORS、全球实时 |
| 台风 | data.istrongcloud.com(浙江水利台风路径系统同源) | 无活跃台风或跨域受限时降级为演示数据 |

> 信息仅供参考,请以官方预警为准。

## 技术架构

- **React 18 + Vite** — 纯前端静态站,无需服务器
- **MapLibre GL** — 矢量底图(CARTO Dark Matter)
- **deck.gl 9** — 高性能 WebGL 图层:Scatterplot/Path/Polygon/Heatmap/Text
- 动画走独立 rAF 循环直接更新 overlay,不经过 React 渲染(静态图层同步应用,后台标签页不受 rAF 节流影响)

## 开发说明

- `scripts/screenshot.mjs`:puppeteer 截图脚本(页面含持续 WebGL 动画,截图前会设置 `window.__animPaused`;窗口必须真实可见,macOS 遮挡窗口会挂起合成器导致 CDP 截图超时)
- 调试全局:`window.__map`(maplibre 实例)、`window.__overlay`(deck overlay)

## Roadmap

- [ ] 粒子风场动画(参考 windy.com)
- [ ] 卫星云图 / 雷达降水叠加层(向日葵8号、RainViewer)
- [ ] 中国地震台网(CENC)数据源 + 台风 CMA 官方源(需轻量代理解决 CORS)
- [ ] PWA 离线缓存(对齐 chinaupdated 的"断网可用")
- [ ] 用户定位:距我最近的地震 / 台风到达我所在城市倒计时
- [ ] 历史台风库与相似路径检索
