> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Price Tracking

Channel3 refreshes tens of millions of products daily and records their price history. With the Price Tracking API, you can subscribe to any product and receive a webhook the moment its price changes — the foundation of a deal finder or "time-to-buy" UX.

## Start tracking a product

Subscribe to price change notifications by calling the start-tracking endpoint with a canonical `product_id` (any ID from a search or lookup result).

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  await client.priceTracking.start({
    canonical_product_id: "2yh8WH5",
  });

  console.log("Now tracking price changes for product 2yh8WH5");
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  from channel3_sdk import Channel3

  client = Channel3()

  client.price_tracking.start(canonical_product_id="2yh8WH5")
  print("Now tracking price changes for product 2yh8WH5")
  ```

  ```bash cURL theme={"theme":{"light":"github-light","dark":"github-dark"}}
  curl -X POST https://api.trychannel3.com/v0/price-tracking/start \
    -H "x-api-key: $CHANNEL3_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"canonical_product_id": "2yh8WH5"}'
  ```
</CodeGroup>

## Stop tracking

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  await client.priceTracking.stop({ canonical_product_id: "2yh8WH5" });
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  client.price_tracking.stop(canonical_product_id="2yh8WH5")
  ```
</CodeGroup>

## Fetch price history

Once a product is tracked, retrieve its full price history for a "time-to-buy" chart. History accumulates from the moment you start tracking, and also pulls from Channel3's existing historical data where available.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  const history = await client.priceTracking.getHistory({
    canonical_product_id: "2yh8WH5",
  });

  for (const point of history.price_history) {
    console.log(point.timestamp, point.price, point.currency);
  }
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  history = client.price_tracking.get_history(canonical_product_id="2yh8WH5")

  for point in history.price_history:
      print(point.timestamp, point.price, point.currency)
  ```

  ```bash cURL theme={"theme":{"light":"github-light","dark":"github-dark"}}
  curl "https://api.trychannel3.com/v0/price-tracking/history/2yh8WH5" \
    -H "x-api-key: $CHANNEL3_API_KEY"
  ```
</CodeGroup>

## List your subscriptions

See all products you're currently tracking:

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  const subs = await client.priceTracking.listSubscriptions();
  console.log(subs.subscriptions.map(s => s.canonical_product_id));
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  subs = client.price_tracking.list_subscriptions()
  print([s.canonical_product_id for s in subs.subscriptions])
  ```
</CodeGroup>

## Webhooks

Configure a webhook endpoint in the [Channel3 dashboard](https://trychannel3.com/dashboard) to receive real-time notifications whenever a tracked product's price changes. Channel3 sends a POST request to your endpoint with the product ID and new price.

<Card title="Webhook event catalog" icon="webhook" href="/price-tracking-webhooks" arrow="true">
  Full payload schema and event types for price change notifications.
</Card>

### Example webhook handler (Next.js)

```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
// app/api/price-webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const event = await req.json();

  if (event.type === "price.changed") {
    const { canonical_product_id, new_price, currency } = event.data;
    // Notify users who saved this product, update your UI, etc.
    await notifyUsers(canonical_product_id, new_price, currency);
  }

  return NextResponse.json({ received: true });
}
```

## Build a deal finder

The highest-converting shopping experience you can build is a deal finder. Here's the full pattern:

1. When a user saves or views a product, call `priceTracking.start` to subscribe.
2. Display the price history chart using the `price-chart` UI component or `GET /v0/price-tracking/history/{id}`.
3. When Channel3 fires a webhook, push a notification to your user.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  // 1. User saves a product
  async function onProductSave(productId: string) {
    await channel3Client.priceTracking.start({ canonical_product_id: productId });
  }

  // 2. On the product page, load price history
  async function loadPriceHistory(productId: string) {
    return channel3Client.priceTracking.getHistory({ canonical_product_id: productId });
  }

  // 3. Webhook fires → notify the user
  // (see webhook handler above)
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  # 1. User saves a product
  def on_product_save(product_id: str):
      client.price_tracking.start(canonical_product_id=product_id)

  # 2. On the product page, load price history
  def load_price_history(product_id: str):
      return client.price_tracking.get_history(canonical_product_id=product_id)
  ```
</CodeGroup>

## Price history UI component

Don't want to build the chart yourself? The Channel3 UI library ships a `price-chart` component:

```bash theme={"theme":{"light":"github-light","dark":"github-dark"}}
npx shadcn@latest add https://ui.trychannel3.com/r/all.json
```

```tsx theme={"theme":{"light":"github-light","dark":"github-dark"}}
import { PriceChart } from "@/components/channel3/price-chart";

<PriceChart
  history={priceHistory.price_history}
  currentPrice={product.offers[0].price}
/>
```

<Card title="UI + Hooks" icon="blocks" href="/guides/ui-and-hooks" arrow="true">
  The full component library — search, PDP, price charts, and headless hooks.
</Card>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.