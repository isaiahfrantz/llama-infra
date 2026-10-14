# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-10-14

### Added

- **halogen vision detection** — the extension already read `GET /health` for the context window; it now also reads `vision.enabled`, so a halogen model that serves images registers as image-capable (👁️ badge, `input: ["text", "image"]`) with no `modelOptions[id].vision` override.
- **Thinking on/off on llama.cpp-family servers (halogen included)** — `makeCompat()` now exposes `thinkingFormat: "qwen-chat-template"`, so pi sends `chat_template_kwargs: { enable_thinking, preserve_thinking }`. This is what lets halogen's default `reasoning_effort="xhigh"` be turned **off** at the `off` level (answers were otherwise all reasoning with empty content); thinking levels still send the per-level `thinking_budget_tokens`.

### Changed

- `fetchEngineHealth()` extracted from the halogen `/health` probe and now returns `{ context, vision }`; `applyHalogenHealth()` grafts the context (sticky per `host:port`) and returns the health so the vision flag reaches `buildModelMetadata()`.
- `CompatProfile` gained the `thinkingFormat` field (currently `qwen-chat-template`).

### Tests

- `test/halogen.test.ts` — `/health` parsing, sticky context, vision in metadata (and manual override), the new compat thinking format, and end-to-end halogen registration.

## [1.7.0] - 2026-09-30

### Added

- Per-model `modelOptions[id].thinkingBudgetField` to override the top-level request field that carries the thinking budget, plus a **🔤 Budget field** entry in the `🧠 Thinking budgets` config menu. Use it to force vLLM's `thinking_token_budget` on a server whose kind cannot be detected (renamed wrapper, remote SGLang/TGI).

### Fixed

- vLLM **silently ignored** llama.cpp's `thinking_budget_tokens` (the name pi puts on the payload by default), so changing the thinking level looked like a no-op. llama-infra now renames that field to the engine's field (`thinking_token_budget` on vLLM) inside the `before_provider_request` hook, and `makeCompat()` exposes the right `thinkingTokenBudgetField` per server kind — including the per-model override — so pi sends the correct field directly.
- `test/vllm.test.ts` tag regression: the fixture mixed a server host of `other-host:9000` with a model id embedding `gpu-host:8000`, so the double-tag assertions could never pass; the fixture now matches the implementation.

### Tests

- `test/vllm-thinking.test.ts`

## [1.6.3] - 2026-09-29

### Fixed

- The footer speed reading (⚡ prefill / 🔥 generation) no longer flickers — llama-infra keeps the last measured rates on the status line between requests and turns instead of resetting them and blinking through `⚡…`/`🔥…` placeholders and the idle `⏸`; the placeholders only appear before the first measurement.

### Tests

- `test/speed-footer.test.ts`

## [1.6.2] - 2026-09-29

### Fixed

- The tools-aware `max_tokens` clamp now runs on the final request body via the provider's `options.onPayload` (which includes tool schemas), not only the `before_provider_request` hook, so tool-heavy requests to strict engines (vLLM/SGLang) no longer overflow the context window (`prompt + max_tokens = max_model_len + 1`); tool-schema JSON is estimated at ~3.5 chars/token; this also covers nested `ctx.modelRegistry.streamSimple()` calls.

### Tests

- `test/request-clamp.test.ts`

## [1.6.1] - 2026-09-29

### Fixed

- pi's `estimateContextTokens()` ignores tool schemas, so tool-heavy requests could exceed the served context and strict engines (vLLM/SGLang) returned HTTP 400 right after compaction; llama-infra now recomputes `max_tokens` in a `before_provider_request` hook from a full-payload estimate (messages + tool schemas, images at a flat cost, base64 skipped) with a 4096-token reserve, lowering the requested output only when needed and never raising it above `modelOptions[id].maxTokens`.

### Tests

- `test/request-clamp.test.ts`

## [1.6.0] - 2026-09-28

### Added

- Per-model output cap via `modelOptions[id].maxTokens`. The per-model cap wins over the server-reported `max_tokens` and over `settings.maxOutputTokens`, and is clamped to the model's `contextWindow`.
- 📏 **Output caps** config menu to view and edit per-model output caps from the native config UI.

### Fixed

- vLLM vision detection now treats local engine args as ground truth: `--language-model-only` and `--limit-mm-per-prompt {"image":N}` are honored.
- OpenAI-compatible wrappers not named `vllm` are now recognized via `looksLikeOpenAiEngine`, so image-capable vLLM models register with `input: ["text", "image"]`.

### Tests

- `test/maxtokens.test.ts`
- `test/outputcaps.test.ts`
- `test/vllm-vision.test.ts`

[1.7.0]: https://github.com/noguerol/llama-infra/compare/v1.6.3...v1.7.0
[1.6.3]: https://github.com/noguerol/llama-infra/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/noguerol/llama-infra/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/noguerol/llama-infra/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/noguerol/llama-infra/compare/v1.5.4...v1.6.0
