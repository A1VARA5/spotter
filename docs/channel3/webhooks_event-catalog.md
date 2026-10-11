> Source: https://webhooks.trychannel3.com/ (Channel3's webhook event catalog, hosted by Svix), fetched 2026-10-11.
> The docs page https://docs.trychannel3.com/price-tracking-webhooks.md only links here.
> Delivery is through Svix, so requests carry Svix's headers (svix-id, svix-timestamp, svix-signature)
> signed with the endpoint's signing secret (whsec_...) shown in the Channel3 dashboard.
> Note: the payload is flat (fields at the top level), not under `data` as the guide's example handler suggests.

# Event type: price.changed

Triggered when the price changes for a product you're tracking.

## Schema (PriceChangedEvent), copied verbatim from the catalog page

```json
{
  "description": "Triggered when the price changes for a product you're tracking.",
  "examples": [
    {
      "buy_url": "string",
      "canonical_product_id": "string",
      "currency": "string",
      "new_price": 3.14,
      "old_price": 3.14,
      "timestamp": "2026-04-29T17:22:52.490236533",
      "type": "price.changed"
    }
  ],
  "properties": {
    "buy_url": { "title": "Buy Url", "type": "string" },
    "canonical_product_id": { "title": "Canonical Product Id", "type": "string" },
    "currency": { "title": "Currency", "type": "string" },
    "new_price": { "title": "New Price", "type": "number" },
    "old_price": { "title": "Old Price", "type": "number" },
    "timestamp": { "format": "date-time", "title": "Timestamp", "type": "string" },
    "type": { "const": "price.changed", "default": "price.changed", "title": "Type", "type": "string" }
  },
  "required": ["canonical_product_id", "old_price", "new_price", "currency", "buy_url", "timestamp"],
  "title": "PriceChangedEvent",
  "type": "object"
}
```
