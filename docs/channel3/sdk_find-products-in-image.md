> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Find Products in Image

Send a scene photo to `experimental.findProductsInImage` and get back a list of matches, per product in the scene.

Use this when the picture contains **more than one product** — a room, an outfit, a desk setup. For a photo of a single product, use [Search with an image URL](/sdk/image-url).

See also [Find products in an image](/guides/image-search#find-products-in-an-image).

<Note>Alpha. The request shape and billing may change.</Note>

`filters` apply to every per-thing search. `limit` is per thing, not across the whole response. Billing is **1 credit for the call plus 1 credit per detected thing**.

## From an image URL

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  async function main() {
    const result = await client.experimental.findProductsInImage({
      image_url: "https://example.com/images/living-room.jpg",
    });

    for (const item of result.things) {
      console.log(item.thing, item.matches?.[0]?.title);
    }
  }

  main();
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  from channel3_sdk import Channel3

  client = Channel3()

  def main():
      result = client.experimental.find_products_in_image(
          image_url="https://example.com/images/living-room.jpg",
      )
      for item in result.things:
          title = item.matches[0].title if item.matches else None
          print(item.thing, title)

  if __name__ == "__main__":
      main()
  ```
</CodeGroup>

## From a base64 image

Provide exactly one of `image_url` or `base64_image`. In Python the upload field is `base64image`.

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import fs from "node:fs";
  import Channel3 from "@channel3/sdk";

  const client = new Channel3();

  async function main() {
    const b64 = fs.readFileSync("living-room.jpg").toString("base64");
    const result = await client.experimental.findProductsInImage({
      base64_image: b64,
    });
    console.log(result.things.map((item) => item.thing));
  }

  main();
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark"}}
  import base64
  from channel3_sdk import Channel3

  client = Channel3()

  def main():
      with open("living-room.jpg", "rb") as f:
          b64 = base64.b64encode(f.read()).decode("utf-8")

      result = client.experimental.find_products_in_image(base64image=b64)
      print([item.thing for item in result.things])

  if __name__ == "__main__":
      main()
  ```
</CodeGroup>


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.