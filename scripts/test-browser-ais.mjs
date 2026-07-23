import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
const chrome = execSync('find ' + process.env.HOME + '/.agent-browser/browsers -name "Google Chrome for Testing" -path "*/MacOS/*" | head -1').toString().trim()
const b = await puppeteer.launch({ executablePath: chrome, headless: false, args: ['--window-position=100,100'] })
const pg = await b.newPage()
await pg.goto('https://geopulse.guofeng.me/', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 5000))
const result = await pg.evaluate(() => new Promise((resolve) => {
  const out = { count: 0, open: false, close: null, err: false, state: -1 }
  const ws = new WebSocket('wss://geopulse-api.guofeng.me/ais')
  out.ws = ws
  ws.onopen = function(){ out.open = true }
  ws.onmessage = function(){ out.count++ }
  ws.onerror = function(){ out.err = true }
  ws.onclose = function(c){ out.close = c.code; out.state = ws.readyState }
  setTimeout(() => resolve(out), 15000)
}))
console.log('浏览器连Worker:', JSON.stringify(result))
await b.close()
