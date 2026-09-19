#### Release Notes

# Release Notes

## September

### Grok Voice Transcribe 2.0

`grok-voice-transcribe-2.0` is now available. Use `grok-voice-transcribe-1.0` or `grok-voice-transcribe-2.0`; the default is `grok-voice-transcribe-1.0`. See the [Speech to Text docs](/developers/model-capabilities/audio/speech-to-text).

### grok-imagine-image-quality retirement on November 2

On November 2, 2026, `grok-imagine-image-quality` is retired. Requests to the slug will be served by `grok-imagine-image-2.0` with `quality` set to `low`, with no change to the request or response shape and at a lower per-image price. `grok-imagine-image` (1.0) is not affected. See the [migration guide](/developers/migration/imagine-image-quality-nov-2).

## August

### Imagine image API updates

* **Auto quality.** The `quality` parameter on `grok-imagine-image-2.0` now accepts `auto`, and the default when `quality` is omitted has moved from `medium` to `auto`. Auto currently uses `low` for image generation and `medium` for image editing. Images are billed at the quality they are served at. Pass `low` or `medium` explicitly to pin a specific quality. See [Image Generation](/developers/model-capabilities/images/generation#quality).
* **Five reference images.** Image editing now accepts up to 5 source images per request (was 3). See [Multi-Image Editing](/developers/model-capabilities/images/multi-image-editing).
* **New aspect ratios.** Image generation and editing accept `21:9` (cinematic widescreen) and `5:2` (wide banners). See [Image Generation](/developers/model-capabilities/images/generation#aspect-ratio).

### Grok 4.6

Grok 4.6, SpaceXAI's frontier model for coding, agentic tasks, and knowledge work, is now available on the xAI API. It has a 500k context window, text and image inputs with text-only output, and no text output limit. Pricing is $2 / $0.50 / $6 per 1M tokens (input / cached input / output) below 200k prompt tokens, and $4 / $1 / $12 above. Reasoning effort supports low, medium, high (default), and xhigh. See the [Grok 4.6 overview](/developers/grok-4-6) and the [announcement](https://x.ai/news/grok-4-6).

### Grok Bot

Grok Bot is now available. Durable AI teammates that work on a persistent cloud computer, with messaging, approvals, connectors, and routines. See the [Grok Bot overview](/grok-bot/overview) and [Get started](/grok-bot/get-started).

