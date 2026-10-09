> ## Documentation Index
> Fetch the complete documentation index at: https://docs.trychannel3.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Websites

> Resolve a website URL to its ID and best_commission_rate. Tip: website_ids filters accept domains directly, so this lookup is most useful for retrieving commission rates.



## OpenAPI

````yaml get /v0/websites
openapi: 3.1.0
info:
  title: FastAPI
  version: 0.1.0
servers:
  - url: https://api.trychannel3.com
    description: Production
security: []
paths:
  /v0/websites:
    get:
      tags:
        - channel3-api
      summary: Websites
      description: >-
        Resolve a website URL to its ID and best_commission_rate. Tip:
        website_ids filters accept domains directly, so this lookup is most
        useful for retrieving commission rates.
      operationId: find_website_by_url_v0_websites_get
      parameters:
        - name: query
          in: query
          required: true
          schema:
            type: string
            title: Query
        - name: country
          in: query
          required: false
          schema:
            anyOf:
              - $ref: '#/components/schemas/CountryCode'
              - type: 'null'
            description: >-
              ISO 3166-1 alpha-2 country code that `best_commission_rate` is
              scoped to. Defaults to 'US' when unset.
            title: Country
          description: >-
            ISO 3166-1 alpha-2 country code that `best_commission_rate` is
            scoped to. Defaults to 'US' when unset.
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                anyOf:
                  - $ref: '#/components/schemas/Website'
                  - type: 'null'
                title: Response Find Website By Url V0 Websites Get
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
          description: Website not found
          content:
            application/json:
              example:
                detail: No website found matching 'acme'
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

            const website = await client.websites.retrieve({ query: 'query' });

            console.log(website.id);
        - lang: Python
          source: |-
            import os
            from channel3_sdk import Channel3

            client = Channel3(
                api_key=os.environ.get("CHANNEL3_API_KEY"),  # This is the default and can be omitted
            )
            website = client.websites.retrieve(
                query="query",
            )
            print(website.id)
        - lang: Go
          source: "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\n\t\"github.com/channel3-ai/sdk-go\"\n\t\"github.com/channel3-ai/sdk-go/option\"\n)\n\nfunc main() {\n\tclient := channel3go.NewClient(\n\t\toption.WithAPIKey(\"My API Key\"),\n\t)\n\twebsite, err := client.Websites.Get(context.TODO(), channel3go.WebsiteGetParams{\n\t\tQuery: \"query\",\n\t})\n\tif err != nil {\n\t\tpanic(err.Error())\n\t}\n\tfmt.Printf(\"%+v\\n\", website.ID)\n}\n"
        - lang: CLI
          source: |-
            channel3 websites retrieve \
              --api-key 'My API Key' \
              --query query
components:
  schemas:
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
    Website:
      properties:
        id:
          type: string
          title: Id
        url:
          type: string
          title: Url
        best_commission_rate:
          type: number
          title: Best Commission Rate
          description: >-
            The maximum commission rate for the website in the requested country
            (default 'US'), as a percentage
          default: 0
      type: object
      required:
        - id
        - url
      title: Website
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
  securitySchemes:
    APIKeyHeader:
      type: apiKey
      in: header
      name: x-api-key

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.