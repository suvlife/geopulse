import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
const chrome = execSync('find ' + process.env.HOME + '/.agent-browser/browsers -name "Google Chrome for Testing" -path "*/MacOS/*" | head -1').toString().trim()
const b = await puppeteer.launch({ executablePath: chrome, headless: false, args: ['--window-position=100,100', '--window-size=1440,900'] })
const pg = await b.newPage()
await pg.setViewport({ width: 1440, height: 900 })
await pg.goto('https://geopulse.guofeng.me/', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 6000))
const tabs = await pg.$$('.tab')
if (tabs[4]) await tabs[4].click()
await new Promise(r => setTimeout(r, 8000))
// 直接读 React 里的 WebSocket 状态
const wsState = await pg.evaluate(() => {
  // 从 useShips 的 ref 拿(通过全局调试)
  return { effectRan: window.__shipEffectRan || 0, mode: document.querySelector('.panel-title .badge')?.textContent }
})
console.log('8s:', JSON.stringify(wsState))
await new Promise(r => setTimeout(r, 20000))
const final = await pg.evaluate(() => ({
  mode: document.querySelector('.panel-title .badge')?.textContent,
  ships: document.querySelectorAll('.quake-row').length,
  shipLayerData: window.__overlay?._props?.layers?.find(l => l.id === 'ships')?.props?.data?.length,
}))
console.log('final:', JSON.stringify(final))
await b.close()
