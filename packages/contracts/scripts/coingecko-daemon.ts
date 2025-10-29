import axios from 'axios'
import * as dotenv from 'dotenv'

dotenv.config()

async function lazyHardhat() {
  // Lazy import hardhat only when we actually need to push on-chain
  const hh = await import('hardhat')
  return hh
}

function getChain(): string {
  // Prefer explicit CHAIN env (e.g., "base-sepolia" or "base").
  const fromEnv = (process.env.CHAIN || '').trim()
  if (fromEnv) return fromEnv
  // Fallback default when not pushing on-chain
  return 'base-sepolia'
}

async function fetchBTCD(): Promise<number> {
  // Preferred: compute from top-250 markets
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1'
  const headers: Record<string, string> = { 'User-Agent': 'BTCD-Daemon/1.1' }
  const apiKey = (process.env.CG_API_KEY || '').trim()
  if (apiKey) headers['x-cg-pro-api-key'] = apiKey
  try {
    const resp = await axios.get(url, { headers, timeout: 15000 })
    const arr = Array.isArray(resp.data) ? resp.data : []
    if (!arr.length) throw new Error('Empty markets array')
    const excludeStables = String(process.env.EXCLUDE_STABLES || '').toLowerCase() === 'true'
    const extraExcludes = new Set(
      (process.env.EXCLUDE_IDS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
    const knownStables = new Set<string>([
      'tether','usd-coin','binance-usd','dai','frax','true-usd','usdd','pax-dollar',
      'first-digital-usd','gemini-dollar','liquity-usd','ethena-usde','usdx','usdk','usdn','usdy'
    ])
    function isProbablyStable(it: any): boolean {
      const id = String(it?.id || '').toLowerCase()
      if (extraExcludes.has(id)) return true
      if (knownStables.has(id)) return true
      if (!excludeStables) return false
      const sym = String(it?.symbol || '').toUpperCase()
      const price = Number(it?.current_price)
      if (Number.isFinite(price) && price > 0) {
        if (sym.includes('USD') && price > 0.94 && price < 1.06) return true
      }
      return false
    }
    let total = 0
    let btc = 0
    for (const it of arr) {
      const mc = Number(it?.market_cap)
      if (!Number.isFinite(mc) || mc <= 0) continue
      const id = String(it?.id || '')
      if (id === 'bitcoin') btc = mc
      if (!excludeStables || id === 'bitcoin' || !isProbablyStable(it)) total += mc
    }
    if (btc <= 0 || total <= 0) throw new Error('Invalid caps for dominance')
    const pct = (btc / total) * 100
    if (String(process.env.DEBUG_ORACLE || '').toLowerCase() === 'true') {
      console.log(`DEBUG daemon computed pct=${pct}`)
    }
    return pct
  } catch (e) {
    // Fallback to /global
    const headers2: Record<string, string> = { 'User-Agent': 'BTCD-Daemon/1.1' }
    const apiKey2 = (process.env.CG_API_KEY || '').trim()
    if (apiKey2) headers2['x-cg-pro-api-key'] = apiKey2
    const resp = await axios.get('https://api.coingecko.com/api/v3/global', { headers: headers2, timeout: 10000 })
    const pct = resp.data?.data?.market_cap_percentage?.btc
    if (typeof pct !== 'number') throw new Error('Invalid response from CoinGecko /global')
    if (String(process.env.DEBUG_ORACLE || '').toLowerCase() === 'true') {
      console.log(`DEBUG daemon fallback /global pct=${pct}`)
    }
    return pct
  }
}

async function runOnce(oracleAddr: string | undefined, requireOnchain: boolean, last?: { v: number }): Promise<number> {
  const pct = await fetchBTCD()
  const minChange = Number(process.env.MIN_CHANGE || '0') // in percentage points, e.g. 0.01 = 1bp
  const nowSec = Math.floor(Date.now()/1000)
  // If ORACLE is missing and on-chain is required, error out early
  if (!oracleAddr && requireOnchain) {
    throw new Error('REQUIRE_ONCHAIN=true and ORACLE not set; refusing to write DB-only ticks')
  }
  // If no oracle and DB-only allowed, we only POST to DB and return
  if (!oracleAddr) {
    try {
      const ingestUrl = process.env.INGEST_URL
      const ingestSecret = process.env.INGEST_SECRET
      if (ingestUrl && ingestSecret) {
        const chain = getChain()
        const market = (process.env.MARKET || 'btcd').toLowerCase()
        await axios.post(ingestUrl, { secret: ingestSecret, chain, market, time: nowSec, value: pct }, { timeout: 8000 })
        console.log(new Date().toISOString(), '[DB-ONLY]', market, pct.toFixed(6), '% posted')
      } else {
        console.log(new Date().toISOString(), '[DB-ONLY]', 'No INGEST configured; skipping')
      }
    } catch (e: any) {
      console.warn('ingest sync failed (db-only)', e?.message || e)
    }
    return pct
  }
  if (last && Math.abs(pct - last.v) < minChange) {
    console.log(new Date().toISOString(), 'no significant change', pct.toFixed(6), '% (minChange', minChange, ')')
    return last.v
  }
  const { ethers } = await lazyHardhat()
  const priceScaled = ethers.parseUnits(pct.toFixed(8), 8)
  const { ethers: _ethers, network } = await lazyHardhat()
  const oracle = await _ethers.getContractAt('BTCDOracle', oracleAddr)
  const tx = await oracle.pushPrice(priceScaled)
  console.log(new Date().toISOString(), 'BTC.D', pct.toFixed(6), '% tx=', tx.hash)
  await tx.wait()
  // Only after a successful on-chain push, sync to DB for charting
  try {
    const ingestUrl = process.env.INGEST_URL
    const ingestSecret = process.env.INGEST_SECRET
    if (ingestUrl && ingestSecret) {
      const chain = getChain()
      const market = (process.env.MARKET || 'btcd').toLowerCase()
      await axios.post(ingestUrl, { secret: ingestSecret, chain, market, time: nowSec, value: pct }, { timeout: 8000 })
    }
  } catch (e: any) {
    console.warn('ingest sync failed (post-onchain)', e?.message || e)
  }
  return pct
}

async function main() {
  const oracleAddr = (process.env.ORACLE || '').trim() || undefined
  const intervalSec = Number(process.env.CG_INTERVAL_SEC || '300')
  const requireOnchain = String(process.env.REQUIRE_ONCHAIN || 'true').toLowerCase() === 'true'
  if (!oracleAddr) {
    if (requireOnchain) {
      console.error('ORACLE not set and REQUIRE_ONCHAIN=true → exiting to avoid DB-only writes.')
      process.exit(1)
    } else {
      console.warn('ORACLE not set: running in DB-only mode (no on-chain pushes). Set ORACLE or REQUIRE_ONCHAIN=true to enforce on-chain-only.')
    }
  }
  // eslint-disable-next-line no-constant-condition
  let last: { v: number } | undefined = undefined
  while (true) {
    try {
      const v = await runOnce(oracleAddr, requireOnchain, last)
      last = { v }
    } catch (e: any) {
      const status = e?.response?.status
      let backoff: number
      if (status === 429) {
        const ra = parseInt((e?.response?.headers?.['retry-after'] ?? e?.response?.headers?.['Retry-After']) as string)
        const hinted = Number.isFinite(ra) ? ra : intervalSec * 2
        backoff = Math.max(20, Math.min(hinted, 600))
      } else {
        backoff = Math.max(5, Math.floor(intervalSec/2))
      }
      console.error('tick error', e?.message || e)
      await new Promise(r => setTimeout(r, backoff*1000))
      continue
    }
    // jitter 80% - 140%
    const jitter = Math.floor(intervalSec * (0.8 + Math.random()*0.6))
    await new Promise(r => setTimeout(r, jitter*1000))
  }
}

main().catch((e)=>{ console.error(e); process.exit(1) })
