import type { QuotaCacheData, QuotaCacheEntry, QuotaCacheWindow } from "./quota-cache.js";
import type { AccountMetadataV3 } from "./storage.js";

export type QuotaCacheAccountRef = Pick<AccountMetadataV3, "accountId" | "email">;

type QuotaWindowLike = Pick<QuotaCacheWindow, "usedPercent" | "resetAtMs" | "windowMinutes">;

function quotaWindowHasRolledOver(
	window: QuotaWindowLike | undefined,
	now = Date.now(),
	updatedAt?: number,
): boolean {
	if (typeof window?.resetAtMs === "number" && now >= window.resetAtMs) {
		return true;
	}
	if (
		typeof window?.resetAtMs !== "number" &&
		typeof updatedAt === "number" &&
		typeof window?.windowMinutes === "number" &&
		window.windowMinutes > 0 &&
		now >= updatedAt + window.windowMinutes * 60_000
	) {
		return true;
	}
	return false;
}

export function normalizeQuotaAccountId(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function normalizeQuotaEmail(value: string | undefined): string | null {
	const trimmed = value?.trim().toLowerCase();
	return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function hasUniqueQuotaAccountId(
	accounts: readonly QuotaCacheAccountRef[],
	account: QuotaCacheAccountRef,
): boolean {
	const accountId = normalizeQuotaAccountId(account.accountId);
	if (!accountId) return false;
	let count = 0;
	for (const candidate of accounts) {
		if (normalizeQuotaAccountId(candidate.accountId) === accountId) count += 1;
	}
	return count === 1;
}

export type QuotaEmailFallbackState = {
	matchingCount: number;
	distinctAccountIds: Set<string>;
};

export function buildQuotaEmailFallbackState(
	accounts: readonly QuotaCacheAccountRef[],
): ReadonlyMap<string, QuotaEmailFallbackState> {
	const stateByEmail = new Map<string, QuotaEmailFallbackState>();
	for (const account of accounts) {
		const email = normalizeQuotaEmail(account.email);
		if (!email) continue;
		const existing = stateByEmail.get(email);
		const accountId = normalizeQuotaAccountId(account.accountId);
		if (existing) {
			existing.matchingCount += 1;
			if (accountId) existing.distinctAccountIds.add(accountId);
			continue;
		}
		const distinctAccountIds = new Set<string>();
		if (accountId) distinctAccountIds.add(accountId);
		stateByEmail.set(email, { matchingCount: 1, distinctAccountIds });
	}
	return stateByEmail;
}

export function hasSafeQuotaEmailFallback(
	emailFallbackState: ReadonlyMap<string, QuotaEmailFallbackState>,
	account: QuotaCacheAccountRef,
): boolean {
	const email = normalizeQuotaEmail(account.email);
	if (!email) return false;
	const state = emailFallbackState.get(email);
	if (!state) return false;
	return state.matchingCount === 1 && state.distinctAccountIds.size <= 1;
}

export function quotaLeftPercentFromUsed(
	usedPercent: number | undefined,
): number | undefined {
	if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
		return undefined;
	}
	return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function quotaWindowIsExhausted(
	window: QuotaWindowLike | undefined,
	now = Date.now(),
	updatedAt?: number,
): boolean {
	if (quotaWindowHasRolledOver(window, now, updatedAt)) {
		return false;
	}
	const leftPercent = quotaLeftPercentFromUsed(window?.usedPercent);
	return typeof leftPercent === "number" && leftPercent <= 0;
}

export function isQuotaCacheEntryExhausted(
	entry: Pick<QuotaCacheEntry, "primary" | "secondary"> & { updatedAt?: number } | null | undefined,
	now = Date.now(),
): boolean {
	// Codex quota windows are cumulative gates: a 0% remaining active window blocks use
	// even if another window still has quota left.
	const updatedAt = entry?.updatedAt;
	return (
		quotaWindowIsExhausted(entry?.primary, now, updatedAt) ||
		quotaWindowIsExhausted(entry?.secondary, now, updatedAt)
	);
}

export function normalizeQuotaCacheEntryForDisplay(
	entry: QuotaCacheEntry | null | undefined,
	now = Date.now(),
): QuotaCacheEntry | null {
	if (!entry) return null;

	const updatedAt = entry.updatedAt;
	const primaryRolledOver = quotaWindowHasRolledOver(entry.primary, now, updatedAt);
	const secondaryRolledOver = quotaWindowHasRolledOver(
		entry.secondary,
		now,
		updatedAt,
	);

	const nextPrimary = primaryRolledOver
		? {
				...entry.primary,
				usedPercent: 0,
				resetAtMs: undefined,
			}
		: entry.primary;
	const nextSecondary = secondaryRolledOver
		? {
				...entry.secondary,
				usedPercent: 0,
				resetAtMs: undefined,
			}
		: entry.secondary;
	const nextStatus = entry.status === 429 && primaryRolledOver ? 200 : entry.status;

	if (
		nextPrimary === entry.primary &&
		nextSecondary === entry.secondary &&
		nextStatus === entry.status
	) {
		return entry;
	}

	return {
		...entry,
		status: nextStatus,
		primary: nextPrimary,
		secondary: nextSecondary,
	};
}

export function findQuotaCacheEntryForAccount(
	cache: QuotaCacheData | null | undefined,
	account: QuotaCacheAccountRef,
	accounts: readonly QuotaCacheAccountRef[],
	emailFallbackState = buildQuotaEmailFallbackState(accounts),
): QuotaCacheEntry | null {
	if (!cache) return null;
	const accountId = normalizeQuotaAccountId(account.accountId);
	if (accountId && hasUniqueQuotaAccountId(accounts, account) && cache.byAccountId[accountId]) {
		return cache.byAccountId[accountId] ?? null;
	}
	const email = normalizeQuotaEmail(account.email);
	if (email && hasSafeQuotaEmailFallback(emailFallbackState, account) && cache.byEmail[email]) {
		return cache.byEmail[email] ?? null;
	}
	return null;
}
