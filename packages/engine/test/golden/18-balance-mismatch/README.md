# balance-mismatch

Synthetic data; pending CA review.

The expected difference was updated because the balance contract now defines difference as actual minus computed, matching the UI and exports. Tax arithmetic is unchanged.

Buy 2 ETH; sell 0.5: holding 1.5. Actual 1.4 => actual minus computed -0.1. Gain 100 minus 50 cost = 50; tax 15.60.

All INR outputs use half-up rounding at the report boundary. Expected values were written from this arithmetic before the engine was implemented.
