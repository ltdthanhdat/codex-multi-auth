import { describe, expect, it } from "vitest";
import {
	extractQuotaSnapshotFromAppServerLines,
	mapOfficialRateLimitsToQuotaSnapshot,
} from "../lib/official-rate-limits.js";

describe("official rate limits", () => {
	it("maps Codex app-server rate limits into a quota snapshot", () => {
		const snapshot = mapOfficialRateLimitsToQuotaSnapshot({
			planType: "plus",
			primary: {
				usedPercent: 56,
				windowDurationMins: 300,
				resetsAt: 1780480800,
			},
			secondary: {
				usedPercent: 16,
				windowDurationMins: 10080,
				resetsAt: 1780963920,
			},
			rateLimitReachedType: null,
		});

		expect(snapshot).toEqual({
			status: 200,
			planType: "plus",
			model: "codex-app-server",
			primary: {
				usedPercent: 56,
				windowMinutes: 300,
				resetAtMs: 1780480800_000,
			},
			secondary: {
				usedPercent: 16,
				windowMinutes: 10080,
				resetAtMs: 1780963920_000,
			},
		});
	});

	it("returns null when the app-server payload contains no usable windows", () => {
		expect(
			mapOfficialRateLimitsToQuotaSnapshot({
				primary: null,
				secondary: null,
				rateLimitReachedType: null,
			}),
		).toBeNull();
	});

	it("extracts the requested rate-limits response from app-server output lines", () => {
		const snapshot = extractQuotaSnapshotFromAppServerLines([
			'{"id":"init","result":{"ok":true}}',
			'{"method":"remoteControl/status/changed","params":{"status":"disabled"}}',
			'{"id":"limits","result":{"rateLimits":{"primary":{"usedPercent":55,"windowDurationMins":300,"resetsAt":1780426406},"secondary":{"usedPercent":87,"windowDurationMins":10080,"resetsAt":1780852333},"planType":"plus","rateLimitReachedType":null}}}',
		]);

		expect(snapshot).toEqual({
			status: 200,
			planType: "plus",
			model: "codex-app-server",
			primary: {
				usedPercent: 55,
				windowMinutes: 300,
				resetAtMs: 1780426406_000,
			},
			secondary: {
				usedPercent: 87,
				windowMinutes: 10080,
				resetAtMs: 1780852333_000,
			},
		});
	});
});
