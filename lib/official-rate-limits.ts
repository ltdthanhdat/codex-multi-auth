import { spawn, type ChildProcess } from "node:child_process";
import type { CodexQuotaSnapshot } from "./quota-probe.js";

export interface OfficialRateLimitWindow {
	usedPercent?: number;
	resetsAt?: number | null;
	windowDurationMins?: number;
}

export interface OfficialRateLimitSnapshot {
	limitId?: string | null;
	limitName?: string | null;
	primary?: OfficialRateLimitWindow | null;
	secondary?: OfficialRateLimitWindow | null;
	planType?: string | null;
	rateLimitReachedType?: string | null;
}

interface AppServerJsonRpcMessage {
	id?: unknown;
	method?: unknown;
	result?: {
		rateLimits?: OfficialRateLimitSnapshot | null;
	} | null;
	error?: {
		message?: unknown;
	} | null;
}

function normalizeWindow(
	window: OfficialRateLimitWindow | null | undefined,
): CodexQuotaSnapshot["primary"] {
	return {
		usedPercent:
			typeof window?.usedPercent === "number" && Number.isFinite(window.usedPercent)
				? window.usedPercent
				: undefined,
		windowMinutes:
			typeof window?.windowDurationMins === "number" &&
			Number.isFinite(window.windowDurationMins)
				? window.windowDurationMins
				: undefined,
		resetAtMs:
			typeof window?.resetsAt === "number" && Number.isFinite(window.resetsAt)
				? window.resetsAt * 1000
				: undefined,
	};
}

export function mapOfficialRateLimitsToQuotaSnapshot(
	rateLimits: OfficialRateLimitSnapshot | null | undefined,
): CodexQuotaSnapshot | null {
	if (!rateLimits) return null;
	const primary = normalizeWindow(rateLimits.primary);
	const secondary = normalizeWindow(rateLimits.secondary);
	if (
		typeof primary.usedPercent !== "number" &&
		typeof secondary.usedPercent !== "number" &&
		typeof primary.resetAtMs !== "number" &&
		typeof secondary.resetAtMs !== "number"
	) {
		return null;
	}
	return {
		status: rateLimits.rateLimitReachedType ? 429 : 200,
		planType:
			typeof rateLimits.planType === "string" && rateLimits.planType.trim().length > 0
				? rateLimits.planType.trim()
				: undefined,
		primary,
		secondary,
		model: "codex-app-server",
	};
}

export function extractQuotaSnapshotFromAppServerLines(
	lines: readonly string[],
	requestId = "limits",
): CodexQuotaSnapshot | null {
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			const parsed = JSON.parse(trimmed) as AppServerJsonRpcMessage;
			if (parsed.id !== requestId) continue;
			if (parsed.error) {
				const message =
					typeof parsed.error.message === "string"
						? parsed.error.message
						: "Failed to read Codex rate limits";
				throw new Error(message);
			}
			const snapshot = mapOfficialRateLimitsToQuotaSnapshot(
				parsed.result?.rateLimits,
			);
			if (snapshot) return snapshot;
		} catch (error) {
			if (error instanceof Error) throw error;
			throw new Error(String(error));
		}
	}
	return null;
}

function spawnAppServer(): ChildProcess {
	return spawn("codex", ["app-server", "--listen", "stdio://"], {
		stdio: ["pipe", "pipe", "pipe"],
	});
}

export async function fetchOfficialCurrentRateLimitsSnapshot(params: {
	timeoutMs?: number;
	spawnImpl?: typeof spawnAppServer;
} = {}): Promise<CodexQuotaSnapshot | null> {
	const spawnImpl = params.spawnImpl ?? spawnAppServer;
	const timeoutMs = params.timeoutMs ?? 4_000;

	return await new Promise<CodexQuotaSnapshot | null>((resolve, reject) => {
		const child = spawnImpl();
		if (!child.stdin || !child.stdout) {
			child.kill();
			reject(new Error("Codex app-server stdio is unavailable"));
			return;
		}

		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (value: CodexQuotaSnapshot | null, error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.stdout?.removeAllListeners();
			child.stderr?.removeAllListeners();
			child.removeAllListeners();
			if (!child.killed) child.kill();
			if (error) {
				reject(error);
				return;
			}
			resolve(value);
		};
		const timer = setTimeout(() => {
			try {
				const snapshot = extractQuotaSnapshotFromAppServerLines(
					stdout.split(/\r?\n/u),
				);
				finish(snapshot);
			} catch (error) {
				finish(
					null,
					error instanceof Error
						? error
						: new Error(stderr.trim() || String(error)),
				);
			}
		}, timeoutMs);

		child.once("error", (error) =>
			finish(null, error instanceof Error ? error : new Error(String(error))),
		);
		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		});

		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: "init",
				method: "initialize",
				params: {
					clientInfo: { name: "codex-multi-auth", version: "0.0.0" },
					capabilities: null,
				},
			})}\n`,
		);
		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: "limits",
				method: "account/rateLimits/read",
				params: null,
			})}\n`,
		);
	});
}
