> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# List Subscriptions

> List your active price tracking subscriptions.



## OpenAPI

````yaml get /v0/price-tracking/subscriptions
openapi: 3.1.0
info:
  title: FastAPI
  version: 0.1.0
servers:
  - url: https://api.trychannel3.com
    description: Production
security: []
paths:
  /v0/price-tracking/subscriptions:
    get:
      tags:
        - price-tracking
      summary: List Subscriptions
      description: List your active price tracking subscriptions.
      operationId: list_subscriptions_v0_price_tracking_subscriptions_get
      parameters:
        - name: cursor
          in: query
          required: false
          schema:
            anyOf:
              - type: string
              - type: 'null'
            description: Pagination cursor
            title: Cursor
          description: Pagination cursor
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            maximum: 100
            minimum: 1
            description: Max results (1-100)
            default: 20
            title: Limit
          description: Max results (1-100)
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaginatedSubscriptionsResponse'
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


            // Automatically fetches more pages as needed.

            for await (const subscription of
            client.priceTracking.listSubscriptions()) {
              console.log(subscription.canonical_product_id);
            }
        - lang: Python
          source: |-
            import os
            from channel3_sdk import Channel3

            client = Channel3(
                api_key=os.environ.get("CHANNEL3_API_KEY"),  # This is the default and can be omitted
            )
            page = client.price_tracking.list_subscriptions()
            page = page.items[0]
            print(page.canonical_product_id)
        - lang: Go
          source: "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\n\t\"github.com/channel3-ai/sdk-go\"\n\t\"github.com/channel3-ai/sdk-go/option\"\n)\n\nfunc main() {\n\tclient := channel3go.NewClient(\n\t\toption.WithAPIKey(\"My API Key\"),\n\t)\n\tpage, err := client.PriceTracking.ListSubscriptions(context.TODO(), channel3go.PriceTrackingListSubscriptionsParams{})\n\tif err != nil {\n\t\tpanic(err.Error())\n\t}\n\tfmt.Printf(\"%+v\\n\", page)\n}\n"
        - lang: CLI
          source: |-
            channel3 price-tracking list-subscriptions \
              --api-key 'My API Key'
components:
  schemas:
    PaginatedSubscriptionsResponse:
      properties:
        items:
          items:
            $ref: '#/components/schemas/SubscriptionResponse'
          type: array
          title: Items
        next_cursor:
          anyOf:
            - type: string
            - type: 'null'
          title: Next Cursor
      type: object
      required:
        - items
      title: PaginatedSubscriptionsResponse
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
    SubscriptionResponse:
      properties:
        canonical_product_id:
          type: string
          title: Canonical Product Id
        subscription_status:
          $ref: '#/components/schemas/SubscriptionStatus'
        created_at:
          type: string
          format: date-time
          title: Created At
      type: object
      required:
        - canonical_product_id
        - subscription_status
        - created_at
      title: SubscriptionResponse
    SubscriptionStatus:
      type: string
      enum:
        - active
        - cancelled
      title: SubscriptionStatus
  securitySchemes:
    APIKeyHeader:
      type: apiKey
      in: header
      name: x-api-key

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.