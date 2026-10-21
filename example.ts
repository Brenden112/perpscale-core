// Runnable example: `npx tsx example.ts` after `npm i decimal.js`.
import fs from "node:fs"
import type { ContractRule } from "./src/contracts"
import { computeFees } from "./src/fees"
import { computeSizing } from "./src/sizing"

type RuleFile = {
  product: { symbol: string; productId: number; contractValue: string; contractUnit: string; tickSizeUsd: string; priceDecimals: number; quantityDecimals: number }
  fees: { makerRate: string; takerRate: string; gstRate: string }
  margin: { initialMarginMinPct: string; maintenanceMarginMinPct: string; maxLeverage: string; leverageSliderValues: number[]; flatMarginNotionalLimitUsd: string; flatMarginNotionalLimitBasis: string; isolatedLiquidationFeeRate: string }
  fx: { inrPerUsd: string }
  limits: { positionSizeLimitContracts: string }
  checkedAt: string
}

export function toRule(f: RuleFile): ContractRule {
  return {
    symbol: f.product.symbol,
    name: f.product.symbol,
    verified: true,
    refPrice: null,
    productId: f.product.productId,
    contractValue: f.product.contractValue,
    contractUnit: f.product.contractUnit,
    tickSizeUsd: f.product.tickSizeUsd,
    priceDecimals: f.product.priceDecimals,
    quantityDecimals: f.product.quantityDecimals,
    ...f.fees,
    inrPerUsd: f.fx.inrPerUsd,
    initialMarginMinPct: f.margin.initialMarginMinPct,
    maintenanceMarginMinPct: f.margin.maintenanceMarginMinPct,
    maxLeverage: Number(f.margin.maxLeverage),
    leverageSliderValues: f.margin.leverageSliderValues,
    flatMarginNotionalLimitUsd: f.margin.flatMarginNotionalLimitUsd,
    flatMarginNotionalLimitBasis: f.margin.flatMarginNotionalLimitBasis,
    positionSizeLimitContracts: Number(f.limits.positionSizeLimitContracts),
    isolatedLiquidationFeeRate: f.margin.isolatedLiquidationFeeRate,
    checkedAt: f.checkedAt,
  }
}

const btc = toRule(JSON.parse(fs.readFileSync("rules/delta-india-btcusd.json", "utf8")) as RuleFile)

const sizing = computeSizing(
  { side: "long", capitalInr: "100000", riskMode: "inr", riskValue: "2000", entry: "100000", entryFee: "taker", stop: "99950", stopFee: "taker", leverage: "10" },
  btc
)
if (sizing.status === "ok") console.log("lots:", sizing.result.lots, "loss ₹:", sizing.result.loss.totalInr.toFixed(2)) // 140, 1998.85

const fees = computeFees(
  { side: "long", sizeMode: "lots", lots: "1000", marginInr: "", leverage: "10", entry: "100000", entryFee: "taker", exit: "101000", exitFee: "taker" },
  btc
)
if (fees.status === "ok") console.log("fees + GST $:", fees.result.totalUsd.toFixed(2)) // 118.59
