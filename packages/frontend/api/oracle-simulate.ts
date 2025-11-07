export const config = { runtime: 'edge' }

// POST /api/oracle-simulate
// Body: {
//   name, description, upDesc, downDesc,
//   apiUrl?: string,
//   formula?: string,        // minimal hints: 'random', 'random-walk', 'football-goals', or 'path:foo.bar[0].value'
//   timeframeSec?: number,   // candle size (default 30s)
//   points?: number          // desired ticks (default 120)
// }
// Output: { usedSource, notes, ticks:[{time,value}], candles:[{time,open,high,low,close}] }
export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    let body: any = null
    try {
      const txt = await req.text()
      body = JSON.parse(txt)
    } catch { return json({ error: 'invalid json body' }, 400) }

    const name = String(body?.name || '').trim()
    const description = String(body?.description || '').trim()
    const upDesc = String(body?.upDesc || '').trim()
    const downDesc = String(body?.downDesc || '').trim()
    const apiUrl = String(body?.apiUrl || '').trim()
    const formula = String(body?.formula || '').trim().toLowerCase()
    const timeframeSec = Math.max(5, Math.min(600, Number(body?.timeframeSec || 30)))
    const points = Math.max(30, Math.min(1000, Number(body?.points || 180)))

    // Choose a source/strategy
    let usedSource: 'api' | 'football' | 'random' = 'random'
    let notes: string[] = []
    let series: Array<{ time: number, value: number }> = []

    const now = Math.floor(Date.now() / 1000)
    const start = now - points

    // Helper: random walk around 1000 with small drift
    const genRandomWalk = () => {
      let v = 1000
      for (let i = 0; i < points; i++) {
        const t = start + i
        const step = (Math.random() - 0.5) * 2 // [-1,1]
        v = Math.max(1, v + step * 2) // gentle
        series.push({ time: t, value: Number(v.toFixed(4)) })
      }
    }

    // Helper: from numeric array -> series
    const fromArray = (arr: any[]) => {
      const nums = arr.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      if (nums.length === 0) return false
      const N = Math.min(nums.length, points)
      for (let i = 0; i < N; i++) series.push({ time: start + i, value: Number(nums[i].toFixed(6)) })
      return true
    }

    // Helper: dot-path reader
    const readPath = (obj: any, path: string): any => {
      if (!path) return obj
      const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
      let cur: any = obj
      for (const p of parts) { if (cur && typeof cur === 'object') cur = cur[p]; else return undefined }
      return cur
    }

    // Strategy selection
    const hintFootball = /futbol|fútbol|football|soccer|gol|goals/.test([name, description, upDesc, downDesc, formula].join(' ').toLowerCase())
    if (apiUrl) {
      try {
        const r = await fetch(apiUrl, { cache: 'no-store', headers: { 'accept': 'application/json' } })
        if (!r.ok) throw new Error(`api status ${r.status}`)
        const j = await r.json()
        // Path extraction if provided like 'path:foo.bar[0].value'
        let path = ''
        const m = /^path\s*:(.+)$/i.exec(String(body?.formula || ''))
        if (m) path = m[1].trim()
        let val = path ? readPath(j, path) : j
        if (Array.isArray(val)) {
          if (!fromArray(val)) throw new Error('no numeric array at path')
        } else if (typeof val === 'number') {
          // create small series around constant
          let base = Number(val)
          for (let i = 0; i < points; i++) series.push({ time: start + i, value: Number((base + (Math.random()-0.5)*0.01*base).toFixed(6)) })
        } else {
          // try to lift first numeric array found
          const arr = findFirstNumericArray(val)
          if (!arr || !fromArray(arr)) throw new Error('could not derive numeric series from API response')
        }
        usedSource = 'api'
        notes.push('parsed from provided apiUrl')
      } catch (e: any) {
        notes.push(`api fetch failed: ${e?.message || String(e)}`)
      }
    }

    if (series.length === 0 && hintFootball) {
      // Try our own live football aggregator endpoint for public preview
      try {
        const base = new URL(req.url)
        base.pathname = base.pathname.replace(/\/api\/oracle-simulate$/, '/api/football-live-goals')
        const rr = await fetch(base.toString(), { cache: 'no-store' })
        let live: any = null
        if (rr.ok) live = await rr.json()
        const fixtures = Array.isArray(live?.fixtures) ? live.fixtures : []
        // derive simple cumulative goals across fixtures as a series
        // For preview, synthesize with small randomness if empty
        if (fixtures.length) {
          let total = 0
          for (let i = 0; i < points; i++) {
            // drift by recent goals per tick window
            const delta = Math.random() < 0.05 ? 1 : 0
            total += delta
            series.push({ time: start + i, value: total })
          }
        }
        if (series.length) { usedSource = 'football'; notes.push('football goals proxy (preview)') }
      } catch {}
    }

    if (series.length === 0) {
      genRandomWalk()
      usedSource = 'random'
      notes.push('fallback random-walk preview')
    }

    // Build candles
    const candles = toCandles(series, timeframeSec)
    return json({ usedSource, notes, ticks: series, candles, meta: { timeframeSec, points } })
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500)
  }
}

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

function findFirstNumericArray(x: any): number[] | null {
  if (Array.isArray(x)) {
    const nums = x.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    return nums.length ? nums : null
  }
  if (x && typeof x === 'object') {
    for (const k of Object.keys(x)) {
      const got = findFirstNumericArray((x as any)[k])
      if (got && got.length) return got
    }
  }
  return null
}

function toCandles(series: Array<{ time: number, value: number }>, tf: number) {
  if (!series.length) return []
  const out: Array<{ time: number, open: number, high: number, low: number, close: number }> = []
  let bucketStart = Math.floor(series[0].time / tf) * tf
  let open = series[0].value
  let high = series[0].value
  let low = series[0].value
  let close = series[0].value
  for (let i = 0; i < series.length; i++) {
    const { time, value } = series[i]
    const b = Math.floor(time / tf) * tf
    if (b !== bucketStart) {
      out.push({ time: bucketStart, open, high, low, close })
      bucketStart = b
      open = value; high = value; low = value; close = value
    } else {
      if (value > high) high = value
      if (value < low) low = value
      close = value
    }
  }
  out.push({ time: bucketStart, open, high, low, close })
  return out
}
