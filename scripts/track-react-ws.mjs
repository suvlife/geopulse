import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
const chrome = execSync('find ' + process.env.HOME + '/.agent-browser/browsers -name "Google Chrome for Testing" -path "*/MacOS/*" | head -1').toString().trim()
const b = await puppeteer.launch({ executablePath: chrome, headless: false, args: ['--window-position=100,100', '--window-size=1440,900'] })
const pg = await b.newPage()
await pg.setViewport({ width: 1440, height: 900 })
const wsLog = []
pg.on('websocket', (ws) => { wsLog.push(ws.url()); console.log('WS created:', ws.url()) })
await pg.goto('https://geopulse.guofeng.me/', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 6000))
// 真实鼠标点击第 5 个 tab(船舶)
const tabs = await pg.$$('.tab')
if (tabs[4]) await tabs[4].click()
await new Promise(r => setTimeout(r, 25000))
const res = await pg.evaluate(() => ({
  mode: document.querySelector('.panel-title .badge')?.textContent,
  ships: document.querySelectorAll('.quake-row').length,
  effectRan: window.__shipEffectRan || 0,
}))
console.log('RESULT:', JSON.stringify(res), '| ws count:', wsLog.length)
await b.close()
