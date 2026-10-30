# perpscale-core

The calculation core behind [PerpScale](https://perpscale.com) — free lot size and fee calculators for Delta Exchange India perpetual futures. Exact decimal maths (decimal.js), no network, no UI.

> PerpScale is an independent set of free calculators for Delta Exchange India perpetual futures. Not affiliated with Delta Exchange.

## What it does

- **Lot size from risk** — how many lots to open so a stop-out costs at most your ₹ risk, with maker/taker fees and GST counted (`computeSizing`).
- **Fees in rupees** — entry and exit fees, GST, breakeven and net P&L for a size you choose, by lots or by ₹ margin × leverage (`computeFees`).
- **Contract rules** — lot size, tick, fee tier, leverage cap and limits for every live Delta India perpetual, snapshotted from Delta's public API (`rules/delta-india-contracts.json`, schemaVersion 2, sorted by symbol). Reference prices and 24h turnover, refreshed weekly, are in `rules/delta-india-market.json`; schemaVersion 1 of the contracts file had them inline as `refPrice` and `turnover24hUsd`.

## Formulas

```
budgetUSD      = riskINR / 85                          (Delta India's fixed ₹/$ rate)
perLotPrice    = |entry − stop| × lotSize
perLotFees     = (entry × entryRate + stop × exitRate) × lotSize
perLotGST      = perLotFees × 0.18
perLotLoss     = perLotPrice + perLotFees + perLotGST
lots           = floor(budgetUSD / perLotLoss)

fee per leg    = lots × lotSize × price × rate         (rate = maker or taker)
GST            = (entry fee + exit fee) × 0.18
breakeven long = entry × (1 + rE·1.18) / (1 − rX·1.18)
```

Rates, GST and the ₹/$ rate are read from `rules/`, never hard-coded in the engine.

## Worked examples

**Tight stop.** BTCUSD long, ₹2,000 risk, entry 100,000, stop 99,950, taker both ways. One lot (0.001 BTC) loses $0.050 on price and $0.118 on fees + GST.

| Method | Lots | Loss at stop |
|---|---:|---:|
| Price only (fees ignored) | 470 | ₹6,710.42 (3.36× the budget) |
| Fees + GST counted | 140 | ₹1,998.85 |

**Round-trip fees.** 1,000 BTCUSD lots, 100,000 → 101,000, taker both ways: entry fee $50.00, exit fee $50.50, GST $18.09, total $118.59 (₹10,080.15). Net P&L $881.41.

## Checked against Delta's own calculator

24 cases on BTCUSD, ETHUSD and SOLUSD, plus 5 more contracts across all three fee tiers (PAXGUSD, DOGEUSD, XRPUSD, NVDAXUSD, SLVONUSD), all within $0.01 of [delta.exchange/fees](https://www.delta.exchange/fees). Delta's calculator truncates to cents; this library rounds. Full comparison: [perpscale.com/methodology](https://perpscale.com/methodology).

## Usage

```ts
import { computeSizing } from "./src/sizing"
import btc from "./rules/delta-india-btcusd.json"

const out = computeSizing(
  { side: "long", capitalInr: "100000", riskMode: "inr", riskValue: "2000",
    entry: "100000", entryFee: "taker", stop: "99950", stopFee: "taker", leverage: "10" },
  toRule(btc) // flatten the rules file into a ContractRule (see example.ts)
)
if (out.status === "ok") console.log(out.result.lots) // 140
```

See `example.ts` for a runnable version.

## Not included

Funding, slippage, settlement fees, promotional discounts, cross/portfolio margin and Delta's exact liquidation price.

## About PerpScale

> PerpScale is an independent set of free calculators for Delta Exchange India perpetual futures. Not affiliated with Delta Exchange.

PerpScale is built and run by one independent developer — not a company. It carries no referral links. The code in `src/` is copied unchanged from the site, so these are the same calculations that run on [perpscale.com](https://perpscale.com).

How the numbers are checked:

- **Against Delta's own calculator** — the 29 cases above, none off by more than $0.01.
- **Contract specs, daily** — the site compares every live perpetual with Delta India's public API every day and logs each listing, delisting and spec change on [perpscale.com/delta-exchange-changes](https://perpscale.com/delta-exchange-changes). The `rules/` files here are a snapshot taken when this repo was last updated.
- **Fee rules, by hand** — GST, the ₹/$ rate and the fee rules are checked against Delta's fee page and help centre; every source is listed on [perpscale.com/methodology](https://perpscale.com/methodology).

Use it in the browser: [lot size calculator](https://perpscale.com/delta-exchange-lot-size-calculator) · [fee calculator](https://perpscale.com/delta-exchange-fee-calculator) · [methodology](https://perpscale.com/methodology).

## License

MIT. Education only — not investment or tax advice. Delta Exchange's own figures prevail.
