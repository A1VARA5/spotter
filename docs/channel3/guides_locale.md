> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Set Locale

A **locale** is the combination of country, language, and currency for a request. It controls which merchant [offers](/guides/offer) are eligible and how prices are expressed.

## Why it matters

The same product can have different retailers, prices, and currency by market. Set locale on the SDK client or per request:

```typescript theme={"theme":{"light":"github-light","dark":"github-dark"}}
const client = new Channel3({
  // default for every call
  country: "US",
  language: "en",
  currency: "USD",
});

// or override per call
await client.products.search({
  query: "running shoes",
  country: "GB",
  language: "en",
  currency: "GBP",
});
```

## Supported markets

### Countries

| Code | Market |
| - | - |
| `US` | United States |
| `CA` | Canada |
| `GB` | United Kingdom |
| `IE` | Ireland |
| `AU` | Australia |
| `DE` | Germany |
| `AT` | Austria |
| `FR` | France |
| `BE` | Belgium |
| `IT` | Italy |
| `ES` | Spain |
| `NL` | Netherlands |
| `SE` | Sweden |
| `FI` | Finland |
| `PT` | Portugal |
| `CZ` | Czech Republic |
| `GR` | Greece |
| `RO` | Romania |
| `EU` | Europe (pan-region; use with `currency: EUR` when you don't need a single country) |

### Currencies

`USD`, `CAD`, `AUD`, `GBP`, `EUR`, `SEK`, `CZK`, `RON`

When you set `country` only, the API infers `currency` (for example `GB` → `GBP`). When all three locale fields are unset, defaults are `en` / `US` / `USD`.

### Languages

`en`, `de`, `fr`, `it`, `es`, `nl`, `sv`, `fi`, `pt`, `cs`, `el`, `ro`

Coverage outside the U.S. is still growing. See [Localization](/guides/localization) for units, defaults, and per-request overrides.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.