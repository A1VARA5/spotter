> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# URL Lookup

Go from URL to structured product data in seconds.

Pass any supported retailer page URL to `products.lookup` and get back the canonical `Product` from Channel3's catalog. The returned `product.id` is stable and works with `products.retrieve` afterward.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  const result = await client.products.lookup({
    url: "https://brand.com/products/linen-shirt",
  });

  console.log(result.product.id); // stable canonical ID
  console.log(result.product.title);
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  from channel3_sdk import Channel3

  client = Channel3()

  result = client.products.lookup(
      url="https://brand.com/products/linen-shirt"
  )

  print(result.product.id)
  print(result.product.title)
  ```

  ```bash cURL theme={"theme":{"light":"github-light","dark":"github-dark"}}
  curl -X POST https://api.trychannel3.com/v1/lookup \
    -H "x-api-key: $CHANNEL3_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://brand.com/products/linen-shirt"}'
  ```
</CodeGroup>

<Cards>
  <Card title="Image Search" icon="image" href="/guides/image-search" arrow="true">
    Search by image URL or base64 upload to find visually matching products.
  </Card>

  <Card title="Conversational Agent" icon="comments" href="/conversations" arrow="true">
    Multi-turn shopping chat with server-owned conversations and streamed assistant
    replies.
  </Card>

  <Card title="Similar Products" icon="clone" href="/guides/similar-products" arrow="true">
    Recommend visually similar products from a canonical product ID.
  </Card>

  <Card title="Advanced Search" icon="sliders" href="/guides/advanced-search" arrow="true">
    Lookup responses include structured attributes — combine with search filters
    for precise discovery.
  </Card>
</Cards>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.