import type { ExistingAccountInfo } from "../../cli.js";

export type RootCommandTuiAction =
	| { type: "switch"; accountIndex: number }
	| { type: "add"; signInMode: "browser" | "manual" }
	| { type: "refresh" }
	| { type: "cancel" };

export interface RootCommandTuiUpdate {
	accounts: ExistingAccountInfo[];
	statusMessage?: string;
	statusTone?: "info" | "success" | "error";
}

export interface RootCommandTuiHandlers {
	onSwitch?: (accountIndex: number) => Promise<RootCommandTuiUpdate>;
	onRefresh?: () => Promise<RootCommandTuiUpdate>;
}

export async function promptRootCommandTui(
	accounts: ExistingAccountInfo[],
	handlers?: RootCommandTuiHandlers,
): Promise<RootCommandTuiAction> {
	const { promptRootCommandInkTui } = await import("./root-tui-ink.js");
	return promptRootCommandInkTui(accounts, handlers);
}
