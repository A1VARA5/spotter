> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# v3.4.0 — July 2026

* Added [`POST /v1/browse`](/api-reference/v1/browse) — list and page through products for a brand, website, or category, ideal for static grid views. Access is restricted; [contact us](mailto:support@trychannel3.com) to enable it
* Added `mode` to [`POST /v1/search`](/api-reference/v1/search) config — choose `default` (lexical + semantic, recommended), `keyword` (lexical only, lowest latency), or `agentic` (LLM-planned sub-searches for complex queries). Deprecated `keyword_search_only`; `true` is equivalent to `mode=keyword`
* Added `sale` filter to [`POST /v1/search`](/api-reference/v1/search) — pass `on_sale` to only return products with at least one offer priced below its compare-at price
* Updated `condition` filter to require at least one offer matching the requested condition, locale, and any price filter — offers without condition data are indexed as `new`
* Added `condition` to product offer models — `new`, `refurbished`, or `used`, or `null` when unknown
* Added `country` parameter to brand and website endpoints — commission rates now reflect the requested country (default `US`)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.