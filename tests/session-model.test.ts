import test from "node:test";
import assert from "node:assert/strict";
import { getSessionModelCompletions, parseSessionModelArgument } from "../src/index.ts";

// Test fixtures don't need the full Model type from pi-ai — only the fields
// consumed by parseSessionModelArgument / getSessionModelCompletions.
const models = [
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true },
  { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5", reasoning: true },
  { provider: "openai", id: "gpt-5.2-codex", name: "GPT 5.2 Codex", reasoning: true },
  { provider: "openrouter", id: "vendor/model:exacto", name: "Colon Model", reasoning: false },
] as any;

test("parses provider/model", () => {
  const result = parseSessionModelArgument("anthropic/claude-sonnet-4-5", models);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, "claude-sonnet-4-5");
  assert.equal(result.thinkingLevel, undefined);
});

test("parses provider/model:thinking-level", () => {
  const result = parseSessionModelArgument("anthropic/claude-sonnet-4-5:high", models);
  assert.equal(result.ok, true);
  assert.equal(result.model.provider, "anthropic");
  assert.equal(result.thinkingLevel, "high");
});

test("keeps colons that are part of exact model ids", () => {
  const result = parseSessionModelArgument("openrouter/vendor/model:exacto", models);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, "vendor/model:exacto");
  assert.equal(result.thinkingLevel, undefined);
});

test("rejects invalid thinking level when model part exists", () => {
  const result = parseSessionModelArgument("anthropic/claude-sonnet-4-5:extreme", models);
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid thinking level/);
});

test("completes directly from provider name", () => {
  const completions = getSessionModelCompletions("anthropic", models);
  assert.deepEqual(completions?.map((item) => item.value), [
    "anthropic/claude-opus-4-5",
    "anthropic/claude-sonnet-4-5",
  ]);
  assert.deepEqual(completions?.map((item) => item.label), ["claude-opus-4-5", "claude-sonnet-4-5"]);
  assert.deepEqual(completions?.map((item) => item.description), ["anthropic", "anthropic"]);
});

test("completes directly from model id", () => {
  const completions = getSessionModelCompletions("claude-s", models);
  assert.deepEqual(completions?.map((item) => item.value), [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-opus-4-5",
  ]);
});

test("completes from combined model and provider tokens", () => {
  const completions = getSessionModelCompletions("opus anthropic", models);
  assert.deepEqual(completions?.map((item) => item.value), ["anthropic/claude-opus-4-5"]);
});

test("does not complete thinking levels", () => {
  assert.equal(getSessionModelCompletions("anthropic/claude-sonnet-4-5:", models), null);
});
