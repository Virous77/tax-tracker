# determinism

Synthetic data; pending CA review.

The same duplicate-free ledger is computed twice, also with reversed input order. Sort order is timestamp, source, sourceRef. Each result has two input rows, gain 50,000, tax 15,600 and net 13,100; no mutation or accumulation.

All INR outputs use half-up rounding at the report boundary. Expected values were written from this arithmetic before the engine was implemented.
