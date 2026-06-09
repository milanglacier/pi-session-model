import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type PiModel = {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

export type ResolveResult =
	| { ok: true; model: PiModel }
	| { ok: false; reason: "not-found" | "ambiguous"; matches?: PiModel[] };

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function isThinkingLevel(value: string): value is ThinkingLevel {
	return (THINKING_LEVELS as readonly string[]).includes(value);
}

export function modelRef(model: PiModel): string {
	return `${model.provider}/${model.id}`;
}

export function modelLabel(model: PiModel): string {
	return model.name && model.name !== model.id ? `${modelRef(model)} (${model.name})` : modelRef(model);
}

export function modelSupportsThinkingLevel(model: PiModel, level: ThinkingLevel): boolean {
	if (model.thinkingLevelMap?.[level] === null) return false;
	if (!model.reasoning) return level === "off";
	return true;
}

export function supportedThinkingLevels(model: PiModel): ThinkingLevel[] {
	return THINKING_LEVELS.filter((level) => modelSupportsThinkingLevel(model, level));
}

export function parseArgs(args: string): { modelQuery?: string; thinkingLevel?: ThinkingLevel } {
	const trimmed = args.trim();
	if (!trimmed) return {};

	const colonIndex = trimmed.lastIndexOf(":");
	if (colonIndex > 0) {
		const modelQuery = trimmed.slice(0, colonIndex).trim();
		const afterColon = trimmed.slice(colonIndex + 1).trim();
		if (afterColon && isThinkingLevel(afterColon)) {
			return modelQuery ? { modelQuery, thinkingLevel: afterColon } : { thinkingLevel: afterColon };
		}
	}

	if (isThinkingLevel(trimmed)) {
		return { thinkingLevel: trimmed };
	}

	return { modelQuery: trimmed };
}

export function findByProviderRef(models: PiModel[], query: string): PiModel | undefined {
	const slash = query.indexOf("/");
	if (slash <= 0) return undefined;

	const provider = query.slice(0, slash);
	const id = query.slice(slash + 1);
	return models.find((model) => model.provider === provider && model.id === id);
}

export function rankMatches(models: PiModel[], query: string): PiModel[] {
	const needle = query.toLowerCase();
	const searchable = (model: PiModel) => [modelRef(model), model.id, model.name ?? ""];

	const exact = models.filter((model) => searchable(model).some((value) => value === query));
	if (exact.length > 0) return exact;

	const exactInsensitive = models.filter((model) => searchable(model).some((value) => value.toLowerCase() === needle));
	if (exactInsensitive.length > 0) return exactInsensitive;

	return models.filter((model) => searchable(model).some((value) => value.toLowerCase().includes(needle)));
}

export function resolveModel(ctx: ExtensionContext, models: PiModel[], query: string): ResolveResult {
	const providerRefMatch = findByProviderRef(models, query);
	if (providerRefMatch) return { ok: true, model: providerRefMatch };

	const slash = query.indexOf("/");
	if (slash > 0 && typeof ctx.modelRegistry?.find === "function") {
		const provider = query.slice(0, slash);
		const id = query.slice(slash + 1);
		const model = ctx.modelRegistry.find(provider, id) as PiModel | undefined;
		if (model) return { ok: true, model };
	}

	const matches = rankMatches(models, query);
	if (matches.length === 1) return { ok: true, model: matches[0] };
	if (matches.length > 1) return { ok: false, reason: "ambiguous", matches };
	return { ok: false, reason: "not-found" };
}

async function loadModels(ctx: ExtensionContext): Promise<PiModel[]> {
	const registry = ctx.modelRegistry;

	if (typeof registry?.getAvailable === "function") {
		return (await registry.getAvailable()) as PiModel[];
	}
	if (typeof registry?.getAll === "function") {
		return (await registry.getAll()) as PiModel[];
	}
	if (typeof registry?.list === "function") {
		return (await registry.list()) as PiModel[];
	}
	if (Array.isArray(registry?.models)) {
		return registry.models as PiModel[];
	}

	return [];
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") {
	if ((ctx as { hasUI?: boolean }).hasUI === false) {
		console.log(message);
		return;
	}
	if (ctx.ui?.notify) ctx.ui.notify(message, level);
	else console.log(message);
}

function usage(current?: string): string {
	return [
		"Usage:",
		"  /session-model",
		"  /session-model <provider>/<model>",
		"  /session-model <provider>/<model>:<off|minimal|low|medium|high|xhigh>",
		"  /session-model <off|minimal|low|medium|high|xhigh>",
		current ? `\nCurrent: ${current}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

async function applySelection(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	model: PiModel | undefined,
	thinkingLevel: ThinkingLevel | undefined,
): Promise<void> {
	if (model) {
		const changed = await pi.setModel(model);
		if (!changed) {
			notify(ctx, `No API key or credentials are available for ${modelRef(model)}.`, "error");
			return;
		}
	}

	if (thinkingLevel) {
		pi.setThinkingLevel(thinkingLevel);
	}

	const activeModel = model ? modelRef(model) : ctx.model ? modelRef(ctx.model as PiModel) : "current model";
	const activeThinking = pi.getThinkingLevel();
	notify(ctx, `Session model set: ${activeModel} · thinking:${activeThinking}`, "info");
}

async function showSelector(pi: ExtensionAPI, ctx: ExtensionContext, models: PiModel[]): Promise<void> {
	if (!ctx.ui?.select) {
		const current = ctx.model ? `${modelRef(ctx.model as PiModel)} · thinking:${pi.getThinkingLevel()}` : undefined;
		notify(ctx, usage(current), "warning");
		return;
	}

	if (models.length === 0) {
		notify(ctx, "No configured models with usable credentials were found.", "warning");
		return;
	}

	const choices: string[] = [];
	const choiceMap = new Map<string, { model: PiModel; thinkingLevel: ThinkingLevel }>();
	const currentRef = ctx.model ? modelRef(ctx.model as PiModel) : undefined;
	const currentThinking = pi.getThinkingLevel();

	for (const model of models) {
		for (const thinkingLevel of supportedThinkingLevels(model)) {
			const current = currentRef === modelRef(model) && currentThinking === thinkingLevel ? " (current)" : "";
			const choice = `${modelLabel(model)} · thinking:${thinkingLevel}${current}`;
			choices.push(choice);
			choiceMap.set(choice, { model, thinkingLevel });
		}
	}

	const selected = await ctx.ui.select("Select session model + thinking level", choices);
	if (!selected) return;

	const selection = choiceMap.get(selected);
	if (!selection) return;

	await applySelection(pi, ctx, selection.model, selection.thinkingLevel);
}

export function thinkingCompletionsFor(model: PiModel, partial = "") {
	return supportedThinkingLevels(model)
		.filter((level) => level.startsWith(partial.toLowerCase()))
		.map((level) => ({
			value: `${modelRef(model)}:${level}`,
			label: level,
			description: `Use ${modelRef(model)} with thinking:${level}`,
		}));
}

export function completionsFor(prefix: string, models: PiModel[]) {
	const colonIndex = prefix.lastIndexOf(":");
	if (colonIndex > 0) {
		const beforeColon = prefix.slice(0, colonIndex).trim();
		const afterColon = prefix.slice(colonIndex + 1).trim();
		const model = findByProviderRef(models, beforeColon);
		if (model) return thinkingCompletionsFor(model, afterColon);
	}

	const parsed = parseArgs(prefix);

	if (parsed.modelQuery) {
		const model = findByProviderRef(models, parsed.modelQuery);
		if (model) return thinkingCompletionsFor(model);
	}

	const needle = prefix.trim().toLowerCase();
	const modelItems = models
		.filter((model) => !needle || modelLabel(model).toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle))
		.slice(0, 100)
		.map((model) => ({
			value: modelRef(model),
			label: modelRef(model),
			description: model.name && model.name !== model.id ? model.name : undefined,
		}));

	const thinkingItems = THINKING_LEVELS.filter((level) => level.startsWith(needle)).map((level) => ({
		value: level,
		label: level,
		description: `Change thinking level for the current session model`,
	}));

	return [...thinkingItems, ...modelItems].length > 0 ? [...thinkingItems, ...modelItems] : null;
}

export default function sessionModelExtension(pi: ExtensionAPI) {
	let cachedModels: PiModel[] = [];

	async function refreshModels(ctx: ExtensionContext): Promise<PiModel[]> {
		cachedModels = await loadModels(ctx);
		return cachedModels;
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			await refreshModels(ctx);
		} catch {
			// Keep startup quiet. The command refreshes again and reports actionable errors.
		}
	});

	pi.registerCommand("session-model", {
		description: "Switch model and thinking level for this session only",
		getArgumentCompletions: (prefix: string) => completionsFor(prefix, cachedModels),
		handler: async (args: string | undefined, ctx: ExtensionContext) => {
			if (ctx.waitForIdle) await ctx.waitForIdle();

			let models: PiModel[];
			try {
				models = await refreshModels(ctx);
			} catch (error) {
				notify(ctx, `Failed to load models: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			const trimmed = args?.trim() ?? "";
			if (!trimmed) {
				await showSelector(pi, ctx, models);
				return;
			}

			if (["help", "--help", "-h"].includes(trimmed)) {
				const current = ctx.model ? `${modelRef(ctx.model as PiModel)} · thinking:${pi.getThinkingLevel()}` : undefined;
				notify(ctx, usage(current), "info");
				return;
			}

			if (["current", "status"].includes(trimmed)) {
				const current = ctx.model ? `${modelRef(ctx.model as PiModel)} · thinking:${pi.getThinkingLevel()}` : "No model selected";
				notify(ctx, current, "info");
				return;
			}

			const { modelQuery, thinkingLevel } = parseArgs(trimmed);

			if (!modelQuery) {
				await applySelection(pi, ctx, undefined, thinkingLevel);
				return;
			}

			const resolved = resolveModel(ctx, models, modelQuery);
			if (!resolved.ok) {
				if (resolved.reason === "ambiguous") {
					const matches = (resolved.matches ?? []).slice(0, 10).map(modelRef).join(", ");
					notify(ctx, `Ambiguous model "${modelQuery}". Matches: ${matches}`, "warning");
				} else {
					notify(ctx, `Model not found: ${modelQuery}`, "error");
				}
				return;
			}

			if (thinkingLevel && !modelSupportsThinkingLevel(resolved.model, thinkingLevel)) {
				const available = supportedThinkingLevels(resolved.model).join(", ");
				notify(ctx, `${modelRef(resolved.model)} does not support thinking:${thinkingLevel}. Available: ${available}`, "error");
				return;
			}

			await applySelection(pi, ctx, resolved.model, thinkingLevel);
		},
	});
}
