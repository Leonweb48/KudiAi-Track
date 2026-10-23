// Run: deno test supabase/functions/_shared/planMatch.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickCheaperPlans, findEquivalentPlan, planDays, planSizeMb } from "./planMatch.ts";

Deno.test("planSizeMb / planDays read both providers' plan names", () => {
  assertEquals([planSizeMb("1 GB - Monthly (SME)"), planSizeMb("1.5GB (SME) - 30 days"), planSizeMb("500 MB - Weekly (SME)"), planSizeMb("Freedom plan")], [1000, 1500, 500, null]);
  assertEquals([planDays("1 GB - Monthly (SME)"), planDays("1GB (SME) - 7days"), planDays("500 MB - Weekly (SME)"), planDays("1GB (GIFTING) - 1 day"),
    planDays("2GB (CGIFTING) - 30 Days"), planDays("10GB - 2 weeks"), planDays("1GB - Daily"), planDays("1GB (SME) - 7-20days"), planDays("Smile")],
    [30, 7, 7, 1, 30, 14, 1, 20, null]);
});

const ck = [
  { plan_id: "1000.00", plan_name: "1 GB - Monthly (SME)", plan_amount: 650, cost_amount: 563, priced: true },
  { plan_id: "5000.00", plan_name: "5 GB - Monthly (SME)", plan_amount: 2800, cost_amount: 2511, priced: true },
  { plan_id: "500", plan_name: "500 MB - Weekly (SME)", plan_amount: 330, cost_amount: 297, priced: false },
  { plan_id: "1000", plan_name: "1 GB - Weekly (SME)", plan_amount: 450, cost_amount: 410, priced: true },
];
const bg = [
  { plan_id: "bg:269", plan_name: "1GB (CGIFTING) - 30 days", plan_amount: 500 },
  { plan_id: "bg:300", plan_name: "5GB (SME) - 30 days", plan_amount: 1950 },
  { plan_id: "bg:301", plan_name: "500MB (SME) - 7days", plan_amount: 352 },       // dearer → stays ClubKonnect
  { plan_id: "bg:302", plan_name: "1GB (SME) - 7days", plan_amount: 407 },         // only ₦3 cheaper → not worth it
];

Deno.test("cheaper same-size same-validity Bigisub plans replace ClubKonnect's, at the owner's customer price", () => {
  const out = pickCheaperPlans(ck, bg, { bgBalance: 10_000 });
  assertEquals(out.map((p) => p.plan_id), ["bg:269", "bg:300", "500", "1000"]);
  assertEquals(out[0], { plan_id: "bg:269", plan_name: "1GB (CGIFTING) - 30 days", plan_amount: 650, cost_amount: 500, priced: true, replaces: "1000.00" });
  assertEquals(out[1].plan_amount, 2800);
});

Deno.test("no swaps when Bigisub's wallet is unknown, and only plans its wallet can cover", () => {
  assertEquals(pickCheaperPlans(ck, bg, { bgBalance: null }), ck);
  assertEquals(pickCheaperPlans(ck, bg, { bgBalance: 600 }).map((p) => p.plan_id), ["bg:269", "5000.00", "500", "1000"]);
});

Deno.test("never below cost: a customer price under Bigisub's cost keeps ClubKonnect's plan", () => {
  const cheapSale = [{ plan_id: "1000.00", plan_name: "1 GB - Monthly (SME)", plan_amount: 480, cost_amount: 563, priced: true }];
  assertEquals(pickCheaperPlans(cheapSale, bg, { bgBalance: 10_000 })[0].plan_id, "1000.00");
});

Deno.test("one Bigisub plan replaces at most one ClubKonnect plan", () => {
  const two = [ck[0], { plan_id: "1000.01", plan_name: "1 GB - 30 days (Gifting)", plan_amount: 700, cost_amount: 600, priced: true }];
  assertEquals(pickCheaperPlans(two, bg, { bgBalance: 10_000 }).map((p) => p.plan_id), ["bg:269", "1000.01"]);
});

Deno.test("findEquivalentPlan: same size + validity, covered by the customer's price and Bigisub's wallet, cheapest first", () => {
  const refused = { plan_id: "1500.02", plan_name: "2GB+2mins Monthly Plan - 30 days (Direct Data)", plan_amount: 1500 };
  const list = [
    { plan_id: "bg:1", plan_name: "2GB (SME) - 30 days", plan_amount: 1300 },
    { plan_id: "bg:2", plan_name: "2GB (GIFTING) - 30 days", plan_amount: 1100 },
    { plan_id: "bg:3", plan_name: "2GB (SME) - 7days", plan_amount: 600 },        // other validity
    { plan_id: "bg:4", plan_name: "1GB (SME) - 30 days", plan_amount: 300 },      // other size
  ];
  assertEquals(findEquivalentPlan(refused, list, 10_000)?.plan_id, "bg:2");
  assertEquals(findEquivalentPlan(refused, list, 1200)?.plan_id, "bg:2");
  assertEquals(findEquivalentPlan(refused, list, 1000), null);                     // Bigisub's wallet can't pay any
  assertEquals(findEquivalentPlan({ ...refused, plan_amount: 1000 }, list, 10_000), null);   // never at a loss
  assertEquals(findEquivalentPlan(refused, list, null), null);
  assertEquals(findEquivalentPlan({ ...refused, plan_name: "Night plan" }, list, 10_000), null);   // can't read size/validity
});
