> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# v3.5.0 — July 2026

* Added `dimensions` filter to [`POST /v1/search`](/api-reference/v1/search) — match products by physical size (`length`, `width`, `height`) and `weight`. Each field takes an optional `min`/`max` (inclusive) and a required `unit`. See [Dimension Filters](/guides/dimension-filters)
* Added `dimensions` to product offer models — `length`, `width`, `height`, and `weight`, each returned as a `number` plus its `unit`; individual members are `null` when unknown
* Added `length_unit` and `weight_unit` controls for the unit dimensions come back in — set them per request (search `config`, or [`GET /v1/products/{product_id}`](/api-reference/v1/product-detail) query params) or as a client default via the SDK constructor or the `CHANNEL3_LENGTH_UNIT` / `CHANNEL3_WEIGHT_UNIT` environment variables. Precedence is: a dimension filter's own unit, then the per-request value, then the client default; when none is set, the merchant's stated unit is returned
* Length units are `mm`, `cm`, `m`, `in`, `ft`; weight units are `mg`, `g`, `kg`, `oz`, `lb`. A merchant-stated value whose unit falls outside these sets is omitted rather than converted


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.