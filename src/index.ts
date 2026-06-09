import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, SettingsManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type PiModel = {
	id: string;
	name?: string;
	provider: string;
	reasoning?: boolean;
};

type AutocompleteItem = {
	value: string;
	label?: string;
	description?: string;
};

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVEL_SET.has(value);
}

function modelRef(model: PiModel): string {
	return `${model.provider}/${model.id}`;
}

function modelLabel(model: PiModel): string {
	return model.name && model.name !== model.id ? `${model.provider}/${model.id} — ${model.name}` : modelRef(model);
}

function getAllModels(ctx: ExtensionCommandContext): PiModel[] {
	ctx.modelRegistry.refresh?.();
	return (ctx.modelRegistry.getAll?.() ?? []) as PiModel[];
}

function findExactModelReference(reference: string, models: PiModel[]): PiModel | undefined {
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
	| { ok: true; model: PiModel; thinkingLevel?: ThinkingLevel }
	| { ok: false; error: string };

export function parseSessionModelArgument(input: string, models: PiModel[]): ParsedSessionModelArgument {
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

export function getSessionModelCompletions(prefix: string, models: PiModel[]): AutocompleteItem[] | null {
	const arg = prefix.trimStart();

	// Deliberately do not complete thinking levels after ':'.
	if (arg.includes(":")) return null;

	const providers = Array.from(new Set(models.map((model) => model.provider))).sort();

	if (!arg.includes("/")) {
		const matchingProviders = providers
			.filter((provider) => provider.startsWith(arg))
			.map((provider) => ({
				value: `${provider}/`,
				label: `${provider}/`,
				description: "provider",
			}));

		return matchingProviders.length > 0 ? matchingProviders : null;
	}

	const slash = arg.indexOf("/");
	const providerPrefix = arg.slice(0, slash);
	const modelPrefix = arg.slice(slash + 1);
	const items = models
		.filter((model) => model.provider === providerPrefix && model.id.startsWith(modelPrefix))
		.sort((a, b) => a.id.localeCompare(b.id))
		.slice(0, 100)
		.map((model) => ({
			value: modelRef(model),
			label: modelRef(model),
			description: model.name && model.name !== model.id ? model.name : undefined,
		}));

	return items.length > 0 ? items : null;
}

type SettingsSnapshot = {
	exists: boolean;
	content?: string;
	parsed?: Record<string, unknown>;
};

function parseObjectJson(content: string | undefined): Record<string, unknown> | undefined {
	if (content === undefined) return undefined;
	try {
		const parsed = JSON.parse(content) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

async function readSettingsSnapshot(settingsPath: string): Promise<SettingsSnapshot> {
	if (!existsSync(settingsPath)) return { exists: false };
	const content = await readFile(settingsPath, "utf8");
	return { exists: true, content, parsed: parseObjectJson(content) };
}

const SESSION_SELECTION_SETTING_KEYS = ["defaultProvider", "defaultModel", "defaultThinkingLevel"] as const;

function withoutSessionSelectionFields(settings: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (settings === undefined) return undefined;
	const copy = { ...settings };
	for (const key of SESSION_SELECTION_SETTING_KEYS) {
		delete copy[key];
	}
	return copy;
}

function jsonEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

async function restoreSessionSelectionSettings(settingsPath: string, before: SettingsSnapshot): Promise<void> {
	const after = await readSettingsSnapshot(settingsPath);
	if (!after.exists) return;

	// If pi only changed session-selection defaults, restore the exact original bytes.
	if (
		before.exists &&
		before.parsed !== undefined &&
		after.parsed !== undefined &&
		jsonEqual(withoutSessionSelectionFields(before.parsed), withoutSessionSelectionFields(after.parsed))
	) {
		if (after.content !== before.content) {
			await writeFile(settingsPath, before.content ?? "", "utf8");
		}
		return;
	}

	// Otherwise preserve any concurrent settings edits and only roll back selection defaults.
	if (after.parsed !== undefined) {
		const restored = { ...after.parsed };
		for (const key of SESSION_SELECTION_SETTING_KEYS) {
			if (before.parsed && Object.prototype.hasOwnProperty.call(before.parsed, key)) {
				restored[key] = before.parsed[key];
			} else {
				delete restored[key];
			}
		}

		if (!before.exists && Object.keys(restored).length === 0) {
			await unlink(settingsPath).catch(() => undefined);
		} else {
			await writeFile(settingsPath, `${JSON.stringify(restored, null, 2)}\n`, "utf8");
		}
		return;
	}

	// Last resort for malformed JSON: put the pre-command file back exactly.
	if (before.exists) {
		await writeFile(settingsPath, before.content ?? "", "utf8");
	} else {
		await unlink(settingsPath).catch(() => undefined);
	}
}

async function withRestoredGlobalSelectionSettings<T>(fn: () => Promise<T> | T): Promise<T> {
	const settingsPath = join(getAgentDir(), "settings.json");
	const before = await readSettingsSnapshot(settingsPath);
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

		// Defense in depth: if a pi version wrote before/around the prototype patch, give
		// queued writes a turn to land and then restore only selection-related defaults.
		await new Promise((resolve) => setTimeout(resolve, 0));
		await restoreSessionSelectionSettings(settingsPath, before);
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
		const modelSelected = await pi.setModel(parsed.model as never);
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

async function showSessionModelPicker(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Usage: /session-model <provider>/<model>[:thinking-level]", "info");
		return;
	}

	const models = getAllModels(ctx);
	const choices = models.map(modelLabel);
	const selected = await ctx.ui.select("Select session model", choices);
	if (!selected) return;

	const ref = selected.split(" — ")[0] ?? selected;
	await applySessionModel(pi, ctx, ref);
}

export default function sessionModelExtension(pi: ExtensionAPI) {
	let cachedModels: PiModel[] = [];

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
				await showSessionModelPicker(pi, ctx);
				return;
			}

			await applySessionModel(pi, ctx, trimmed);
		},
	});
}
