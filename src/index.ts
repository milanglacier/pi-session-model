import { SettingsManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type Model = NonNullable<ExtensionContext["model"]>;

type AutocompleteItem = {
	value: string;
	label: string;
	description?: string;
};

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVEL_SET.has(value);
}

function modelRef(model: Model): string {
	return `${model.provider}/${model.id}`;
}

/**
 * Match pi's built-in fuzzy autocomplete semantics: all query characters must
 * appear in order, space-separated tokens must all match, and lower scores sort
 * first. Kept local to avoid adding a direct dependency on pi-tui.
 */
function fuzzyMatch(query: string, text: string): { matches: boolean; score: number } {
	const queryLower = query.toLowerCase();
	const textLower = text.toLowerCase();

	const matchQuery = (normalizedQuery: string): { matches: boolean; score: number } => {
		if (normalizedQuery.length === 0) {
			return { matches: true, score: 0 };
		}
		if (normalizedQuery.length > textLower.length) {
			return { matches: false, score: 0 };
		}

		let queryIndex = 0;
		let score = 0;
		let lastMatchIndex = -1;
		let consecutiveMatches = 0;

		for (let i = 0; i < textLower.length && queryIndex < normalizedQuery.length; i++) {
			if (textLower[i] !== normalizedQuery[queryIndex]) continue;

			const previous = textLower[i - 1] ?? "";
			const isWordBoundary = i === 0 || /[\s\-_./:]/.test(previous);

			if (lastMatchIndex === i - 1) {
				consecutiveMatches++;
				score -= consecutiveMatches * 5;
			} else {
				consecutiveMatches = 0;
				if (lastMatchIndex >= 0) {
					score += (i - lastMatchIndex - 1) * 2;
				}
			}

			if (isWordBoundary) {
				score -= 10;
			}
			score += i * 0.1;
			lastMatchIndex = i;
			queryIndex++;
		}

		if (queryIndex < normalizedQuery.length) {
			return { matches: false, score: 0 };
		}
		if (normalizedQuery === textLower) {
			score -= 100;
		}
		return { matches: true, score };
	};

	const primaryMatch = matchQuery(queryLower);
	if (primaryMatch.matches) {
		return primaryMatch;
	}

	const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
	const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
	const swappedQuery = alphaNumericMatch
		? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}`
		: numericAlphaMatch
			? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}`
			: "";

	if (!swappedQuery) {
		return primaryMatch;
	}

	const swappedMatch = matchQuery(swappedQuery);
	if (!swappedMatch.matches) {
		return primaryMatch;
	}
	return { matches: true, score: swappedMatch.score + 5 };
}

function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
	if (!query.trim()) {
		return items;
	}

	const tokens = query
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0);
	if (tokens.length === 0) {
		return items;
	}

	const results: Array<{ item: T; totalScore: number }> = [];
	for (const item of items) {
		const text = getText(item);
		let totalScore = 0;
		let allMatch = true;

		for (const token of tokens) {
			const match = fuzzyMatch(token, text);
			if (!match.matches) {
				allMatch = false;
				break;
			}
			totalScore += match.score;
		}

		if (allMatch) {
			results.push({ item, totalScore });
		}
	}

	results.sort((a, b) => a.totalScore - b.totalScore);
	return results.map((result) => result.item);
}

function getAllModels(ctx: ExtensionCommandContext): Model[] {
	ctx.modelRegistry.refresh?.();
	return ctx.modelRegistry.getAll?.() ?? [];
}

function findExactModelReference(reference: string, models: Model[]): Model | undefined {
	const trimmed = reference.trim();
	if (!trimmed) return undefined;

	if (trimmed.includes("/")) {
		const slash = trimmed.indexOf("/");
		const provider = trimmed.slice(0, slash);
		const modelId = trimmed.slice(slash + 1);
		return models.find((model) => model.provider === provider && model.id === modelId);
	}

	const byId = models.filter((model) => model.id === trimmed);
	return byId.length === 1 ? byId[0] : undefined;
}

export type ParsedSessionModelArgument =
	| { ok: true; model: Model; thinkingLevel?: ThinkingLevel }
	| { ok: false; error: string };

export function parseSessionModelArgument(input: string, models: Model[]): ParsedSessionModelArgument {
	const arg = input.trim();
	if (!arg) {
		return { ok: false, error: "Usage: /session-model <provider>/<model>[:thinking-level]" };
	}

	// First try the whole argument, so model IDs containing ':' still work.
	const exact = findExactModelReference(arg, models);
	if (exact) {
		return { ok: true, model: exact };
	}

	const colon = arg.lastIndexOf(":");
	if (colon >= 0) {
		const modelPart = arg.slice(0, colon);
		const thinkingPart = arg.slice(colon + 1);
		const model = findExactModelReference(modelPart, models);

		if (model && !isThinkingLevel(thinkingPart)) {
			return {
				ok: false,
				error: `Invalid thinking level "${thinkingPart}". Expected one of: ${THINKING_LEVELS.join(", ")}`,
			};
		}

		if (model && isThinkingLevel(thinkingPart)) {
			return { ok: true, model, thinkingLevel: thinkingPart };
		}
	}

	return { ok: false, error: `Model not found: ${arg}` };
}

export function getSessionModelCompletions(prefix: string, models: Model[]): AutocompleteItem[] | null {
	const arg = prefix.trimStart();

	// Deliberately do not complete thinking levels after ':'.
	if (arg.includes(":")) return null;

	const items = models.map((model) => ({
		id: model.id,
		provider: model.provider,
		label: modelRef(model),
	}));

	// Match the built-in /model completion: complete directly to provider/model,
	// and fuzzy-filter by model id plus provider name (e.g. "opus anthropic").
	const filtered = fuzzyFilter(items, arg, (item) => `${item.id} ${item.provider}`);
	if (filtered.length === 0) return null;

	return filtered.map((item) => ({
		value: item.label,
		label: item.id,
		description: item.provider,
	}));
}

async function withRestoredGlobalSelectionSettings<T>(fn: () => Promise<T> | T): Promise<T> {
	const settingsPrototype = SettingsManager.prototype as unknown as Record<string, unknown>;
	const methodNames = [
		"setDefaultModelAndProvider",
		"setDefaultProvider",
		"setDefaultModel",
		"setDefaultThinkingLevel",
	] as const;
	const originals = new Map<string, unknown>();

	// On pi versions where runtime model/thinking APIs still persist defaults, suppress
	// those specific writes while the command is applying its session-local change.
	for (const name of methodNames) {
		if (typeof settingsPrototype[name] === "function") {
			originals.set(name, settingsPrototype[name]);
			settingsPrototype[name] = () => undefined;
		}
	}

	try {
		return await fn();
	} finally {
		for (const [name, original] of originals) {
			settingsPrototype[name] = original;
		}
	}
}

async function applySessionModel(pi: ExtensionAPI, ctx: ExtensionCommandContext, arg: string): Promise<void> {
	const models = getAllModels(ctx);
	const parsed = parseSessionModelArgument(arg, models);
	if (!parsed.ok) {
		ctx.ui.notify(parsed.error, "error");
		return;
	}

	const previousThinking = pi.getThinkingLevel();
	const success = await withRestoredGlobalSelectionSettings(async () => {
		const modelSelected = await pi.setModel(parsed.model);
		if (modelSelected && parsed.thinkingLevel) {
			pi.setThinkingLevel(parsed.thinkingLevel);
		}
		return modelSelected;
	});
	if (!success) {
		ctx.ui.notify(`No API key for ${modelRef(parsed.model)}`, "error");
		return;
	}

	const finalThinking = pi.getThinkingLevel();
	const thinkingText = parsed.thinkingLevel
		? ` (thinking: ${finalThinking}${finalThinking !== parsed.thinkingLevel ? `, clamped from ${parsed.thinkingLevel}` : ""})`
		: finalThinking !== previousThinking
			? ` (thinking: ${finalThinking})`
			: "";

	ctx.ui.notify(`Session model: ${modelRef(parsed.model)}${thinkingText}`, "info");
}

export default function sessionModelExtension(pi: ExtensionAPI) {
	let cachedModels: Model[] = [];

	pi.on("session_start", (_event, ctx) => {
		cachedModels = getAllModels(ctx as ExtensionCommandContext);
	});

	pi.registerCommand("session-model", {
		description: "Switch model/thinking for this session without changing global settings",
		getArgumentCompletions: (prefix: string) => getSessionModelCompletions(prefix, cachedModels),
		handler: async (args, ctx) => {
			cachedModels = getAllModels(ctx);
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Please provide a model, e.g. /session-model openai/gpt-4o", "warning");
				return;
			}

			await applySessionModel(pi, ctx, trimmed);
		},
	});
}
