# Token Radar — make.fun token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Aiyouwei-boy/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Aiyouwei-boy/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for pre-token protocols: it ranks the protocols in a sealed
DefiLlama snapshot by the implied value of a token they have not issued yet,
and gives each one a concrete farm plan.

## The model (radar-2)

Only the snapshot's own figures, the same function for every protocol:

```
implied = TVL × 0.20
        × (1 + clamp(change_7d, -60, 120)% × 1.5)
        × (0.70 + 0.45 × √(age_days ÷ 1460))
        × (1 + 0.04 × extra chains, max 5)
```

Age is days since the snapshot first tracked the protocol (unknown: 365).
A protocol is rankable only if it records no token (no market cap, no
CoinGecko id, no symbol) and is not an exchange, a bridge, or a wrapped /
staked product of a token that already trades — the watchlist's own test,
applied to every row. Protocols whose token already trades are shown apart,
at the market's own value, never ranked.

## The board

- 180 rows: the whole 40-protocol watchlist, plus the 140 strongest early
  protocols below the $50M floor, chosen by the model itself.
- 7 farm steps per protocol, each with a cost and a time, derived from the
  protocol's category, chains, TVL and age.
- Dashboard: sortable, filterable, searchable, with a detail view per
  protocol (value breakdown + farm plan) and a model playground that
  re-ranks the board live from the same figures.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. Deterministic: two runs write identical bytes.

## Files

- `main.ts` — entrypoint: snapshot in, board + dashboard data + dossier out
- `lib/model.ts` — the model, the farm plans, the board validation
- `dashboard/` — index.html, app.css, app.js (offline, no network)
- `screenshots/` — board, detail, filtered views of the real dashboard
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored)

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards</sub>
