import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	completionsFor,
	modelRef,
	modelSupportsThinkingLevel,
	parseArgs,
	resolveModel,
	supportedThinkingLevels,
} from "../src/index.ts";

const models = [
	{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true },
	{ provider: "openai", id: "gpt-5.2-codex", reasoning: true, thinkingLevelMap: { xhigh: null } },
	{ provider: "local", id: "qwen3-coder", name: "Qwen Coder", reasoning: false },
	{ provider: "other", id: "qwen3-coder", name: "Qwen Coder Other", reasoning: false },
];

describe("argument parsing", () => {
	it("parses model and thinking level together", () => {
		assert.deepEqual(parseArgs("anthropic/claude-sonnet-4-5:high"), {
			modelQuery: "anthropic/claude-sonnet-4-5",
			thinkingLevel: "high",
		});
	});

	it("parses thinking-only arguments", () => {
		assert.deepEqual(parseArgs("off"), { thinkingLevel: "off" });
	});

	it("treats non-thinking suffixes as part of model query", () => {
		assert.deepEqual(parseArgs("openai/gpt-5.2-codex turbo"), {
			modelQuery: "openai/gpt-5.2-codex turbo",
		});
	});

	it("treats invalid post-colon values as part of model query", () => {
		assert.deepEqual(parseArgs("openai/gpt-5.2-codex:foo"), {
			modelQuery: "openai/gpt-5.2-codex:foo",
		});
	});
});

describe("model resolution", () => {
	it("resolves canonical provider/model references", () => {
		const result = resolveModel({ modelRegistry: {} }, models, "anthropic/claude-sonnet-4-5");
		assert.equal(result.ok, true);
		assert.equal(modelRef(result.model), "anthropic/claude-sonnet-4-5");
	});

	it("uses registry.find for provider/model ids not in the available list", () => {
		const registryModel = { provider: "custom", id: "hidden", reasoning: true };
		const result = resolveModel(
			{ modelRegistry: { find: (provider, id) => (provider === "custom" && id === "hidden" ? registryModel : undefined) } },
			models,
			"custom/hidden",
		);
		assert.equal(result.ok, true);
		assert.equal(result.model, registryModel);
	});

	it("reports ambiguous fuzzy model matches", () => {
		const result = resolveModel({ modelRegistry: {} }, models, "qwen3");
		assert.equal(result.ok, false);
		assert.equal(result.reason, "ambiguous");
		assert.equal(result.matches.length, 2);
	});
});

describe("thinking level support", () => {
	it("only exposes off for non-reasoning models", () => {
		assert.deepEqual(supportedThinkingLevels(models[2]), ["off"]);
		assert.equal(modelSupportsThinkingLevel(models[2], "high"), false);
	});

	it("hides levels marked null in thinkingLevelMap", () => {
		assert.equal(modelSupportsThinkingLevel(models[1], "xhigh"), false);
		assert.deepEqual(supportedThinkingLevels(models[1]), ["off", "minimal", "low", "medium", "high"]);
	});
});

describe("argument completions", () => {
	it("offers model completions for partial model input", () => {
		const completions = completionsFor("sonnet", models);
		assert.ok(completions.some((item) => item.value === "anthropic/claude-sonnet-4-5"));
	});

	it("offers supported thinking levels after an exact provider/model", () => {
		const completions = completionsFor("openai/gpt-5.2-codex:h", models);
		assert.deepEqual(
			completions.map((item) => item.value),
			["openai/gpt-5.2-codex:high"],
		);
	});

	it("offers all supported thinking levels after an exact provider/model with colon", () => {
		const completions = completionsFor("openai/gpt-5.2-codex:", models);
		assert.deepEqual(
			completions.map((item) => item.value),
			["openai/gpt-5.2-codex:off", "openai/gpt-5.2-codex:minimal", "openai/gpt-5.2-codex:low", "openai/gpt-5.2-codex:medium", "openai/gpt-5.2-codex:high"],
		);
	});
});
