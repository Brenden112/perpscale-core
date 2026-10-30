// Delta India's Scalper Offer: no closing fee on a futures trade closed within a short window after it was opened.
// Terms read from Delta's help centre on 2026-10-21 (docs/04-launch/手动执行SOP_2026-10-20.md §G, evidence in
// evidence/2026-10-21/scalper/). Delta may change or end the offer without notice: when it does, update this file and
// the copy that quotes SCALPER_TERMS. Only the three hand-checked, benchmarked contracts are modelled; other contracts
// (and the options, PAXGUSD, SLVONUSD and XAUTUSD that Delta excludes) always use standard fees.
import { type ContractSymbol, isVerified } from "./contracts"

const WINDOW_MINUTES = { BTCUSD: 30, ETHUSD: 30, SOLUSD: 15 } as const satisfies Record<ContractSymbol, number>

/** Minutes after opening within which a close qualifies, or undefined when the contract is not modelled. */
export function scalperWindowMinutes(symbol: string): number | undefined {
  return isVerified(symbol) ? WINDOW_MINUTES[symbol] : undefined
}

/**
 * The modelled windows as one phrase for copy, grouped by length in the order above:
 * "a BTCUSD or ETHUSD trade closed within 30 minutes, or a SOLUSD trade within 15 minutes".
 */
export function scalperWindowsPhrase(): string {
  const groups = new Map<number, string[]>()
  for (const [symbol, minutes] of Object.entries(WINDOW_MINUTES))
    groups.set(minutes, [...(groups.get(minutes) ?? []), symbol])
  return [...groups]
    .map(
      ([minutes, symbols], i) => `a ${symbols.join(" or ")} trade ${i === 0 ? "closed " : ""}within ${minutes} minutes`
    )
    .join(", or ")
}

export const SCALPER_TERMS = {
  checkedAt: "2026-10-21",
  url: "https://www.delta.exchange/support/solutions?categoryId=80000464980&folderId=80000723382&articleId=80001172745",
  /** What the offer needs besides closing in time; shown next to the switch and on the methodology page. */
  conditions:
    "You must have joined the offer (Join Now) before opening; liquidations and earlier trades don't qualify.",
} as const
