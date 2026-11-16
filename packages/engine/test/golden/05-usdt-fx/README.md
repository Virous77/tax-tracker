# usdt-fx

Synthetic data; pending CA review.

Buy 2 ETH at 100 USDT each, USD/INR 80 => cost 16,000. Sell at 150 USDT each => proceeds 24,000; gain 8,000; tax 2,400 + 96 = 2,496. FX date 2026-03-31 is returned by injected lookup. Own price quotes carry no separate settlement leg unless ledger supplies one.

All INR outputs use half-up rounding at the report boundary. Expected values were written from this arithmetic before the engine was implemented.

Additional settlement variant (coverage expansion): first buy 200 USDT for 16,000 INR. Swap all 200 USDT for 2 ETH, quoting each disposed USDT at 1 USDT and using injected USD/INR 80: disposal value and cost are both 16,000, so this USDT disposal has zero gain. ETH basis is 16,000. Sell ETH for 300 USDT at 80 = 24,000. Total taxable consideration = 40,000; total cost = 32,000; gain remains 8,000 and tax 2,496. The acquired 300 USDT remains a VDA holding. This variant exercises FX acquisition valuation without silently omitting the USDT disposal.
