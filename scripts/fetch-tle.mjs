// 构建/开发前抓取 TLE 与 SATCAT 快照到 public/data/
// CelesTrak 的 gp.php 对 Cloudflare 出口 IP 和浏览器高频 Origin 请求会 403/超时,
// 快照方案:本地/CI 构建时拉取一次,随静态站分发,用户零 CORS 零限流。
// TLE 时效:SGP4 推算在数天内仍准确,每 2h/每日快照足够可视化使用。
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
mkdirSync(outDir, { recursive: true })

const TARGETS = [
  {
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
    file: 'active.tle',
    maxAgeMs: 6 * 3600e3, // 6h 内不重复拉
  },
  {
    url: 'https://celestrak.org/pub/satcat.csv',
    file: 'satcat.csv',
    maxAgeMs: 24 * 3600e3, // 24h 内不重复拉
  },
]

for (const t of TARGETS) {
  const dest = join(outDir, t.file)
  if (existsSync(dest) && Date.now() - statSync(dest).mtimeMs < t.maxAgeMs) {
    console.log(`✓ ${t.file} 快照仍新鲜,跳过`)
    continue
  }
  try {
    const res = await fetch(t.url, {
      signal: AbortSignal.timeout(60000),
      // CelesTrak 屏蔽非浏览器 UA(403),必须伪装
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const text = await res.text()
    if (text.length < 10000) throw new Error(`content too small: ${text.length}`)
    writeFileSync(dest, text)
    console.log(`✓ ${t.file} 已更新 (${(text.length / 1024 / 1024).toFixed(1)}MB)`)
  } catch (e) {
    if (existsSync(dest)) {
      console.warn(`⚠ ${t.file} 拉取失败(${e.message}),使用已有快照`)
    } else {
      console.error(`✗ ${t.file} 拉取失败且无快照:${e.message}`)
      process.exitCode = 1
    }
  }
}
