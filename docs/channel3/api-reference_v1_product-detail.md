> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Product Detail

> Get detailed information about a specific product by its ID.



## OpenAPI

````yaml get /v1/products/{product_id}
openapi: 3.1.0
info:
  title: FastAPI
  version: 0.1.0
servers:
  - url: https://api.trychannel3.com
    description: Production
security: []
paths:
  /v1/products/{product_id}:
    get:
      tags:
        - v1
      summary: Product Detail
      description: Get detailed information about a specific product by its ID.
      operationId: get_product_detail_v1_products__product_id__get
      parameters:
        - name: product_id
          in: path
          required: true
          schema:
            type: string
            title: Product Id
        - name: website_ids
          in: query
          required: false
          schema:
            anyOf:
              - items:
                  type: string
                type: array
              - type: 'null'
            description: >-
              Optional list of website IDs to constrain the buy URL to, relevant
              if multiple merchants exist. Accepts website IDs or domains (e.g.
              "nike.com").
            title: Website Ids
          description: >-
            Optional list of website IDs to constrain the buy URL to, relevant
            if multiple merchants exist. Accepts website IDs or domains (e.g.
            "nike.com").
        - name: language
          in: query
          required: false
          schema:
            anyOf:
              - $ref: '#/components/schemas/LanguageCode'
              - type: 'null'
            description: >-
              ISO 639-1 language code. Matches any language when unset; defaults
              to 'en' only when country and currency are also unset.
            title: Language
          description: >-
            ISO 639-1 language code. Matches any language when unset; defaults
            to 'en' only when country and currency are also unset.
        - name: country
          in: query
          required: false
          schema:
            anyOf:
              - $ref: '#/components/schemas/CountryCode'
              - type: 'null'
            description: >-
              ISO 3166-1 alpha-2 country code. Matches any country when unset;
              defaults to 'US' only when language and currency are also unset.
            title: Country
          description: >-
            ISO 3166-1 alpha-2 country code. Matches any country when unset;
            defaults to 'US' only when language and currency are also unset.
        - name: currency
          in: query
          required: false
          schema:
            anyOf:
              - $ref: '#/components/schemas/CurrencyCode'
              - type: 'null'
            description: >-
              ISO 4217 currency code. When unset, inferred from `country` (e.g.
              GB -> GBP); falls back to 'USD' only when all three locale fields
              are unset.
            title: Currency
          description: >-
            ISO 4217 currency code. When unset, inferred from `country` (e.g. GB
            -> GBP); falls back to 'USD' only when all three locale fields are
            unset.
        - name: length_unit
          in: query
          required: false
          schema:
            anyOf:
              - $ref: '#/components/schemas/LengthUnit'
              - type: 'null'
            description: >-
              Preferred unit for length dimensions (length/width/height). When
              unset, dimensions are returned in the unit the merchant stated.
            title: Length Unit
          description: >-
            Preferred unit for length dimensions (length/width/height). When
            unset, dimensions are returned in the unit the merchant stated.
        - name: weight_unit
          in: query
          required: false
          schema:
            anyOf:
              - $ref: '#/components/schemas/WeightUnit'
              - type: 'null'
            description: >-
              Preferred unit for weight dimensions. When unset, weight is
              returned in the unit the merchant stated.
            title: Weight Unit
          description: >-
            Preferred unit for weight dimensions. When unset, weight is returned
            in the unit the merchant stated.
        - name: x-user-id
          in: header
          required: false
          schema:
            anyOf:
              - type: string
              - type: 'null'
            description: >-
              Optional user identifier to attribute clicks and sales to a user
              in your system. Channel3 appends it to buy URLs in the response.
            title: X-User-Id
          description: >-
            Optional user identifier to attribute clicks and sales to a user in
            your system. Channel3 appends it to buy URLs in the response.
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Product'
        '401':
          description: Unauthorized - Invalid or missing authentication
          content:
            application/json:
              examples:
                missing_key:
                  summary: Missing API Key
                  value:
                    detail: >-
                      Unauthorized. Missing authentication key. Make sure to
                      attach an x-api-key with your request. Need help? Reach
                      out to support@trychannel3.com.
                invalid_key:
                  summary: Invalid API Key
                  value:
                    detail: >-
                      API key was provided but is invalid. Need help? Reach out
                      to support@trychannel3.com.
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '402':
          description: Payment required
          content:
            application/json:
              examples:
                credits_exhausted:
                  summary: API key out of credits
                  value:
                    detail: >-
                      You have used all of your free credits. Add a payment
                      method to continue.
                mpp_challenge:
                  summary: MPP Tempo payment required
                  value:
                    detail: >-
                      Payment required. Satisfy the MPP Tempo challenge in
                      WWW-Authenticate.
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '404':
          description: Product not found
          content:
            application/json:
              example:
                detail: Product not found
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '422':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                detail:
                  - loc:
                      - body
                      - query
                    msg: field required
                    type: value_error.missing
        '500':
          description: Internal Server Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                detail: Internal Server Error
      security:
        - APIKeyHeader: []
      x-codeSamples:
        - lang: JavaScript
          source: |-
            import Channel3 from '@channel3/sdk';

            const client = new Channel3({
              apiKey: process.env['CHANNEL3_API_KEY'], // This is the default and can be omitted
            });

            const productDetail = await client.products.retrieve('product_id');

            console.log(productDetail.id);
        - lang: Python
          source: |-
            import os
            from channel3_sdk import Channel3

            client = Channel3(
                api_key=os.environ.get("CHANNEL3_API_KEY"),  # This is the default and can be omitted
            )
            product_detail = client.products.retrieve(
                product_id="product_id",
            )
            print(product_detail.id)
        - lang: Go
          source: "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\n\t\"github.com/channel3-ai/sdk-go\"\n\t\"github.com/channel3-ai/sdk-go/option\"\n)\n\nfunc main() {\n\tclient := channel3go.NewClient(\n\t\toption.WithAPIKey(\"My API Key\"),\n\t)\n\tproductDetail, err := client.Products.Get(\n\t\tcontext.TODO(),\n\t\t\"product_id\",\n\t\tchannel3go.ProductGetParams{},\n\t)\n\tif err != nil {\n\t\tpanic(err.Error())\n\t}\n\tfmt.Printf(\"%+v\\n\", productDetail.ID)\n}\n"
        - lang: CLI
          source: |-
            channel3 products retrieve \
              --api-key 'My API Key' \
              --product-id product_id
components:
  schemas:
    LanguageCode:
      type: string
      enum:
        - en
        - de
        - fr
        - it
        - es
        - nl
        - sv
        - fi
        - pt
        - cs
        - el
        - ro
      title: LanguageCode
      description: ISO 639-1 language code.
    CountryCode:
      type: string
      enum:
        - US
        - GB
        - EU
        - AU
        - CA
        - IE
        - DE
        - AT
        - FR
        - BE
        - IT
        - ES
        - NL
        - SE
        - FI
        - PT
        - CZ
        - GR
        - RO
      title: CountryCode
      description: ISO 3166-1 alpha-2 country code (plus the pan-region ``EU``).
    CurrencyCode:
      type: string
      enum:
        - USD
        - CAD
        - AUD
        - GBP
        - EUR
        - SEK
        - CZK
        - RON
      title: CurrencyCode
      description: ISO 4217 currency code.
    LengthUnit:
      type: string
      enum:
        - mm
        - cm
        - m
        - in
        - ft
      title: LengthUnit
    WeightUnit:
      type: string
      enum:
        - mg
        - g
        - kg
        - oz
        - lb
      title: WeightUnit
    Product:
      properties:
        id:
          type: string
          title: Id
        title:
          type: string
          title: Title
        description:
          anyOf:
            - type: string
            - type: 'null'
          title: Description
        brands:
          items:
            $ref: '#/components/schemas/ProductBrand'
          type: array
          title: Brands
          description: Ordered list of brands.
        images:
          items:
            $ref: '#/components/schemas/ProductImage'
          type: array
          title: Images
          default: []
        category:
          anyOf:
            - $ref: '#/components/schemas/CategorySummary'
            - type: 'null'
          description: >-
            The single category this product belongs to, as a structured
            `CategorySummary` (slug, title, path, has_children).
        gender:
          anyOf:
            - $ref: '#/components/schemas/Gender'
            - type: 'null'
        age:
          anyOf:
            - $ref: '#/components/schemas/Age'
            - type: 'null'
          description: >-
            Target age group. Age-agnostic products are typically returned as
            'adult'.
        materials:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Materials
        key_features:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Key Features
        offers:
          items:
            $ref: '#/components/schemas/ProductOffer'
          type: array
          title: Offers
          description: All merchant offers for this product in the requested locale.
        variants:
          anyOf:
            - $ref: '#/components/schemas/Variants'
            - type: 'null'
          description: >-
            Variant interaction state — options, selected. Absent when the
            product has no variations.
        structured_attributes:
          additionalProperties:
            items:
              type: string
            type: array
          type: object
          title: Structured Attributes
          description: >-
            Structured attributes extracted for this product, keyed by attribute
            handle (e.g. 'color', 'material'). Values are the canonical allowed
            values for that handle.
      type: object
      required:
        - id
        - title
      title: Product
      description: Product with detailed information.
    ErrorResponse:
      properties:
        detail:
          anyOf:
            - type: string
            - items:
                additionalProperties: true
                type: object
              type: array
          title: Detail
      type: object
      required:
        - detail
      title: ErrorResponse
    ProductBrand:
      properties:
        id:
          type: string
          title: Id
        name:
          type: string
          title: Name
      type: object
      required:
        - id
        - name
      title: ProductBrand
    ProductImage:
      properties:
        url:
          type: string
          title: Url
        cleaned_url:
          anyOf:
            - type: string
            - type: 'null'
          title: Cleaned Url
          description: >-
            Background-removed square image on Channel3 CDN when available. Use
            for product grids; ``url`` is the regular hosted shot.
        is_main_image:
          type: boolean
          title: Is Main Image
          default: false
        shot_type:
          anyOf:
            - $ref: '#/components/schemas/ApiProductImageType'
            - type: 'null'
        alt_text:
          anyOf:
            - type: string
            - type: 'null'
          title: Alt Text
      type: object
      required:
        - url
      title: ProductImage
      description: Product image with metadata.
    CategorySummary:
      properties:
        slug:
          type: string
          title: Slug
          description: URL-friendly slug (e.g. 'sofas')
        title:
          type: string
          title: Title
          description: Human-readable category title
        path:
          items:
            $ref: '#/components/schemas/CategoryRef'
          type: array
          title: Path
          description: >-
            Hierarchical path as a structured list, root first; the last entry
            is this category itself
        has_children:
          type: boolean
          title: Has Children
          description: Whether this category has subcategories
      type: object
      required:
        - slug
        - title
        - has_children
      title: CategorySummary
      description: Lean category representation used in search hits and list rows.
    Gender:
      type: string
      enum:
        - male
        - female
      title: Gender
      description: >-
        Product gender. 'unisex' is deprecated: coerced to None on input, never
        emitted.
    Age:
      type: string
      enum:
        - newborn
        - infant
        - toddler
        - kids
        - adult
      title: Age
    ProductOffer:
      properties:
        url:
          type: string
          title: Url
        domain:
          type: string
          title: Domain
        price:
          $ref: '#/components/schemas/Price'
        availability:
          $ref: '#/components/schemas/OfferAvailabilityStatus'
        condition:
          anyOf:
            - $ref: '#/components/schemas/Condition'
            - type: 'null'
          description: >-
            Condition of this merchant offer (new or used). Null when condition
            is unknown.
        max_commission_rate:
          type: number
          title: Max Commission Rate
          description: >-
            The maximum commission rate for the merchant, as a decimal fraction:
            0 is no commission, 0.5 is 50% commission. 'Max' because the actual
            commission rate may be lower due to vendor-specific affiliate rules.
          default: 0
        dimensions:
          anyOf:
            - $ref: '#/components/schemas/Dimensions'
            - type: 'null'
          description: Physical dimensions of this offer. Null when unknown.
      type: object
      required:
        - url
        - domain
        - price
        - availability
      title: ProductOffer
    Variants:
      properties:
        options:
          items:
            $ref: '#/components/schemas/VariantOption'
          type: array
          title: Options
        selected:
          items:
            $ref: '#/components/schemas/SelectedOption'
          type: array
          title: Selected
      type: object
      required:
        - options
        - selected
      title: Variants
      description: |-
        Wrapper for variant-interaction state on a Product.

        Holds `options` and `selected`. `options` represent all of the
        configuration options for the product. `selected` represents the
        currently selected option values.
    ApiProductImageType:
      type: string
      enum:
        - hero
        - lifestyle
        - on_model
        - detail
        - scale_reference
        - angle_view
        - flat_lay
        - in_use
        - packaging
        - size_chart
        - product_information
        - merchant_information
      title: ApiProductImageType
      description: Product image type classification for API responses.
    CategoryRef:
      properties:
        slug:
          type: string
          title: Slug
          description: URL-friendly slug (e.g. 'sofas')
        title:
          type: string
          title: Title
          description: Human-readable category title
      type: object
      required:
        - slug
        - title
      title: CategoryRef
      description: Lean reference to a category, used in path and children arrays.
    Price:
      properties:
        price:
          type: number
          title: Price
          description: The current price of the product, including any discounts.
        compare_at_price:
          anyOf:
            - type: number
            - type: 'null'
          title: Compare At Price
          description: The original price of the product before any discounts.
        currency:
          type: string
          title: Currency
          description: The currency code of the product, like USD, EUR, GBP, etc.
      type: object
      required:
        - price
        - currency
      title: Price
    OfferAvailabilityStatus:
      type: string
      enum:
        - InStock
        - OutOfStock
      title: OfferAvailabilityStatus
      description: |-
        The two availability values the public API emits on offers.

        Internal ``AvailabilityStatus`` values are collapsed to these via
        ``AvailabilityStatus.to_api()``.
    Condition:
      type: string
      enum:
        - new
        - used
      title: Condition
      description: >-
        Offer condition. 'refurbished' is deprecated: rejected as a filter
        value,

        coerced to None on responses.
    Dimensions:
      properties:
        length:
          anyOf:
            - $ref: '#/components/schemas/LengthDimension'
            - type: 'null'
        width:
          anyOf:
            - $ref: '#/components/schemas/LengthDimension'
            - type: 'null'
        height:
          anyOf:
            - $ref: '#/components/schemas/LengthDimension'
            - type: 'null'
        weight:
          anyOf:
            - $ref: '#/components/schemas/WeightDimension'
            - type: 'null'
      type: object
      title: Dimensions
      description: >-
        Physical dimensions of a product offer. Members are null when unknown.


        Values are standardized to the supported unit set; a merchant-stated
        value

        whose unit is not one of those units is omitted rather than shown.
    VariantOption:
      properties:
        name:
          type: string
          title: Name
          description: The name of the option (e.g. 'Color', 'Size')
        values:
          items:
            $ref: '#/components/schemas/OptionValue'
          type: array
          title: Values
          description: The values of the option (e.g. ['Blue', 'Red', 'Green'])
      type: object
      required:
        - name
        - values
      title: VariantOption
      description: One dimension of a product family (e.g. 'Color', 'Size').
    SelectedOption:
      properties:
        name:
          type: string
          title: Name
          description: The name of the selected option (e.g. 'Color', 'Size')
        label:
          type: string
          title: Label
          description: The display value of the selected option (e.g. 'Blue', 'XL')
      type: object
      required:
        - name
        - label
      title: SelectedOption
      description: One effective selection on a product, post server-side relaxation.
    LengthDimension:
      properties:
        number:
          type: number
          title: Number
        unit:
          $ref: '#/components/schemas/LengthUnit'
          description: >-
            The unit from the request's dimension filters when one was given
            (the value is converted to it); otherwise the unit the merchant
            stated.
      type: object
      required:
        - number
        - unit
      title: LengthDimension
      description: A length measurement, in one of the supported length units.
    WeightDimension:
      properties:
        number:
          type: number
          title: Number
        unit:
          $ref: '#/components/schemas/WeightUnit'
          description: >-
            The unit from the request's dimension filters when one was given
            (the value is converted to it); otherwise the unit the merchant
            stated.
      type: object
      required:
        - number
        - unit
      title: WeightDimension
      description: A weight measurement, in one of the supported weight units.
    OptionValue:
      properties:
        label:
          type: string
          title: Label
          description: The display value of the option value (e.g. 'Blue')
        exists:
          type: boolean
          title: Exists
          description: >-
            Whether the option value exists on the product, or is a
            configuration only present on another variant of the same product.
            For example, a shirt that comes in multiple colors, but only one
            color is available in Size XL.
        available:
          anyOf:
            - $ref: '#/components/schemas/OfferAvailabilityStatus'
            - type: 'null'
          description: >-
            The availability status of the option value. None when returned on
            search results, hydrated only on get product detail requests.
        thumbnail_url:
          anyOf:
            - type: string
            - type: 'null'
          title: Thumbnail Url
          description: >-
            For options that reference different products, this is the URL of
            the thumbnail image for the option value. E.g., a shoe that comes in
            multiple colors will have an OptionValue for each color with a
            thumbnail_url set.
        product_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Product Id
          description: >-
            The product id that represents this value. Variants that point to
            different products will have this field set, as well as
            thumbnail_url for displaying selector icons.
      type: object
      required:
        - label
        - exists
      title: OptionValue
      description: One value of one variant option (e.g. 'Blue' under 'Color')
  securitySchemes:
    APIKeyHeader:
      type: apiKey
      in: header
      name: x-api-key

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.