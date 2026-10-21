// Calculation core (PRD §7). Pure functions, decimal.js only; rounding happens in format.ts at display time.
import Decimal from "decimal.js"
import type { ContractRule } from "./contracts"

export type Side = "long" | "short"
export type FeeType = "maker" | "taker"
export type RiskMode = "pct" | "inr"

/** Raw form values; empty string means "not entered". */
export type SizingInput = {
  side: Side
  capitalInr: string
  riskMode: RiskMode
  riskValue: string
  entry: string
  entryFee: FeeType
  stop: string
  stopFee: FeeType
  leverage: string
  takeProfit?: string
  takeProfitFee?: FeeType
}

export type Field = "capitalInr" | "riskValue" | "entry" | "stop" | "leverage" | "takeProfit"

export type FieldErrorCode =
  | "REQUIRED"
  | "NOT_A_NUMBER"
  | "NOT_POSITIVE"
  | "TOO_PRECISE"
  | "OUT_OF_RANGE"
  | "BUDGET_ABOVE_CAPITAL"
  | "PCT_OUT_OF_RANGE"
  | "STOP_EQUALS_ENTRY"
  | "STOP_WRONG_SIDE"
  | "TP_WRONG_SIDE"
  | "LEVERAGE_OUT_OF_RANGE"

export type LeverageWarning = "red" | "yellow" | null

export type SizingResult = {
  lots: number
  quantity: Decimal // lots × contract value, in coin
  budgetInr: Decimal
  budgetUsd: Decimal
  perLotLossUsd: Decimal
  loss: {
    priceUsd: Decimal
    entryFeeUsd: Decimal
    exitFeeUsd: Decimal
    gstUsd: Decimal
    totalUsd: Decimal
    totalInr: Decimal
  }
  lossPctOfBudget: Decimal
  notionalUsd: Decimal
  marginUsd: Decimal
  marginExceedsCapital: boolean
  breakevenPrice: Decimal
  breakevenPoints: Decimal
  takeProfit: { netUsd: Decimal; netInr: Decimal; rMultiple: Decimal } | null
  naive: { lots: number; lossUsd: Decimal; lossInr: Decimal; multipleOfBudget: Decimal } | null // only when lots differ
  leverageWarning: LeverageWarning
}

export type SizingOutcome =
  | { status: "empty" }
  | { status: "invalid"; errors: Partial<Record<Field, FieldErrorCode>> }
  | { status: "refused"; code: "BUDGET_BELOW_ONE_LOT"; oneLotLossUsd: Decimal; oneLotLossInr: Decimal }
  | { status: "refused"; code: "NOTIONAL_ABOVE_LIMIT"; limitUsd: Decimal; maxLots: number }
  | { status: "refused"; code: "POSITION_SIZE_ABOVE_LIMIT"; limitContracts: number; lots: number }
  | { status: "refused"; code: "SIZE_ABOVE_SAFE_INTEGER" }
  | { status: "ok"; result: SizingResult; tickWarnings: Field[] }

const ONE = new Decimal(1)
const MAX_SAFE_LOTS = new Decimal(Number.MAX_SAFE_INTEGER)
/** Inputs are display values, not arbitrary-precision data: cap magnitude and decimal places. */
const MAX_INPUT_ABS = new Decimal("1000000000000000")
const MAX_INPUT_DECIMALS = 12

export function parseInput(value: string | undefined): Decimal | null | "nan" | "too-precise" | "out-of-range" {
  const v = (value ?? "").trim()
  if (v === "") return null
  if (!/^\d*\.?\d+$|^\d+\.$/.test(v)) return "nan"
  const d = new Decimal(v)
  if (!d.isFinite() || d.abs().gt(MAX_INPUT_ABS)) return "out-of-range"
  if (d.decimalPlaces() > MAX_INPUT_DECIMALS) return "too-precise"
  return d
}

export function feeRate(rule: ContractRule, type: FeeType): Decimal {
  return new Decimal(type === "maker" ? rule.makerRate : rule.takerRate)
}

function isOnTick(price: Decimal, rule: ContractRule): boolean {
  return price.mod(new Decimal(rule.tickSizeUsd)).isZero()
}

/** Loss per lot if the stop fills: price loss + entry fee + exit fee + GST on both fees (PRD §7.3). */
export function perLotLoss(rule: ContractRule, entry: Decimal, stop: Decimal, entryFee: FeeType, stopFee: FeeType) {
  const c = new Decimal(rule.contractValue)
  const g = new Decimal(rule.gstRate)
  const priceUsd = entry.minus(stop).abs().times(c)
  const entryFeeUsd = entry.times(feeRate(rule, entryFee)).times(c)
  const exitFeeUsd = stop.times(feeRate(rule, stopFee)).times(c)
  const gstUsd = entryFeeUsd.plus(exitFeeUsd).times(g)
  return {
    priceUsd,
    entryFeeUsd,
    exitFeeUsd,
    gstUsd,
    totalUsd: priceUsd.plus(entryFeeUsd).plus(exitFeeUsd).plus(gstUsd),
  }
}

/** Breakeven price with both legs' fees + GST; the exit is assumed taker (PRD §7.5). */
export function breakevenPrice(rule: ContractRule, side: Side, entry: Decimal, entryFee: FeeType): Decimal {
  const k = ONE.plus(rule.gstRate)
  const rE = feeRate(rule, entryFee).times(k)
  const rX = feeRate(rule, "taker").times(k)
  return side === "long" ? entry.times(ONE.plus(rE)).div(ONE.minus(rX)) : entry.times(ONE.minus(rE)).div(ONE.plus(rX))
}

/**
 * Rough leverage warning (PRD §7.6, tightened per O3): isolated liquidation is approximated at an adverse move of
 * 1/L − maintenance margin − isolated liquidation fee. Not a liquidation price.
 */
export function leverageWarning(rule: ContractRule, entry: Decimal, stop: Decimal, leverage: Decimal): LeverageWarning {
  const stopDist = entry.minus(stop).abs().div(entry)
  const liqApprox = ONE.div(leverage)
    .minus(new Decimal(rule.maintenanceMarginMinPct).div(100))
    .minus(rule.isolatedLiquidationFeeRate)
  if (stopDist.gte(liqApprox)) return "red"
  if (stopDist.gte(liqApprox.times("0.8"))) return "yellow"
  return null
}

export function computeSizing(input: SizingInput, rule: ContractRule): SizingOutcome {
  const fields: Record<Field, string | undefined> = {
    capitalInr: input.capitalInr,
    riskValue: input.riskValue,
    entry: input.entry,
    stop: input.stop,
    leverage: input.leverage,
    takeProfit: input.takeProfit,
  }
  const required: Field[] = ["capitalInr", "riskValue", "entry", "stop", "leverage"]
  const values: Partial<Record<Field, Decimal>> = {}
  const errors: Partial<Record<Field, FieldErrorCode>> = {}
  let anyRequiredMissing = false
  let anyEntered = false

  for (const f of Object.keys(fields) as Field[]) {
    const p = parseInput(fields[f])
    if (p === null) {
      if (required.includes(f)) anyRequiredMissing = true
      continue
    }
    anyEntered = true
    if (p === "nan") errors[f] = "NOT_A_NUMBER"
    else if (p === "too-precise") errors[f] = "TOO_PRECISE"
    else if (p === "out-of-range") errors[f] = "OUT_OF_RANGE"
    else if (p.lte(0)) errors[f] = "NOT_POSITIVE"
    else values[f] = p
  }
  if (!anyEntered) return { status: "empty" }

  const { capitalInr, riskValue, entry, stop, leverage, takeProfit } = values
  if (riskValue && input.riskMode === "pct" && riskValue.gt(100)) errors.riskValue = "PCT_OUT_OF_RANGE"
  if (riskValue && capitalInr && input.riskMode === "inr" && riskValue.gt(capitalInr))
    errors.riskValue = "BUDGET_ABOVE_CAPITAL"
  if (entry && stop) {
    if (stop.eq(entry)) errors.stop = "STOP_EQUALS_ENTRY"
    else if (input.side === "long" ? stop.gt(entry) : stop.lt(entry)) errors.stop = "STOP_WRONG_SIDE"
  }
  if (entry && takeProfit && (input.side === "long" ? takeProfit.lte(entry) : takeProfit.gte(entry))) {
    errors.takeProfit = "TP_WRONG_SIDE"
  }
  if (leverage && (leverage.lt(1) || leverage.gt(rule.maxLeverage))) errors.leverage = "LEVERAGE_OUT_OF_RANGE"

  if (Object.keys(errors).length > 0) return { status: "invalid", errors }
  if (anyRequiredMissing || !capitalInr || !riskValue || !entry || !stop || !leverage) {
    const missing: Partial<Record<Field, FieldErrorCode>> = {}
    for (const f of required) if (!values[f]) missing[f] = "REQUIRED"
    return { status: "invalid", errors: missing }
  }

  const fx = new Decimal(rule.inrPerUsd)
  const c = new Decimal(rule.contractValue)
  const budgetInr = input.riskMode === "inr" ? riskValue : capitalInr.times(riskValue).div(100)
  const budgetUsd = budgetInr.div(fx)

  const unit = perLotLoss(rule, entry, stop, input.entryFee, input.stopFee)
  const lotsDecimal = budgetUsd.div(unit.totalUsd).floor()
  if (!lotsDecimal.isFinite() || lotsDecimal.gt(MAX_SAFE_LOTS)) {
    return { status: "refused", code: "SIZE_ABOVE_SAFE_INTEGER" }
  }

  let lots = lotsDecimal.toNumber()
  if (!Number.isSafeInteger(lots)) return { status: "refused", code: "SIZE_ABOVE_SAFE_INTEGER" }
  let totalUsd = unit.totalUsd.times(lots)
  // Decimal division has finite precision. If the quotient rounded up to an integer, floor() can yield a size whose
  // loss is a hair above the original budget; step down once so the returned loss never exceeds it.
  if (totalUsd.gt(budgetUsd)) {
    lots -= 1
    totalUsd = unit.totalUsd.times(lots)
  }
  if (lots < 1) {
    return {
      status: "refused",
      code: "BUDGET_BELOW_ONE_LOT",
      oneLotLossUsd: unit.totalUsd,
      oneLotLossInr: unit.totalUsd.times(fx),
    }
  }

  const limitContracts = rule.positionSizeLimitContracts
  if (lots > limitContracts) {
    return {
      status: "refused",
      code: "POSITION_SIZE_ABOVE_LIMIT",
      limitContracts,
      lots,
    }
  }

  const notionalUsd = c.times(lots).times(entry)
  const limitUsd = new Decimal(rule.flatMarginNotionalLimitUsd)
  if (notionalUsd.gt(limitUsd)) {
    return {
      status: "refused",
      code: "NOTIONAL_ABOVE_LIMIT",
      limitUsd,
      maxLots: limitUsd.div(c.times(entry)).floor().toNumber(),
    }
  }

  const marginUsd = notionalUsd.div(leverage)
  const be = breakevenPrice(rule, input.side, entry, input.entryFee)

  let tp: SizingResult["takeProfit"] = null
  if (takeProfit) {
    const k = ONE.plus(rule.gstRate)
    const fees = entry
      .times(feeRate(rule, input.entryFee))
      .plus(takeProfit.times(feeRate(rule, input.takeProfitFee ?? "maker")))
      .times(c)
      .times(lots)
      .times(k)
    const netUsd = takeProfit.minus(entry).abs().times(c).times(lots).minus(fees)
    tp = { netUsd, netInr: netUsd.times(fx), rMultiple: netUsd.div(totalUsd) }
  }

  const naiveDecimal = budgetUsd.div(entry.minus(stop).abs().times(c)).floor()
  const naiveLots = naiveDecimal.isFinite() && naiveDecimal.lte(MAX_SAFE_LOTS) ? naiveDecimal.toNumber() : null
  const naiveLoss = naiveLots === null ? null : unit.totalUsd.times(naiveLots)
  const naive =
    naiveLots !== null && naiveLoss && naiveLots !== lots
      ? {
          lots: naiveLots,
          lossUsd: naiveLoss,
          lossInr: naiveLoss.times(fx),
          multipleOfBudget: naiveLoss.div(budgetUsd),
        }
      : null

  const tickWarnings: Field[] = []
  if (!isOnTick(entry, rule)) tickWarnings.push("entry")
  if (!isOnTick(stop, rule)) tickWarnings.push("stop")
  if (takeProfit && !isOnTick(takeProfit, rule)) tickWarnings.push("takeProfit")

  return {
    status: "ok",
    tickWarnings,
    result: {
      lots,
      quantity: c.times(lots),
      budgetInr,
      budgetUsd,
      perLotLossUsd: unit.totalUsd,
      loss: {
        priceUsd: unit.priceUsd.times(lots),
        entryFeeUsd: unit.entryFeeUsd.times(lots),
        exitFeeUsd: unit.exitFeeUsd.times(lots),
        gstUsd: unit.gstUsd.times(lots),
        totalUsd,
        totalInr: totalUsd.times(fx),
      },
      lossPctOfBudget: totalUsd.div(budgetUsd).times(100),
      notionalUsd,
      marginUsd,
      marginExceedsCapital: marginUsd.times(fx).gt(capitalInr),
      breakevenPrice: be,
      breakevenPoints: be.minus(entry).abs(),
      takeProfit: tp,
      naive,
      leverageWarning: leverageWarning(rule, entry, stop, leverage),
    },
  }
}

/**
 * What Delta's official fee calculator shows for the same inputs (long-only, entry+exit notional, Scalper Offer
 * waives the closing fee). Used by the benchmark tests and the methodology comparison table.
 */
export function officialFeeView(
  rule: ContractRule,
  entry: Decimal,
  entryFee: FeeType,
  exit: Decimal,
  exitFee: FeeType,
  lots: number,
  scalper: boolean
) {
  const c = new Decimal(rule.contractValue)
  const k = ONE.plus(rule.gstRate)
  const qty = c.times(lots)
  const entryFeeUsd = entry.times(qty).times(feeRate(rule, entryFee))
  const exitFeeUsd = exit.times(qty).times(feeRate(rule, exitFee))
  const bothFees = entryFeeUsd.plus(exitFeeUsd)
  const charged = scalper ? entryFeeUsd : bothFees
  return {
    notionalUsd: entry.plus(exit).times(qty),
    feesUsd: bothFees,
    feesWithGstUsd: bothFees.times(k),
    scalperFeesUsd: entryFeeUsd,
    scalperFeesWithGstUsd: entryFeeUsd.times(k),
    breakevenPoints: charged.times(k).div(qty),
    netPnlUsd: exit.minus(entry).times(qty).minus(charged.times(k)),
  }
}
