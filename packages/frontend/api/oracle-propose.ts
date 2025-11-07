import { Redis } from '@upstash/redis'

export const config = { runtime: 'edge' }

// POST /api/oracle-propose
// Body: { name, description, upDesc, downDesc, apiUrl?, formula?, author?, address? }
// Effect: Stores a lightweight off-chain oracle spec and returns an id plus a quick simulation sample.
// Notes: This is an off-chain prototype (no smart contracts yet). It allows anyone to define a market question
//        and preview a synthetic candle series derived from the provided API or fallback heuristics.
// Response: { ok, id, spec, preview: { usedSource, ticks, candles, notes } }
export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
    const redis = Redis.fromEnv()
    let body: any = null
    try { const txt = await req.text(); body = JSON.parse(txt) } catch { return json({ error: 'invalid json body' }, 400) }
    const name = String(body?.name || '').trim()
    const description = String(body?.description || '').trim()
    const upDesc = String(body?.upDesc || '').trim()
    const downDesc = String(body?.downDesc || '').trim()
    const apiUrl = String(body?.apiUrl || '').trim()
    const formula = String(body?.formula || '').trim()
    const author = String(body?.author || '').trim()
    const address = String(body?.address || '').trim().toLowerCase()
    if (!name || !description || !upDesc || !downDesc) return json({ error: 'missing required fields' }, 400)

    // Build spec
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`
    const ts = Math.floor(Date.now()/1000)
    const spec = {
      id, ts,
      name, description, upDesc, downDesc,
      apiUrl: apiUrl || '',
      formula, author, address,
      version: 1,
      status: 'draft'
    }
    await redis.set(`btcd:oracle:spec:${id}`, JSON.stringify(spec))
    await redis.lpush('btcd:oracle:specs', id)
    // quick simulation via internal call to oracle-simulate to avoid duplicating logic
    let preview: any = null
    try {
      const base = new URL(req.url)
      base.pathname = base.pathname.replace(/\/oracle-propose$/, '/oracle-simulate')
      const simRes = await fetch(base.toString(), { method:'POST', body: JSON.stringify({ name, description, upDesc, downDesc, apiUrl, formula }) })
      if (simRes.ok) preview = await simRes.json()
    } catch (e:any) {
      preview = { error: e?.message || String(e) }
    }
    return json({ ok: true, id, spec, preview })
  } catch (e:any) {
    return json({ error: e?.message || String(e) }, 500)
  }
}

function json(body:any, status=200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json', 'cache-control':'no-store' } })
}
