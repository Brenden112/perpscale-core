// Shared types for contract rules. Kept free of Node APIs so client components can import it.

/** Hand-checked contracts, benchmarked against Delta's own fee calculator. Every other contract comes from the API snapshot. */
export const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD"] as const
export type ContractSymbol = (typeof SYMBOLS)[number]

export type RuleSource = {
  what: string
  url: string
  raw?: string
  doc?: string
  sha256?: string
  checkedAt: string
}

/**
 * One contract's rules, from rules/delta-india-<symbol>.json (hand-checked) or rules/delta-india-contracts.json (API
 * snapshot, plan 2.1). Decimal values stay strings. No sources here: this shape is passed to client components.
 */
export type ContractRule = {
  symbol: string
  /** "Bitcoin", "PAX Gold Token", … from the API's short_description */
  name: string
  /** true for the three hand-checked, benchmarked contracts (SYMBOLS) */
  verified: boolean
  /**
   * Snapshot mark price on the tick grid, refreshed weekly (rules/delta-india-market.json); for examples and
   * reference tables only; null if the API had none
   */
  refPrice: string | null
  productId: number
  contractValue: string
  contractUnit: string
  tickSizeUsd: string
  priceDecimals: number
  quantityDecimals: number
  makerRate: string
  takerRate: string
  gstRate: string
  inrPerUsd: string
  initialMarginMinPct: string
  maintenanceMarginMinPct: string
  maxLeverage: number
  leverageSliderValues: number[]
  flatMarginNotionalLimitUsd: string
  flatMarginNotionalLimitBasis: string
  positionSizeLimitContracts: number
  isolatedLiquidationFeeRate: string
  checkedAt: string
}

export type SourcedRule = ContractRule & { symbol: ContractSymbol; sources: RuleSource[] }

/** The hand-checked contracts with their sources. */
export type RuleSet = Record<ContractSymbol, SourcedRule>

/** Every live contract by symbol (plan 2.2). */
export type RuleMap = Record<string, ContractRule>

export const isVerified = (symbol: string): symbol is ContractSymbol => (SYMBOLS as readonly string[]).includes(symbol)

/** Looks a symbol up, falling back to BTCUSD so a stale or hand-edited symbol never breaks the form. */
export function ruleFor(rules: RuleMap, symbol: string): ContractRule {
  return rules[symbol] ?? rules.BTCUSD!
}
