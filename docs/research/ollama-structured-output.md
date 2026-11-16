# Ollama structured output for recipe suggestions

Researched 2026-11-16. Sources: Ollama's server code for the OpenAI-compatible layer
(<https://github.com/ollama/ollama/blob/main/openai/openai.go>, read at `main` on this date), Ollama docs
(<https://docs.ollama.com/capabilities/structured-outputs>, <https://docs.ollama.com/api/openai-compatibility>), and the model library pages.
**Nothing here was run against a live Ollama** (none installed on this machine), so the request shapes are verified from code and docs, the model advice is not benchmarked.

## 1. OpenAI-compatible endpoint (what SPEC §6 uses)

`POST {baseUrl}/chat/completions` with `baseUrl = http://ollama:11434/v1`.

```http
Content-Type: application/json
Authorization: Bearer ollama
```

```json
{
	"model": "qwen3:8b",
	"stream": false,
	"temperature": 0,
	"seed": 1,
	"max_tokens": 1024,
	"reasoning_effort": "none",
	"messages": [
		{
			"role": "system",
			"content": "You map spreadsheet columns to a recipe. Reply with JSON only. JSON schema: { ...same schema as below, as text... }"
		},
		{
			"role": "user",
			"content": "Sheet: CSV\nHeaders: Date,Market,Price,Volume,Total,Trade,Fee Currency,Fee,TDS\nRows:\n2025-07-01 13:22:10,USDTINR,89.5,300,26850,Buy,INR,53.7,\n..."
		}
	],
	"response_format": {
		"type": "json_schema",
		"json_schema": {
			"name": "recipe",
			"strict": true,
			"schema": {
				"type": "object",
				"additionalProperties": false,
				"required": [
					"columns",
					"dateFormat",
					"timezone",
					"signStyle",
					"sideMap",
					"knownQuotes"
				],
				"properties": {
					"columns": {
						"type": "object",
						"additionalProperties": false,
						"required": [
							"timestamp",
							"amount",
							"type",
							"side",
							"pair",
							"baseAsset",
							"quoteAsset",
							"price",
							"total",
							"feeAmount",
							"feeAsset",
							"tds",
							"id",
							"txHash"
						],
						"properties": {
							"timestamp": { "type": "string" },
							"amount": { "type": "string" },
							"type": { "type": ["string", "null"] },
							"side": { "type": ["string", "null"] },
							"pair": { "type": ["string", "null"] },
							"baseAsset": { "type": ["string", "null"] },
							"quoteAsset": { "type": ["string", "null"] },
							"price": { "type": ["string", "null"] },
							"total": { "type": ["string", "null"] },
							"feeAmount": { "type": ["string", "null"] },
							"feeAsset": { "type": ["string", "null"] },
							"tds": { "type": ["string", "null"] },
							"id": { "type": ["string", "null"] },
							"txHash": { "type": ["string", "null"] }
						}
					},
					"dateFormat": { "type": "string" },
					"timezone": {
						"type": ["string", "null"],
						"enum": ["IST", "UTC", null]
					},
					"signStyle": {
						"type": "string",
						"enum": ["side_column", "negative_is_sell"]
					},
					"sideMap": {
						"type": "array",
						"items": {
							"type": "object",
							"additionalProperties": false,
							"required": ["value", "means"],
							"properties": {
								"value": { "type": "string" },
								"means": {
									"type": "string",
									"enum": ["buy", "sell", "deposit", "withdrawal", "income"]
								}
							}
						}
					},
					"knownQuotes": { "type": "array", "items": { "type": "string" } }
				}
			}
		}
	}
}
```

Reply: `choices[0].message.content` is a **string** containing the JSON; `choices[0].finish_reason` and `usage.prompt_tokens` are present.
Thinking text, if any, is in `choices[0].message.reasoning`, not in `content`.

What Ollama does with the request (verified in `openai.go`):

| Field                                                                           | Behaviour                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `response_format.type`                                                          | `"json_schema"` → the schema becomes the native `format`. `"json_object"` → `format: "json"` (any JSON, no schema). Compared case-insensitively. |
| `response_format.json_schema.schema`                                            | **the only key read** inside `json_schema`.                                                                                                      |
| `json_schema.name`, `.strict`, `.description`                                   | ignored by Ollama. Send `name` and `strict` anyway: OpenAI itself requires `name`, and other servers may too.                                    |
| `json_schema` missing while `type` is `json_schema`                             | no constraint is applied and no error is returned. Always send the schema, and always validate the reply.                                        |
| `temperature`, `seed`, `top_p`, `stop`, `frequency_penalty`, `presence_penalty` | passed through as options.                                                                                                                       |
| `max_tokens`                                                                    | becomes `num_predict`.                                                                                                                           |
| `reasoning_effort` (or `reasoning.effort`)                                      | mapped to the native `think` value; `"none"` turns thinking off on models that can turn it off.                                                  |
| context size                                                                    | **cannot be set through this endpoint** (docs: create a model with `PARAMETER num_ctx` in a Modelfile, or configure the server).                 |
| `tool_choice`, `logit_bias`, `user`, `n`                                        | not supported (docs).                                                                                                                            |
| `keep_alive`                                                                    | Ollama extension, accepted.                                                                                                                      |

Docs also state that Ollama's **cloud** models do not support structured outputs; local models do.

## 2. Native endpoint (alternative)

`POST http://ollama:11434/api/chat`

```json
{
	"model": "qwen3:8b",
	"stream": false,
	"think": false,
	"format": {
		"type": "object",
		"properties": { "...": {} },
		"required": ["..."]
	},
	"options": {
		"temperature": 0,
		"seed": 1,
		"num_ctx": 8192,
		"num_predict": 1024
	},
	"messages": [
		{ "role": "system", "content": "..." },
		{ "role": "user", "content": "..." }
	]
}
```

`format` is the bare JSON schema object (or the string `"json"`). Reply: `message.content` (string of JSON), `done_reason`, `prompt_eval_count`.

|                                                          | OpenAI-compatible `/v1/chat/completions`                               | Native `/api/chat` |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| Works with LM Studio, llama.cpp server, vLLM, cloud APIs | yes (each has its own level of `json_schema` support; unverified here) | no                 |
| Can set `num_ctx` per request                            | **no**                                                                 | yes                |
| Schema field                                             | `response_format.json_schema.schema`                                   | `format`           |

Recommendation: keep the OpenAI-compatible call as SPEC says (one code path for every endpoint). Handle context size as below.

## 3. Things that will go wrong, and the guard for each

| Risk                                                                                                                                                                                                                                          | Guard                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt longer than the model's loaded context.** The server truncates the prompt without an error. Header + 20 rows of a wide file plus the schema can pass a few thousand tokens. The default context on a given install was not verified. | Cap every sample cell (e.g. 60 chars) before sending and show the capped payload to the user (SPEC already shows the payload). Compare `usage.prompt_tokens` against a rough estimate; warn when it is much smaller. In `docker-compose.yml`, raise the Ollama server's default context (the `OLLAMA_CONTEXT_LENGTH` environment variable; name from memory, check the Ollama FAQ). |
| Output cut off (`finish_reason: "length"`)                                                                                                                                                                                                    | Treat as an error; `JSON.parse` would fail anyway. Never apply partially.                                                                                                                                                                                                                                                                                                           |
| Constrained decoding guarantees shape, not sense                                                                                                                                                                                              | Zod-parse the reply, then check that every column name the model returned **exists in the header row** before running the row checks in SPEC §6.                                                                                                                                                                                                                                    |
| Schema keywords the grammar converter ignores                                                                                                                                                                                                 | Keep the schema to objects, strings, enums, arrays, `required`, nullable types. No `$ref`, `oneOf`, `pattern`, numeric bounds. Supported subset not verified keyword by keyword.                                                                                                                                                                                                    |
| Optional properties left out or invented                                                                                                                                                                                                      | Make every property required and nullable (as above), `additionalProperties: false`. This also satisfies OpenAI's strict mode, so the same schema works on a cloud endpoint.                                                                                                                                                                                                        |
| A map with free keys (`sideMap: Record<string, …>`) cannot be expressed in strict mode                                                                                                                                                        | Ask for an array of `{value, means}` and convert to the record in code (as above).                                                                                                                                                                                                                                                                                                  |
| Thinking models spend the token budget before the JSON                                                                                                                                                                                        | `reasoning_effort: "none"`. Docs note `gpt-oss` cannot disable thinking; give it a larger `max_tokens` or avoid it as default.                                                                                                                                                                                                                                                      |
| Non-determinism between runs                                                                                                                                                                                                                  | `temperature: 0` and a fixed `seed` (both passed through).                                                                                                                                                                                                                                                                                                                          |
| Prompt injection from cell text ("ignore previous instructions…")                                                                                                                                                                             | The model can only emit a recipe; column-existence and row checks bound the damage. Never let the reply choose endpoints, files or code.                                                                                                                                                                                                                                            |

Docs tips, all cheap to follow: generate the schema from the Zod schema (`z.toJSONSchema()` in Zod 4, which the Ollama JS example uses), set temperature 0,
and also paste the schema as text into the prompt.

## 4. Models

Checked on the Ollama library on 2026-11-16 that these tags exist; quality on this task is **not measured**.

| Model tag                                      | Size / notes (from library page or docs)                                          | Role                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| `qwen3:8b`                                     | 5.2 GB, 40K context, tools + thinking; used in Ollama's own API docs; 43.6M pulls | **recommended default**                  |
| `qwen3:4b`                                     | smaller sibling                                                                   | low-memory option (8 GB machines)        |
| `gemma3:4b`                                    | no thinking mode                                                                  | low-memory option; nothing to switch off |
| `gpt-oss:20b`                                  | used in Ollama's chat-completions docs example; cannot disable thinking           | better quality for 16 GB+ machines       |
| `qwen3.5:4b`, `qwen3.5:9b`, `gemma4:12b`       | newer families present in the library                                             | evaluate before switching the default    |
| `llama3.2:3b`, `phi4-mini:3.8b`, `granite4:3b` | small general models                                                              | untested fallbacks                       |

Why a small model is enough: the task is classification of about a dozen column names with 20 example rows, and the grammar removes malformed output.

How to pick for real (one hour of work once Ollama is running): send `generic-unknown-exchange.csv`, `generic-signed-amounts.csv` and
`us-broker-schwab-like.csv` from `packages/importers/test/fixtures/` through each candidate five times; a model passes if every reply validates,
every column name exists, and the recipe converts all rows with the SPEC §6 checks green. Record the result here.

Smoke test:

```sh
curl -s http://localhost:11434/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"qwen3:8b","stream":false,"temperature":0,"reasoning_effort":"none","messages":[{"role":"user","content":"Headers: Date,Market,Trade. Which header is the timestamp?"}],"response_format":{"type":"json_schema","json_schema":{"name":"t","strict":true,"schema":{"type":"object","additionalProperties":false,"required":["timestamp"],"properties":{"timestamp":{"type":"string","enum":["Date","Market","Trade"]}}}}}}'
```

Expected: `choices[0].message.content` equal to `{"timestamp":"Date"}`.

## 5. Local or not

`isLocal` (SPEC §8) should be true only when the endpoint host is `localhost`, a loopback address, the compose service name `ollama`,
or a private-range address the user typed. Everything else needs the user's key and the acknowledged warning before any row leaves the machine.
