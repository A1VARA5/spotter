> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Get Price History

> Get price history for a canonical product.



## OpenAPI

````yaml get /v0/price-tracking/history/{canonical_product_id}
openapi: 3.1.0
info:
  title: FastAPI
  version: 0.1.0
servers:
  - url: https://api.trychannel3.com
    description: Production
security: []
paths:
  /v0/price-tracking/history/{canonical_product_id}:
    get:
      tags:
        - price-tracking
      summary: Get Price History
      description: Get price history for a canonical product.
      operationId: get_price_history_v0_price_tracking_history__canonical_product_id__get
      parameters:
        - name: canonical_product_id
          in: path
          required: true
          schema:
            type: string
            title: Canonical Product Id
        - name: days
          in: query
          required: false
          schema:
            type: integer
            maximum: 30
            minimum: 1
            description: Number of days of history to fetch (max 30)
            default: 30
            title: Days
          description: Number of days of history to fetch (max 30)
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PriceHistoryResponse'
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
          description: Not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                detail: Canonical product xyz123 not found
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
          source: >-
            import Channel3 from '@channel3/sdk';


            const client = new Channel3({
              apiKey: process.env['CHANNEL3_API_KEY'], // This is the default and can be omitted
            });


            const priceHistory = await
            client.priceTracking.retrieveHistory('canonical_product_id');


            console.log(priceHistory.canonical_product_id);
        - lang: Python
          source: |-
            import os
            from channel3_sdk import Channel3

            client = Channel3(
                api_key=os.environ.get("CHANNEL3_API_KEY"),  # This is the default and can be omitted
            )
            price_history = client.price_tracking.retrieve_history(
                canonical_product_id="canonical_product_id",
            )
            print(price_history.canonical_product_id)
        - lang: Go
          source: "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\n\t\"github.com/channel3-ai/sdk-go\"\n\t\"github.com/channel3-ai/sdk-go/option\"\n)\n\nfunc main() {\n\tclient := channel3go.NewClient(\n\t\toption.WithAPIKey(\"My API Key\"),\n\t)\n\tpriceHistory, err := client.PriceTracking.GetHistory(\n\t\tcontext.TODO(),\n\t\t\"canonical_product_id\",\n\t\tchannel3go.PriceTrackingGetHistoryParams{},\n\t)\n\tif err != nil {\n\t\tpanic(err.Error())\n\t}\n\tfmt.Printf(\"%+v\\n\", priceHistory.CanonicalProductID)\n}\n"
        - lang: CLI
          source: |-
            channel3 price-tracking retrieve-history \
              --api-key 'My API Key' \
              --canonical-product-id canonical_product_id
components:
  schemas:
    PriceHistoryResponse:
      properties:
        canonical_product_id:
          type: string
          title: Canonical Product Id
        product_title:
          anyOf:
            - type: string
            - type: 'null'
          title: Product Title
        history:
          items:
            $ref: '#/components/schemas/PriceHistoryPoint'
          type: array
          title: History
          default: []
        statistics:
          anyOf:
            - $ref: '#/components/schemas/PriceStatistics'
            - type: 'null'
      type: object
      required:
        - canonical_product_id
      title: PriceHistoryResponse
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
    PriceHistoryPoint:
      properties:
        timestamp:
          type: string
          format: date-time
          title: Timestamp
        price:
          type: number
          title: Price
        currency:
          type: string
          title: Currency
      type: object
      required:
        - timestamp
        - price
        - currency
      title: PriceHistoryPoint
    PriceStatistics:
      properties:
        mean:
          type: number
          title: Mean
        std_dev:
          type: number
          title: Std Dev
        min_price:
          type: number
          title: Min Price
        max_price:
          type: number
          title: Max Price
        current_price:
          type: number
          title: Current Price
        current_status:
          $ref: '#/components/schemas/PriceStatus'
        currency:
          type: string
          title: Currency
      type: object
      required:
        - mean
        - std_dev
        - min_price
        - max_price
        - current_price
        - current_status
        - currency
      title: PriceStatistics
    PriceStatus:
      type: string
      enum:
        - low
        - typical
        - high
      title: PriceStatus
  securitySchemes:
    APIKeyHeader:
      type: apiKey
      in: header
      name: x-api-key

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.