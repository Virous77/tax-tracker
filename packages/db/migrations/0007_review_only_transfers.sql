UPDATE `transactions`
SET `type` = 'transfer',
	`flags` = CASE
		WHEN EXISTS (
			SELECT 1 FROM json_each(`flags`)
			WHERE json_extract(value, '$.code') IN ('unknown_type', 'suspected_spam')
		) THEN `flags`
		ELSE json_insert(`flags`, '$[#]', json_object(
			'code', 'unknown_type',
			'message', 'Original entry retained for review with no balance effect.'
		))
	END
WHERE `type` = 'fee'
	AND `user_edited` = 0
	AND `import_id` IS NOT NULL
	AND (`source` IN ('binance', 'binance-api', 'coindcx', 'coindcx-api') OR `source` GLOB 'evm:*')
	AND `amount_in` IS NULL
	AND `amount_out` IS NULL
	AND `fee_amount` IS NULL
	AND `inr_value` IS NULL
	AND `tds_inr` IS NULL
	AND json_array_length(`flags`) > 0;
