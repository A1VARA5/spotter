> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Stop Tracking

> Stop tracking prices for a canonical product.



## OpenAPI

````yaml post /v0/price-tracking/stop
openapi: 3.1.0
info:
  title: FastAPI
  version: 0.1.0
servers:
  - url: https://api.trychannel3.com
    description: Production
security: []
paths:
  /v0/price-tracking/stop:
    post:
      tags:
        - price-tracking
      summary: Stop Tracking
      description: Stop tracking prices for a canonical product.
      operationId: stop_tracking_v0_price_tracking_stop_post
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/StopTrackingRequest'
        required: true
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SubscriptionResponse'
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
                detail: No active subscription for canonical product xyz123
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

            const subscription = await client.priceTracking.stop({
              canonical_product_id: 'canonical_product_id',
            });

            console.log(subscription.canonical_product_id);
        - lang: Python
          source: |-
            import os
            from channel3_sdk import Channel3

            client = Channel3(
                api_key=os.environ.get("CHANNEL3_API_KEY"),  # This is the default and can be omitted
            )
            subscription = client.price_tracking.stop(
                canonical_product_id="canonical_product_id",
            )
            print(subscription.canonical_product_id)
        - lang: Go
          source: "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\n\t\"github.com/channel3-ai/sdk-go\"\n\t\"github.com/channel3-ai/sdk-go/option\"\n)\n\nfunc main() {\n\tclient := channel3go.NewClient(\n\t\toption.WithAPIKey(\"My API Key\"),\n\t)\n\tsubscription, err := client.PriceTracking.Stop(context.TODO(), channel3go.PriceTrackingStopParams{\n\t\tStopTrackingRequest: channel3go.StopTrackingRequestParam{\n\t\t\tCanonicalProductID: \"canonical_product_id\",\n\t\t},\n\t})\n\tif err != nil {\n\t\tpanic(err.Error())\n\t}\n\tfmt.Printf(\"%+v\\n\", subscription.CanonicalProductID)\n}\n"
        - lang: CLI
          source: |-
            channel3 price-tracking stop \
              --api-key 'My API Key' \
              --canonical-product-id canonical_product_id
components:
  schemas:
    StopTrackingRequest:
      properties:
        canonical_product_id:
          type: string
          title: Canonical Product Id
      type: object
      required:
        - canonical_product_id
      title: StopTrackingRequest
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