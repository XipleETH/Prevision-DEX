# BTCD Oracle Daemon on Railway

This sets up a 24/7 service that fetches BTC Dominance from CoinGecko (top-250 market caps with optional stable exclusion),
pushes to the on-chain BTCDOracle, and syncs every tick to your /api/ingest for the chart.

## 1) Prerequisites
- Deployed BTCDOracle address on Base or Base Sepolia
- An updater wallet (PRIVATE_KEY) authorized in the oracle
- Your RPC URL (BASE_SEPOLIA_RPC or BASE_RPC)
- Your ingest endpoint and secret (Vercel): INGEST_URL, INGEST_SECRET

## 2) Environment Variables (Railway → Variables)
- ORACLE: 0x... (BTCDOracle)
- PRIVATE_KEY: 0x... (authorized updater key)
- BASE_SEPOLIA_RPC: https://... (or BASE_RPC for mainnet Base)
- CG_INTERVAL_SEC: 15  # fetch cadence in seconds (respect CG rate limits)
- MIN_CHANGE: 0        # minimum change in % to push on-chain (0.01 recommended if you want fewer on-chain writes)
- EXCLUDE_STABLES: true
- EXCLUDE_IDS: tether,usd-coin  # optional CSV of IDs to exclude
- DEBUG_ORACLE: false           # true for verbose logging
- INGEST_URL: https://<your-app>.vercel.app/api/ingest
- INGEST_SECRET: <same as in Vercel>

## 3) Deploy on Railway
- Click "New Project" → Deploy from GitHub → select this repo
- Railway will build the Dockerfile and start the daemon
- Logs show lines like:
  - "BTC.D 60.123456 % tx=0x..." for on-chain pushes
  - "ingest sync failed ..." if DB sync fails (check vars)

## 4) Notes

### Separate signers to avoid nonce collisions

Run CoinGecko (BTCD) and Random daemons with different private keys:

- BTCD (CoinGecko) env:
  - PRIVATE_KEY = <key A>
  - ORACLE = <BTCD oracle addr>

- Random daemon env:
  - PRIVATE_KEY = <key A> (optional, fallback)
  - RANDOM_PRIVATE_KEY = <key B>
  - RANDOM_ORACLE = <Random oracle addr>

The random daemon prefers RANDOM_PRIVATE_KEY if provided. Ensure both signers have updater permissions on their respective oracles.
## 5) Local test
```
npm -w packages/contracts run daemon:cg
```

Ensure `.env` or environment variables provide ORACLE, PRIVATE_KEY and RPC.
