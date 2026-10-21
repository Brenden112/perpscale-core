// Fee & brokerage calculator core (plan 1.1). Pure functions, decimal.js only, same input rules as sizing.ts.
import Decimal from "decimal.js"
import type { ContractRule } from "./contracts"
import { feeRate, type FeeType, parseInput, type Side } from "./sizing"

export type SizeMode = "lots" | "margin"

/** Raw form values; empty string means "not entered". */
export type FeeInput = {
  side: Side
  sizeMode: SizeMode
  lots: string
  marginInr: string
  leverage: string
  entry: string
  entryFee: FeeType
  exit: string
  exitFee: FeeType
}

export type FeeField = "lots" | "marginInr" | "leverage" | "entry" | "exit"

export type FeeFieldErrorCode =
  | "REQUIRED"
  | "NOT_A_NUMBER"
  | "NOT_POSITIVE"
  | "TOO_PRECISE"
  | "OUT_OF_RANGE"
  | "NOT_WHOLE_LOTS"
  | "LEVERAGE_OUT_OF_RANGE"

export type FeeResult = {
  lots: number
  quantity: Decimal
  notionalUsd: Decimal
  marginUsd: Decimal
  marginInr: Decimal
  /** true when the exit price was left empty and the closing fee is estimated at the entry price */
  exitAssumed: boolean
  exitPrice: Decimal
  entryFeeUsd: Decimal
  exitFeeUsd: Decimal
  gstUsd: Decimal
  totalUsd: Decimal
  totalInr: Decimal
  /** fees + GST as % of the margin posted */
  pctOfMargin: Decimal
  breakevenPrice: Decimal
  breakevenPoints: Decimal
  pnl: { grossUsd: Decimal; netUsd: Decimal; netInr: Decimal } | null
}

export type FeeOutcome =
  | { status: "empty" }
  | { status: "invalid"; errors: Partial<Record<FeeField, FeeFieldErrorCode>> }
  | { status: "refused"; code: "MARGIN_BELOW_ONE_LOT"; oneLotMarginInr: Decimal }
  | { status: "refused"; code: "POSITION_SIZE_ABOVE_LIMIT"; limitContracts: number; lots: number }
  | { status: "ok"; result: FeeResult }

const ONE = new Decimal(1)

/** Breakeven exit price with both legs' fees + GST (PRD §7.5, with the exit fee type chosen by the user). */
export function breakevenFor(rule: ContractRule, side: Side, entry: Decimal, entryFee: FeeType, exitFee: FeeType) {
  const k = ONE.plus(rule.gstRate)
  const rE = feeRate(rule, entryFee).times(k)
  const rX = feeRate(rule, exitFee).times(k)
  return side === "long" ? entry.times(ONE.plus(rE)).div(ONE.minus(rX)) : entry.times(ONE.minus(rE)).div(ONE.plus(rX))
}

export function computeFees(input: FeeInput, rule: ContractRule): FeeOutcome {
  const sizeField: FeeField = input.sizeMode === "lots" ? "lots" : "marginInr"
  const fields: Partial<Record<FeeField, string>> = {
    [sizeField]: input.sizeMode === "lots" ? input.lots : input.marginInr,
    leverage: input.leverage,
    entry: input.entry,
    exit: input.exit,
  }
  const required: FeeField[] = [sizeField, "leverage", "entry"]
  const values: Partial<Record<FeeField, Decimal>> = {}
  const errors: Partial<Record<FeeField, FeeFieldErrorCode>> = {}
  let anyEntered = false

  for (const f of Object.keys(fields) as FeeField[]) {
    const p = parseInput(fields[f])
    if (p === null) continue
    anyEntered = true
    if (p === "nan") errors[f] = "NOT_A_NUMBER"
    else if (p === "too-precise") errors[f] = "TOO_PRECISE"
    else if (p === "out-of-range") errors[f] = "OUT_OF_RANGE"
    else if (p.lte(0)) errors[f] = "NOT_POSITIVE"
    else values[f] = p
  }
  if (!anyEntered) return { status: "empty" }

  const { lots: lotsIn, marginInr: marginIn, leverage, entry, exit } = values
  if (lotsIn && !lotsIn.isInteger()) errors.lots = "NOT_WHOLE_LOTS"
  if (lotsIn && lotsIn.gt(Number.MAX_SAFE_INTEGER)) errors.lots = "OUT_OF_RANGE"
  if (leverage && (leverage.lt(1) || leverage.gt(rule.maxLeverage))) errors.leverage = "LEVERAGE_OUT_OF_RANGE"
  if (Object.keys(errors).length > 0) return { status: "invalid", errors }

  const missing: Partial<Record<FeeField, FeeFieldErrorCode>> = {}
  for (const f of required) if (!values[f]) missing[f] = "REQUIRED"
  if (Object.keys(missing).length > 0 || !leverage || !entry) return { status: "invalid", errors: missing }

  const fx = new Decimal(rule.inrPerUsd)
  const c = new Decimal(rule.contractValue)
  const oneLotNotional = c.times(entry)

  let lots: number
  if (input.sizeMode === "lots") {
    lots = lotsIn!.toNumber()
  } else {
    const lotsDecimal = marginIn!.div(fx).times(leverage).div(oneLotNotional).floor()
    if (lotsDecimal.lt(1)) {
      return {
        status: "refused",
        code: "MARGIN_BELOW_ONE_LOT",
        oneLotMarginInr: oneLotNotional.div(leverage).times(fx),
      }
    }
    lots = lotsDecimal.gt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : lotsDecimal.toNumber()
  }
  if (lots > rule.positionSizeLimitContracts) {
    return {
      status: "refused",
      code: "POSITION_SIZE_ABOVE_LIMIT",
      limitContracts: rule.positionSizeLimitContracts,
      lots,
    }
  }

  const quantity = c.times(lots)
  const exitPrice = exit ?? entry
  const entryFeeUsd = entry.times(quantity).times(feeRate(rule, input.entryFee))
  const exitFeeUsd = exitPrice.times(quantity).times(feeRate(rule, input.exitFee))
  const gstUsd = entryFeeUsd.plus(exitFeeUsd).times(rule.gstRate)
  const totalUsd = entryFeeUsd.plus(exitFeeUsd).plus(gstUsd)
  const notionalUsd = quantity.times(entry)
  const marginUsd = notionalUsd.div(leverage)
  const be = breakevenFor(rule, input.side, entry, input.entryFee, input.exitFee)

  let pnl: FeeResult["pnl"] = null
  if (exit) {
    const move = input.side === "long" ? exit.minus(entry) : entry.minus(exit)
    const grossUsd = move.times(quantity)
    const netUsd = grossUsd.minus(totalUsd)
    pnl = { grossUsd, netUsd, netInr: netUsd.times(fx) }
  }

  return {
    status: "ok",
    result: {
      lots,
      quantity,
      notionalUsd,
      marginUsd,
      marginInr: marginUsd.times(fx),
      exitAssumed: !exit,
      exitPrice,
      entryFeeUsd,
      exitFeeUsd,
      gstUsd,
      totalUsd,
      totalInr: totalUsd.times(fx),
      pctOfMargin: totalUsd.div(marginUsd).times(100),
      breakevenPrice: be,
      breakevenPoints: be.minus(entry).abs(),
      pnl,
    },
  }
}
