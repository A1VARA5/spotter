> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Image Search

Send a picture, get back the product. `/image-search` accepts both base64 payloads and image URLs. For a scene with several products, use [Find products in an image](#find-products-in-an-image). Pass `config.collection_id` to search inside a [collection](/guides/collections).

## Search by image URL

Pass any publicly accessible image URL to find visually matching products.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  const results = await client.products.search({
    image_url: "https://example.com/images/blue-couch.jpg",
  });

  console.log(results.products[0].title);
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  from channel3_sdk import Channel3

  client = Channel3()

  results = client.products.search(
      image_url="https://example.com/images/blue-couch.jpg",
  )
  print(results.products[0].title)
  ```

  ```bash cURL theme={"theme":{"light":"github-light","dark":"github-dark"}}
  curl -X POST https://api.trychannel3.com/v1/image-search \
    -H "x-api-key: $CHANNEL3_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"image_url": "https://example.com/images/blue-couch.jpg"}'
  ```
</CodeGroup>

## Search by base64 image

Upload an image directly as a base64 string — no public URL required. Great for in-app camera flows or screenshots.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import fs from "node:fs";
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  const b64 = fs.readFileSync("shoe.jpg").toString("base64");
  const results = await client.products.search({ base64_image: b64 });

  console.log(results.products[0].title);
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import base64
  from channel3_sdk import Channel3

  client = Channel3()

  with open("shoe.jpg", "rb") as f:
      b64 = base64.b64encode(f.read()).decode("utf-8")

  results = client.products.search(base64_image=b64)
  print(results.products[0].title)
  ```
</CodeGroup>

## Find products in an image

Send a scene photo and get catalog matches grouped by the objects in it. `/experimental/find-products-in-image` names the things it sees, localizes each one, and runs a catalog search per crop. For SDK examples, see [Find products in image](/sdk/find-products-in-image).

Use this when the picture contains **more than one product** — a room, an outfit, a desk setup. For a photo of a single product, use `/image-search` above.

<Note>
  Alpha. The request shape and billing may change.
</Note>

Billing is **1 credit for the call plus 1 credit per detected thing**. `filters` apply to every per-thing search. `limit` is per thing, not across the whole response.

### From an image URL

Pass any publicly accessible image URL.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  const result = await client.experimental.findProductsInImage({
    image_url: "https://example.com/images/living-room.jpg",
  });

  for (const item of result.things) {
    console.log(item.thing, item.matches[0]?.title);
  }
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  from channel3_sdk import Channel3

  client = Channel3()

  result = client.experimental.find_products_in_image(
      image_url="https://example.com/images/living-room.jpg",
  )
  for item in result.things:
      title = item.matches[0].title if item.matches else None
      print(item.thing, title)
  ```

  ```bash cURL theme={"theme":{"light":"github-light","dark":"github-dark"}}
  curl -X POST https://api.trychannel3.com/experimental/find-products-in-image \
    -H "x-api-key: $CHANNEL3_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"image_url": "https://example.com/images/living-room.jpg"}'
  ```
</CodeGroup>

### From a base64 image

Upload an image directly as a base64 string — no public URL required. Provide exactly one of `image_url` or `base64_image`.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import fs from "node:fs";
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  const b64 = fs.readFileSync("living-room.jpg").toString("base64");
  const result = await client.experimental.findProductsInImage({
    base64_image: b64,
  });
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import base64
  from channel3_sdk import Channel3

  client = Channel3()

  with open("living-room.jpg", "rb") as f:
      b64 = base64.b64encode(f.read()).decode("utf-8")

  result = client.experimental.find_products_in_image(base64_image=b64)
  ```
</CodeGroup>

### What you get back

Each entry in `things` is one detected object:

| Field | Meaning |
| - | - |
| `thing` | Visual noun used for detection, e.g. `"desk lamp"` |
| `bbox` | `[x1, y1, x2, y2]` in `image_size` pixels |
| `matches` | Catalog products for that crop, same shape as [search](/guides/search) |

`image_size` is `[width, height]` of the image the boxes are relative to.

<Cards>
  <Card title="URL Lookup" icon="link" href="/guides/url-lookup" arrow="true">
    Resolve canonical products from supported retailer page URLs.
  </Card>

  <Card title="Similar Products" icon="clone" href="/guides/similar-products" arrow="true">
    Recommend visually similar products from a canonical product ID.
  </Card>

  <Card title="Cleaned Images" icon="sparkles" href="/guides/cleaned-images" arrow="true">
    Prefer square, uniform-background images for consistent product grids.
  </Card>
</Cards>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.