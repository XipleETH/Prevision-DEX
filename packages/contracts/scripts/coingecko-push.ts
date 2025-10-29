import axios from 'axios'
import * as dotenv from 'dotenv'
import { ethers } from 'hardhat'

dotenv.config()

async function fetchBTCD(): Promise<number> {
  const maxAttempts = 5
  let delay = 1000
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      // Preferred: compute using top-250 markets
      const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1'
      const resp = await axios.get(url, {
        headers: { 'User-Agent': 'BTCD-Oracle/1.0 (+github actions)' },
        timeout: 15000,
      })
  const arr = Array.isArray(resp.data) ? resp.data : []
      if (!arr.length) throw new Error('Empty markets array')
      let total = 0
      let btc = 0

      // Stable exclusion config
      const excludeStables = String(process.env.EXCLUDE_STABLES || '').toLowerCase() === 'true'
      const extraExcludes = new Set(
        (process.env.EXCLUDE_IDS || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
      const knownStables = new Set<string>([
        'tether', // USDT
        'usd-coin', // USDC
        'binance-usd', // BUSD (legacy)
        'dai',
        'frax',
        'true-usd', // TUSD
        'usdd',
        'pax-dollar', // USDP
        'first-digital-usd', // FDUSD
        'gemini-dollar', // GUSD
        'liquity-usd', // LUSD
        'ethena-usde', // USDe
        'usdx', 'usdk', 'usdn', 'usdy',
      ])

      function isProbablyStable(it: any): boolean {
        const id = String(it?.id || '').toLowerCase()
        if (extraExcludes.has(id)) return true
        if (knownStables.has(id)) return true
        if (!excludeStables) return false
        const sym = String(it?.symbol || '').toUpperCase()
        const price = Number(it?.current_price)
        if (Number.isFinite(price) && price > 0) {
          // Heuristic: symbols containing USD and price near $1
          if (sym.includes('USD') && price > 0.94 && price < 1.06) return true
        }
        return false
      }
      let excludedCount = 0
      let includedCount = 0
      for (const it of arr) {
        const mc = Number(it?.market_cap)
        if (Number.isFinite(mc) && mc > 0) {
          const id = String(it?.id || '')
          if (id === 'bitcoin') btc = mc
          // Include BTC and non-stable assets in denominator; optionally exclude stables
          if (!excludeStables || id === 'bitcoin' || !isProbablyStable(it)) {
            total += mc
            includedCount++
          } else {
            excludedCount++
          }
        }
      }
      if (total <= 0 || btc <= 0) throw new Error('Invalid market caps')
      const pct = (btc / total) * 100
      if (String(process.env.DEBUG_ORACLE || '').toLowerCase() === 'true') {
        console.log(`DEBUG markets: included=${includedCount} excluded=${excludedCount} btc=${btc} total=${total} pct=${pct}`)
      }
      return pct
    } catch (e: any) {
      const status = e?.response?.status
      const msg = e?.message || String(e)
      console.warn(`fetchBTCD markets attempt ${i} failed:`, status || '', msg)
      if (status === 429) delay = Math.min(delay * 2, 15000)
      if (i < maxAttempts) {
        await new Promise(r => setTimeout(r, delay))
        continue
      } else {
        // Final fallback: use /global endpoint
        try {
          const resp2 = await axios.get('https://api.coingecko.com/api/v3/global', {
            headers: { 'User-Agent': 'BTCD-Oracle/1.0 (+github actions)' },
            timeout: 10000,
          })
          const pct2 = resp2.data?.data?.market_cap_percentage?.btc
          if (typeof pct2 !== 'number') throw new Error('Invalid response from CoinGecko /global')
          if (String(process.env.DEBUG_ORACLE || '').toLowerCase() === 'true') {
            console.log(`DEBUG fallback /global used: pct=${pct2}`)
          }
          return pct2
        } catch (e2) {
          throw e
        }
      }
    }
  }
  throw new Error('unreachable')
}

async function main() {
  const oracleAddr = process.env.ORACLE
  if (!oracleAddr) throw new Error('Set ORACLE in .env')
  const pct = await fetchBTCD()
  const oracle = await ethers.getContractAt('BTCDOracle', oracleAddr)

  // Force push if oracle data is too old (staleness guard)
  const forceMaxAgeSec = Number(process.env.FORCE_MAX_AGE_SEC || '0')
  let isStale = false
  if (forceMaxAgeSec > 0) {
    try {
      const tsRaw: bigint = await (oracle as any).latestTimestamp()
      const last = Number(tsRaw)
      const now = Math.floor(Date.now() / 1000)
      if (last === 0 || (now - last) >= forceMaxAgeSec) {
        isStale = true
        console.log(`Oracle is stale by ${last === 0 ? 'unknown' : (now - last) + 's'} (threshold ${forceMaxAgeSec}s). Forcing push.`)
      }
    } catch (e) {
      console.warn('Could not read latestTimestamp to check staleness, proceeding without staleness guard. Reason:', (e as any)?.message || e)
    }
  }

  // Optional guard: only push if change >= MIN_CHANGE vs on-chain latest
  const minChange = Number(process.env.MIN_CHANGE || '0') // percentage points
  if (minChange > 0 && !isStale) {
    try {
      const onchainRaw: bigint = await (oracle as any).latestAnswer()
      const onchain = Number(ethers.formatUnits(onchainRaw, 8))
      const diff = Math.abs(pct - onchain)
      if (diff < minChange) {
        console.log(`No push: |Δ|=${diff.toFixed(6)}% < MIN_CHANGE=${minChange}%. Current=${onchain.toFixed(6)}% Fetched=${pct.toFixed(6)}%`)
        return
      }
    } catch (e) {
      console.warn('Could not read latestAnswer, proceeding with push. Reason:', (e as any)?.message || e)
    }
  }

  const priceScaled = ethers.parseUnits(pct.toFixed(8), 8)
  const tx = await oracle.pushPrice(priceScaled)
  console.log('Pushing BTC.D', pct.toFixed(6), '% tx=', tx.hash)
  await tx.wait()
  console.log('Done')
}

main().catch((e)=>{ console.error(e); process.exit(1) })
