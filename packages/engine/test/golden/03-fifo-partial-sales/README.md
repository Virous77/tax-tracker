# fifo-partial-sales

Synthetic data; pending CA review.

Buy 1 @100, 2 @200, 1 @300: cost 800. Sell 1.5 for 450: lot costs 100 + 100; proceeds 300 + 150; gains 200 + 50. Sell 2 for 800: costs 300 + 150; proceeds 600 + 200; gains 300 + 50. Total gain 600; tax 180 + 7.20 = 187.20; remaining 0.5 cost 150.

All INR outputs use half-up rounding at the report boundary. Expected values were written from this arithmetic before the engine was implemented.
