import {
  normalizeInviteCode, inviteLink, naira, countdown, tierSlots, maxRewardKobo, inviteStage, initials,
  setPendingInvite, getPendingInvite, clearPendingInvite, captureInviteFromUrl, promoDue, markPromoSeen,
  inviteConfigFromPlatform, PENDING_INVITE_KEY,
} from "../utils/invite";

beforeEach(() => localStorage.clear());

test("codes are cleaned and validated", () => {
  expect(normalizeInviteCode(" kd-ab 12cd ")).toBe("KDAB12CD");
  expect(normalizeInviteCode("ab")).toBe("");
  expect(normalizeInviteCode(null)).toBe("");
  expect(normalizeInviteCode("x".repeat(20))).toBe("");
});

test("invite link opens sign-up with the code", () => {
  expect(inviteLink("KDAB12CD")).toBe("https://kudiai.app/?invite=KDAB12CD&signup=1");
});

test("naira formats kobo", () => {
  expect(naira(220000)).toBe("₦2,200");
  expect(naira(0)).toBe("₦0");
  expect(naira(undefined)).toBe("₦0");
});

test("countdown", () => {
  const now = Date.parse("2026-10-16T00:00:00Z");
  const c = countdown("2026-10-22T23:59:03Z", now);
  expect(c.text).toBe("6d 23:59:03");
  expect(c.done).toBe(false);
  expect(countdown("2026-10-15T00:00:00Z", now)).toMatchObject({ done: true, text: "0d 00:00:00" });
});

test("tier slots mark filled ones and the next to invite", () => {
  const s = tierSlots([50000, 70000, 100000], [{ tier: 1, name: "Chinedu O.", paid: true }]);
  expect(s.map((x) => [x.tier, x.filled, x.isNext])).toEqual([[1, true, false], [2, false, true], [3, false, false]]);
  expect(s[0]).toMatchObject({ amountKobo: 50000, name: "Chinedu O.", paid: true });
  expect(tierSlots([50000, 70000, 100000], [1, 2, 3].map((tier) => ({ tier }))).some((x) => x.isNext)).toBe(false);
  expect(maxRewardKobo([50000, 70000, 100000])).toBe(220000);
});

test("friend progress stages", () => {
  expect(inviteStage({ status: "joined", wallet_open: false }, 200000).stage).toBe("joined");
  expect(inviteStage({ status: "wallet_open", wallet_open: true, spent_kobo: 150000 }, 200000)).toMatchObject({ stage: "spend", pct: 75 });
  expect(inviteStage({ status: "rewarded", paid: true }, 200000)).toMatchObject({ stage: "done", paid: true });
  expect(inviteStage({ status: "expired" }, 200000).stage).toBe("expired");
  expect(inviteStage({ status: "rejected" }, 200000).stage).toBe("rejected");
});

test("initials", () => {
  expect(initials("Chinedu O.")).toBe("CO");
  expect(initials("Amara")).toBe("A");
  expect(initials("")).toBe("★");
});

test("pending code storage expires after 30 days", () => {
  setPendingInvite("kdab12cd");
  expect(getPendingInvite()).toBe("KDAB12CD");
  localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ code: "KDAB12CD", at: Date.now() - 31 * 86400000 }));
  expect(getPendingInvite()).toBe("");
  setPendingInvite("KDAB12CD"); clearPendingInvite();
  expect(getPendingInvite()).toBe("");
});

test("?invite= is captured and removed from the URL", () => {
  window.history.replaceState(null, "", "/?invite=kdzz99yy&signup=1");
  expect(captureInviteFromUrl(window.location)).toBe("KDZZ99YY");
  expect(getPendingInvite()).toBe("KDZZ99YY");
  expect(window.location.search).toBe("?signup=1");
});

test("the popup shows at most once a week", () => {
  const now = Date.now();
  expect(promoDue(7, now)).toBe(true);
  markPromoSeen(now);
  expect(promoDue(7, now + 86400000)).toBe(false);
  expect(promoDue(7, now + 8 * 86400000)).toBe(true);
});

test("program config comes from platform_config and respects the switch", () => {
  expect(inviteConfigFromPlatform({ referral_enabled: "false" })).toBeNull();
  expect(inviteConfigFromPlatform(null)).toBeNull();
  expect(inviteConfigFromPlatform({ referral_enabled: "true", referral_tiers_kobo: "50000, 70000,100000", referral_friend_bonus_kobo: "20000", referral_min_spend_kobo: "200000" }))
    .toEqual({ tiers: [50000, 70000, 100000], maxKobo: 220000, friendBonusKobo: 20000, minSpendKobo: 200000, windowDays: 7 });
});
