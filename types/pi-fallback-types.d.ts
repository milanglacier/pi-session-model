declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    registerCommand(name: string, options: any): void;
    on(event: string, handler: (event: any, ctx: any) => any): void;
    setModel(model: any): Promise<boolean>;
    getThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    setThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): void;
  }

  export interface ExtensionContext {
    model?: any;
    modelRegistry: any;
    ui: any;
    waitForIdle?: () => Promise<void>;
  }
}
