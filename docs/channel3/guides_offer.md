> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Offer

An **offer** is one merchant's listing for a [product](/guides/product). If three stores sell the same sweater, that product has three offers.

Because retailers may sell the same product at different prices, price lives on the offer, not the product. Same goes for buy URLs.

## What's on an offer

| Field | Meaning |
| - | - |
| `url` | Product page / attributed buy link at that retailer |
| `domain` | Store domain (e.g. `bestbuy.com`) |
| `price` | Amount + currency for this listing |
| `availability` | `InStock` or `OutOfStock` |
| `condition` | `new`, `used`, `refurbished`, or unknown |
| `max_commission_rate` | Max commission from partner brands (decimal: `0.08` = 8%) |
| `dimensions` | Physical size/weight when known |

## Example: new and used offers

The same canonical product can have a new offer from the brand and a lower-priced used offer from a resale retailer:

```json theme={"theme":{"light":"github-light","dark":"github-dark"}}
{
  "id": "2yh8WH5",
  "title": "Tiffany & Co. Return to Tiffany Heart Tag Pendant",
  "offers": [
    {
      "domain": "tiffany.com",
      "price": { "amount": 395, "currency": "USD" },
      "availability": "InStock",
      "condition": "new",
      "url": "https://www.buy.trychannel3.com/..."
    },
    {
      "domain": "therealreal.com",
      "price": { "amount": 225, "currency": "USD" },
      "availability": "InStock",
      "condition": "used",
      "url": "https://www.buy.trychannel3.com/..."
    }
  ]
}
```

## How to display offers

For most shopping experiences, we recommend showing all offers. This lets shoppers compare retailers and choose the price that works best for them.

<img src="https://mintcdn.com/channel3/pOMzCYD4hJ9t9h5S/public/offer-comparison.png?fit=max&auto=format&n=pOMzCYD4hJ9t9h5S&q=85&s=0f3cf9a565631008e831eccefa12f7c2" alt="An offer comparison lists Sears at $97.47 as the best price, Best Buy at $117.99, and Staples at $230.69; each row has a View link to buy from that retailer." width="1024" height="486" data-path="public/offer-comparison.png" />

You can narrow that list to offers in `new` condition, from selected retailers, or with a high `max_commission_rate`

## Filters that apply to offers

These search filters match against offers, not the product:

* [Price](/guides/price-filters)
* [Dimensions](/guides/dimension-filters)
* Availability and condition
* [Website](/guides/website-search) (retailer)

**How matching works:** a product passes if **at least one offer** matches all your filters. When you combine filters — say under \$50, in stock, and from Target — that one offer must satisfy **all** of them.

Matching products still return **every** offer, including ones that didn't match. To show only matching listings in your experience, you can filter `product.offers` on your end.

## Commissions

When `max_commission_rate > 0`, the offer can earn commission. See [Commissions](/commissions).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.