// Behavior tests for halogen runtime support: engine /health parsing
// (context + vision.enabled), the sticky-context graft, vision surfacing in
// buildModelMetadata, the qwen-chat-template thinking format pi uses to turn
// thinking off/on, and the end-to-end registration of a halogen model.
// Uses a throwaway localhost HTTP server, no external network.
// Run: node --experimental-strip-types test/halogen.test.ts

import * as http from "node:http";
import { DEFAULT_SETTINGS, makeCompat, setActiveConfig, shared } from "../src/core.ts";
import { applyHalogenHealth, buildModelMetadata, fetchEngineHealth } from "../src/scan.ts";
import { buildAndRegisterProvider } from "../src/registration.ts";
import type { InfraConfig, LlamaCppModel, ScanResult } from "../src/types.ts";

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		failures++;
		console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// ── Throwaway halogen-ish HTTP server ──────────────────────────────────────
interface FakeHealth {
	context?: number;
	slot_ctx?: number;
	vision?: { enabled?: boolean };
}

let healthMode: "ok" | "no-vision" | "error" = "ok";
let healthBody: FakeHealth = { context: 262144, slot_ctx: 262144, vision: { enabled: true } };

const server = http.createServer((req, res) => {
	if (req.url?.startsWith("/health")) {
		if (healthMode === "error") {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "busy" }));
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(healthBody));
		return;
	}
	res.writeHead(404, { "content-type": "application/json" });
	res.end("{}");
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
const baseUrl = `http://127.0.0.1:${port}/v1`;

// ── 1) fetchEngineHealth parses halogen's /health ──────────────────────────
console.log("halogen: fetchEngineHealth");

const health = await fetchEngineHealth(baseUrl, 2000);
check("reads /health context", health?.context === 262144, String(health?.context));
check("reads /health.vision.enabled", health?.vision === true, String(health?.vision));

healthMode = "no-vision";
healthBody = { slot_ctx: 131072 };
const noVision = await fetchEngineHealth(baseUrl, 2000);
check("slot_ctx preferred over context", noVision?.context === 131072, String(noVision?.context));
check("vision undefined when /health reports none", noVision?.vision === undefined, String(noVision?.vision));

healthMode = "error";
const errored = await fetchEngineHealth(baseUrl, 2000);
check("non-2xx /health → undefined", errored === undefined, String(errored));

// ── 2) applyHalogenHealth: context graft + sticky fallback ─────────────────
console.log("halogen: applyHalogenHealth sticky context");

shared.halogenCtx.clear();
healthMode = "ok";
healthBody = { slot_ctx: 262144, vision: { enabled: true } };
const halogenModels: LlamaCppModel[] = [{ id: "halogen-example-model", object: "model", owned_by: "halogen" }];
const grafted = await applyHalogenHealth(baseUrl, halogenModels, 2000, undefined, "example-host:8080");
check("grafts meta.n_ctx from /health", halogenModels[0].meta?.n_ctx === 262144, String(halogenModels[0].meta?.n_ctx));
check("grafts max_model_len from /health", halogenModels[0].max_model_len === 262144, String(halogenModels[0].max_model_len));
check("returns vision to the caller", grafted?.vision === true, String(grafted?.vision));

healthMode = "error";
const stalled: LlamaCppModel[] = [{ id: "halogen-example-model", object: "model", owned_by: "halogen" }];
await applyHalogenHealth(baseUrl, stalled, 2000, undefined, "example-host:8080");
check("sticky context reused when /health stalls", stalled[0].meta?.n_ctx === 262144, String(stalled[0].meta?.n_ctx));
shared.halogenCtx.clear();

// ── 3) buildModelMetadata surfaces /health vision ──────────────────────────
console.log("halogen: buildModelMetadata vision");

setActiveConfig({ servers: [], settings: { ...DEFAULT_SETTINGS }, modelOptions: {} });
shared.compactModelIds.clear();
const plain: LlamaCppModel = { id: "halogen-example-model", object: "model", owned_by: "halogen" };

const textOnly = buildModelMetadata("halogen-example-model", plain, undefined, undefined, "llamacpp");
check("no health → vision undefined", textOnly.vision === undefined, String(textOnly.vision));

const withVision = buildModelMetadata(
	"halogen-example-model",
	plain,
	undefined,
	undefined,
	"llamacpp",
	{ vision: true },
);
check("health.vision=true → meta.vision true", withVision.vision === true, String(withVision.vision));

// Manual override still wins over /health.
setActiveConfig({
	servers: [],
	settings: { ...DEFAULT_SETTINGS },
	modelOptions: { "halogen-example-model": { vision: false } },
});
const overridden = buildModelMetadata(
	"halogen-example-model",
	plain,
	undefined,
	undefined,
	"llamacpp",
	{ vision: true },
);
check("modelOptions vision:false wins over /health", overridden.vision === false, String(overridden.vision));

// ── 4) makeCompat: qwen-chat-template thinking control ─────────────────────
console.log("halogen: makeCompat thinking format");

check(
	"makeCompat('llamacpp') → thinkingFormat qwen-chat-template",
	makeCompat("llamacpp").thinkingFormat === "qwen-chat-template",
	String(makeCompat("llamacpp").thinkingFormat),
);
check(
	"llama.cpp keeps its thinking_budget_tokens field",
	makeCompat("llamacpp").thinkingTokenBudgetField === "thinking_budget_tokens",
	String(makeCompat("llamacpp").thinkingTokenBudgetField),
);
check("vLLM does not use the qwen chat-template format", makeCompat("vllm").thinkingFormat === undefined);
check("LM Studio stays thinking-free", makeCompat("lmstudio").thinkingFormat === undefined);

// ── 5) End-to-end registration of a halogen endpoint ───────────────────────
console.log("halogen: registration");

setActiveConfig({
	servers: [{ id: "example-host", host: "example-host", ports: [8080], enabled: true }],
	settings: { ...DEFAULT_SETTINGS },
	modelOptions: {},
});
shared.serverModelIds.clear();
shared.compactModelIds.clear();
shared.endpointKinds.clear();
shared.modelBaseUrls.clear();

let registered: any;
const pi: any = {
	unregisterProvider: () => undefined,
	registerProvider: (_name: string, cfg: any) => {
		registered = cfg;
	},
};

const regConfig: InfraConfig = {
	servers: [{ id: "example-host", host: "example-host", ports: [8080], enabled: true }],
	settings: { ...DEFAULT_SETTINGS },
	modelOptions: {},
};

const scan: ScanResult = {
	totalModels: 1,
	serversUp: 1,
	serversTotal: 1,
	endpoints: [
		{
			ok: true,
			serverId: "example-host",
			label: "example-host",
			host: "example-host",
			port: 8080,
			baseUrl: "http://example-host:8080/v1",
			// halogen is classified as llama.cpp family (no own kind).
			server: "llamacpp",
			mode: "single",
			latencyMs: 1,
			models: [{ id: "halogen-example-model", object: "model", owned_by: "halogen", meta: { n_ctx: 262144 } }],
			meta: new Map([["halogen-example-model", { vision: true }]]),
		},
	],
};

const models = buildAndRegisterProvider(pi, scan, regConfig, { persistCache: false });
const model = models[0];
check("halogen model registered", model?.serverModelId === "halogen-example-model", String(model?.serverModelId));
check("vision → input includes image", model?.input.includes("image") === true, JSON.stringify(model?.input));
check("registered with the real context", model?.contextWindow === 262144, String(model?.contextWindow));
check(
	"registered compat carries the qwen chat-template thinking format",
	model?.compat?.thinkingFormat === "qwen-chat-template",
	String(model?.compat?.thinkingFormat),
);
check("provider streamSimple still wired", typeof registered?.streamSimple === "function");

await new Promise<void>((resolve) => server.close(() => resolve()));

if (failures > 0) {
	console.error(`\nhalogen tests failed: ${failures}`);
	process.exit(1);
}
console.log("\nAll halogen checks passed ✅");
