> ## Documentation Index
> Fetch the complete documentation index at: https://platform.kimi.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Platform Changelog

> Review historical Kimi Open Platform feature releases, model launches, product improvements, and issue fixes.

This page is updated periodically with Kimi Open Platform product updates and related documentation changes.

<Update label="September 2026">
  ### 🔍 Web Search API

  Launch web searches through `/v1/tools/search` and `/v1/tools/search_pro` and get structured results — ideal for Agent applications that orchestrate their own search logic. Organization- and project-level QPS limits are supported. See [Web Search Basic](/docs/api/tools-search), [Web Search Pro](/docs/api/tools-search-pro), [Web Search Best Practices](/docs/guide/web-search-best-practice), and [Web Search Pricing](/docs/pricing/websearch).

  ### 💰 Billing method change

  Account usage is now deducted at a uniform ratio of 50% cash and 50% vouchers. When either balance is depleted, all subsequent usage is deducted from the remaining balance type. Users with signed contracts follow their contract terms and continue to prioritize voucher usage — they are not affected.
</Update>

<Update label="August 2026">
  * The `kimi-k2.5` and all `moonshot-v1` series models (including `-vision-preview` and `moonshot-v1-auto`) were retired across all platforms. Calls to these models now return a 404 "model not found" error. Please migrate to [Kimi K3](/docs/guide/kimi-k3-quickstart).
  * Files API updates: newly generated file IDs now carry the `file_` prefix; improved parsing of complex content such as tables and formulas; images are no longer OCR'd for text extraction (for image understanding, upload images with `purpose=image`; see [Use Vision Models](/docs/guide/use-kimi-vision-model)); files uploaded with the same name as an existing file are automatically renamed by the server.
</Update>

<Update label="July 2026">
  ### 🚀 Kimi K3 available on the Open Platform API

  Kimi K3 — our flagship model for long-horizon coding and end-to-end knowledge work — is now available through the Open Platform API, with a 1M token context and leading overall intelligence. See the [Kimi K3 Quickstart](/docs/guide/kimi-k3-quickstart). At the same time, `kimi-k2.5` and the `moonshot-v1` series are no longer offered to newly registered users; the Global edition added email verification-code sign-up/login and email & Google account binding management. The account overview now shows current-day spending, and the platform Terms of Service have been updated.
</Update>

<Update label="June 2026">
  * Added organization-level API IP allowlists for finer enterprise security control.
  * Released Kimi K2.7 Code through the Open Platform API, followed by a HighSpeed variant — see the [Kimi K2.7 Code Quickstart](/docs/guide/kimi-k2-7-code-quickstart); custom top-up amounts are now supported.
</Update>

<Update label="May 2026">
  * The `kimi-k2` series (including `kimi-k2-0905-preview`, `kimi-k2-0711-preview`, `kimi-k2-turbo-preview`, `kimi-k2-thinking`, and `kimi-k2-thinking-turbo`) was retired and is no longer maintained or supported. Please migrate to [Kimi K3](/docs/guide/kimi-k3-quickstart).
  * Added automatic balance top-up and top-up amount configuration.
</Update>

<Update label="April 2026">
  * The Batch API is now open to all users for lower-cost large-scale asynchronous inference — see [Use the Batch API](/docs/guide/use-batch-api).
  * Released Kimi K2.6 through the Open Platform API — see the [Kimi K2.6 Quickstart](/docs/guide/kimi-k2-6-quickstart).
</Update>

<Update label="January 2026">
  * Released Kimi K2.5 through the Open Platform API; discontinued `kimi-latest`.
</Update>

<Update label="December 2025">
  * Added organization verification, member invitations, and multi-account organization support to the Global Open Platform.
</Update>

<Update label="November 2025">
  * Released Kimi K2 Thinking and its Turbo variant, increased default TPM limits across tiers, and reduced Kimi Turbo prices; discontinued `kimi-thinking-preview`.
</Update>

<Update label="October 2025">
  * Updated Kimi CLI and K2 quickstart documentation, ended the Kimi Turbo half-price promotion, refreshed K2VV and sales information, and retired manual Context Cache list views.
</Update>

<Update label="September 2025">
  * Launched the `kimi-k2-0905-preview` model.
</Update>

<Update label="August 2025">
  * Released the Kimi K2 high-speed model `kimi-k2-turbo-preview` and launched the Global Open Platform developer forum.
</Update>

<Update label="July 2025">
  * Released the Kimi K2 model `kimi-k2-0711-preview`; launched Kimi Playground with streaming output and third-party and ModelScope MCP server configuration; added API access to Formula Tools and improved Global top-up and voucher terms.
</Update>

<Update label="May 2025">
  * Released the Kimi Thinking model `kimi-thinking-preview`; launched the Global edition of Kimi Open Platform.
</Update>

<Update label="April 2025">
  * Reduced model product pricing; added support for inviting and managing organization members; fixed an issue where the cursor could not move in the name field when creating a project.
</Update>

<Update label="February 2025">
  * Launched the `kimi-latest` model; added support for exporting organization monthly bills; fixed project rate limit display issues; added support for project daily and monthly spending alerts.
</Update>

<Update label="January 2025">
  * Launched the `moonshot-v1-vision-preview` model; added support for organization project management; added support for overseas phone number registration and login.
</Update>

<Update label="December 2024">
  * Optimized the resource management list copy interaction to use hover and click; optimized resource list sorting by upload time, from newest to oldest; added support for multiple accounts under one verified business entity; fixed an invoice cancellation failure issue.
</Update>

<Update label="November 2024">
  * Context Caching is now available to all users, and cache renewal no longer charges the creation fee; added terms and agreements content to the documentation center; fixed frontend flickering after successful payment, invoice cancellation failures, and issues with editing and deleting API Keys.
</Update>

<Update label="September 2024">
  * Added frontend support for file resource management; split phone number rebinding into two frontend verification steps; added verification-code purpose descriptions to SMS messages; fixed an issue where the invoiceable amount was displayed incorrectly and an invoice issuance failure caused by spaces in the tax identification number; added bank transfer processing time display for business verification; added documentation for automatic disconnection and reconnection handling; launched web search.
</Update>

<Update label="August 2024">
  * Launched `moonshot-v1-auto`; added support for custom account balance alerts; added support for phone number rebinding; added support for account password login; reduced Cache storage costs; published the MoonPalace user guide; released the Kimi Enterprise API; added tier level display to basic user information.
</Update>

<Update label="July 2024">
  * Launched the Context Caching public beta and gradually expanded it, adding practice blogs and the developer community; released MoonPalace, the Kimi API debugging tool, along with user spending analysis and organization verification capabilities.
</Update>

<Update label="June 2024">
  * Optimized the API Key count limit; published the first Context Caching practice blog for Kimi API Assistant; published the "Affordable Long-Text Processing" blog; added support for voucher validity periods.
</Update>

<Update label="May 2024">
  * Launched the Blog space; added Dark Mode support for Open Platform; launched invoice management.
</Update>

<Update label="April 2024">
  * Launched Tool Calling; launched identity verification; added support for the balance monitoring API.
</Update>
