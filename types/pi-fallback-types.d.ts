declare module "@earendil-works/pi-coding-agent" {
  export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

  export function getAgentDir(): string;

  export class SettingsManager {
    setDefaultProvider(provider: string): void;
    setDefaultModel(modelId: string): void;
    setDefaultModelAndProvider(provider: string, modelId: string): void;
    setDefaultThinkingLevel(level: ThinkingLevel): void;
  }

  export interface ExtensionAPI {
    registerCommand(name: string, options: {
      description?: string;
      getArgumentCompletions?: (argumentPrefix: string) => any[] | null | Promise<any[] | null>;
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    }): void;
    on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void;
    setModel(model: any): Promise<boolean>;
    getThinkingLevel(): ThinkingLevel;
    setThinkingLevel(level: ThinkingLevel): void;
  }

  export interface ExtensionContext {
    cwd: string;
    hasUI: boolean;
    model?: any;
    modelRegistry: any;
    ui: any;
  }

  export interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle?: () => Promise<void>;
  }
}
