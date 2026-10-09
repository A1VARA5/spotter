> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Make a Search

AI apps and agents use `/search` to find products across the web.

## The request shape

```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "query": "merino wool sweater",
  "filters": {
    "price": { "min_price": 50, "max_price": 200 },
    "availability": ["InStock"],
    "brand_ids": ["..."],
    "website_ids": ["..."],
    "category": "sweaters"
    // and many more
  },
  "limit": 20
}
```

## Get an API key

Search requires an API key. [Create a free account](https://trychannel3.com/sign-up/developer), then copy your key.

<Note>
  You get **1,000 free credits each month** — that's good for 1,000 searches.
  Extra usage is billed per call; see [pricing](/pricing) for the breakdown.
</Note>

## Choose a search method

<CardGroup cols={3}>
  <Card title="Search" icon="search" href="/guides/search">
    Search with text and images.
  </Card>

  <Card title="Agentic search" icon="sparkles" href="/guides/agentic-search">
    Interpret longer shopping requests for an agent workflow.
  </Card>

  <Card title="Image search" icon="image" href="/guides/image-search">
    Find visually similar products from an image URL or upload.
  </Card>
</CardGroup>

For a photo with several products in one scene, see [Find products in an image](/guides/image-search#find-products-in-an-image).

## Filters

Add optional filters to narrow your search.

<CardGroup cols={3}>
  <Card title="Price" icon="dollar-sign" href="/guides/price-filters">
    Constrain results to an offer price range.
  </Card>

  <Card title="Color" icon="palette" href="/guides/color-filters">
    Find products that match a hex color palette.
  </Card>

  <Card title="Dimensions" icon="ruler" href="/guides/dimension-filters">
    Constrain length, width, height, or weight.
  </Card>

  <Card title="Brand" icon="tag" href="/guides/brand-search">
    Filter by the company behind a product.
  </Card>

  <Card title="Website" icon="store" href="/guides/website-search">
    Restrict results to retailer offers from selected websites.
  </Card>

  <Card title="Attributes" icon="sliders" href="/guides/advanced-search">
    Filter on category-specific structured attributes.
  </Card>

  <Card title="Collections" icon="layer-group" href="/guides/collections">
    Save a catalog scope and reuse it on search, browse, and conversations.
  </Card>
</CardGroup>

## Start from an existing product

<CardGroup cols={2}>
  <Card title="Look up a product URL" icon="link" href="/guides/url-lookup">
    Get structured data from a URL, and offers at other retailers.
  </Card>

  <Card title="Find similar products" icon="clone" href="/guides/similar-products">
    Get recommendations from a known Channel3 product ID.
  </Card>
</CardGroup>

## Attribute clicks to your users

Send the `x-user-id` header on search (and other catalog) requests to tie buy-link clicks and commissions back to a user in your app. Channel3 adds it to every offer URL in the response.

```bash theme={"theme":{"light":"github-light","dark":"github-dark"}}
curl -X POST https://api.trychannel3.com/v1/search \
  -H "x-api-key: $CHANNEL3_API_KEY" \
  -H "x-user-id: user_abc123" \
  -H "Content-Type: application/json" \
  -d '{"query": "merino wool sweater", "limit": 20}'
```

Use a stable ID from your system (UUID, Clerk ID, etc.). Filter reporting by the same value — see [Reporting](/guides/reporting).

## Next

Next: [What you get](/guides/response-overview). It explains how products, offers, prices, and buy links appear in a response.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.