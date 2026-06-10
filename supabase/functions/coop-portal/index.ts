import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const ORG_SELECT = `id, owner_id, name, type, reg_number, description, purpose, vision, mission,
  address, state_name, lga, phone, email, website, logo_url,
  social_instagram, social_facebook, social_twitter, date_established, registration_fee,
  wallet_balance, total_savings, total_loans_out, member_count, status, created_at`;

const MEMBER_SELECT = `id, org_id, membership_id, full_name, email, phone, role, status,
  profile_image_url, address, occupation, gender, date_of_birth, joined_date,
  next_of_kin, next_of_kin_phone,
  privacy_balance, privacy_contributions, privacy_activities, must_change_pin,
  suspended_at, suspension_reason, portal_token, savings_balance, created_at`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { action } = body;

  try {

    // ══════════════════════════════════════════════════
    //  ORGANIZATION MANAGEMENT
    // ══════════════════════════════════════════════════

    if (action === "create-org") {
      const b = body as Record<string, string>;
      if (!b.owner_id || !b.name || !b.type) return json({ error: "owner_id, name, type required" }, 400);
      const PREFIX: Record<string,string> = {
        cooperative:"COOP", market_association:"MKT", church:"CHU", ngo:"NGO",
        youth_group:"YTH", savings_group:"SAV", community_group:"COM",
        professional_association:"PRO", savings_club:"SCL",
      };
      const reg_number = `${PREFIX[b.type] || "ORG"}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const { data: org, error } = await sb.from("organizations")
        .insert({ owner_id: b.owner_id, name: b.name, type: b.type, reg_number,
          description: b.description, purpose: b.purpose, vision: b.vision, mission: b.mission,
          address: b.address, state_name: b.state_name, lga: b.lga,
          phone: b.phone, email: b.email, website: b.website,
          date_established: b.date_established || null,
          registration_fee: parseFloat(b.registration_fee || "0") || 0,
        })
        .select(ORG_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      return json({ org });
    }

    if (action === "get-orgs") {
      const { owner_id } = body as { owner_id: string };
      const { data: orgs } = await sb.from("organizations")
        .select(ORG_SELECT).eq("owner_id", owner_id).order("created_at", { ascending: false });
      return json({ orgs: orgs || [] });
    }

    if (action === "get-org") {
      const { org_id } = body as { org_id: string };
      const { data: org } = await sb.from("organizations").select(ORG_SELECT).eq("id", org_id).maybeSingle();
      if (!org) return json({ error: "Not found" }, 404);
      return json({ org });
    }

    if (action === "update-org") {
      const { org_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["name","description","purpose","vision","mission","address","state_name","lga",
                       "phone","email","website","logo_url","social_instagram","social_facebook",
                       "social_twitter","date_established","registration_fee","status"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      const { data: org, error } = await sb.from("organizations").update(update)
        .eq("id", org_id).select(ORG_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      return json({ org });
    }

    // ── Leaders ──────────────────────────────────────────

    if (action === "get-leaders") {
      const { org_id } = body as { org_id: string };
      const { data: leaders } = await sb.from("org_leaders").select("*")
        .eq("org_id", org_id).order("sort_order").order("created_at");
      return json({ leaders: leaders || [] });
    }

    if (action === "add-leader") {
      const { org_id, name, position, phone, email, sort_order } = body as Record<string, unknown>;
      if (!org_id || !name || !position) return json({ error: "org_id, name, position required" }, 400);
      const { data: leader, error } = await sb.from("org_leaders")
        .insert({ org_id, name, position, phone: phone || null, email: email || null,
          sort_order: parseInt(String(sort_order || 0)) })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ leader });
    }

    if (action === "update-leader") {
      const { leader_id, name, position, phone, email, sort_order } = body as Record<string, unknown>;
      const { data: leader, error } = await sb.from("org_leaders")
        .update({ name, position, phone: phone || null, email: email || null,
          sort_order: parseInt(String(sort_order || 0)) })
        .eq("id", leader_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ leader });
    }

    if (action === "delete-leader") {
      const { leader_id } = body as { leader_id: string };
      await sb.from("org_leaders").delete().eq("id", leader_id);
      return json({ success: true });
    }

    // ══════════════════════════════════════════════════
    //  MEMBER MANAGEMENT
    // ══════════════════════════════════════════════════

    if (action === "add-member") {
      const b = body as Record<string, string>;
      if (!b.org_id || !b.full_name) return json({ error: "org_id and full_name required" }, 400);
      const { count } = await sb.from("org_members").select("id", { count: "exact", head: true })
        .eq("org_id", b.org_id).neq("status", "removed");
      const seq = String((count || 0) + 1).padStart(4, "0");
      const { data: orgRow } = await sb.from("organizations").select("name,reg_number").eq("id", b.org_id).single();
      const prefix = (orgRow?.reg_number || "ORG").split("-")[0];
      const membership_id = `${prefix}-${seq}`;
      const default_pin = String(Math.floor(1000 + Math.random() * 9000));
      const { data: member, error } = await sb.from("org_members")
        .insert({ org_id: b.org_id, membership_id, full_name: b.full_name,
          email: b.email || null, phone: b.phone || null, role: b.role || "member",
          address: b.address || null, occupation: b.occupation || null,
          gender: b.gender || null, next_of_kin: b.next_of_kin || null,
          next_of_kin_phone: b.next_of_kin_phone || null,
          portal_pin: default_pin, must_change_pin: true,
        })
        .select(MEMBER_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      await sb.from("organizations").update({ member_count: (count || 0) + 1 }).eq("id", b.org_id);
      return json({ member, default_pin });
    }

    if (action === "get-members") {
      const { org_id, include_removed } = body as { org_id: string; include_removed?: boolean };
      let q = sb.from("org_members").select(MEMBER_SELECT).eq("org_id", org_id);
      if (!include_removed) q = q.neq("status", "removed");
      const { data: members } = await q.order("full_name");
      return json({ members: members || [] });
    }

    if (action === "get-member") {
      const { member_id } = body as { member_id: string };
      const { data: member } = await sb.from("org_members").select(MEMBER_SELECT).eq("id", member_id).maybeSingle();
      if (!member) return json({ error: "Not found" }, 404);
      return json({ member });
    }

    if (action === "update-member") {
      const { member_id, org_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["full_name","email","phone","role","status","address","occupation",
                       "gender","next_of_kin","next_of_kin_phone","suspension_reason",
                       "privacy_balance","privacy_contributions","privacy_activities","portal_pin"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      if (update.status === "suspended") update.suspended_at = new Date().toISOString();
      if (update.status === "removed")   update.removed_at   = new Date().toISOString();
      if (update.status === "active")  { update.suspended_at = null; update.suspension_reason = null; }
      const { data: member, error } = await sb.from("org_members").update(update)
        .eq("id", member_id).select(MEMBER_SELECT).single();
      if (error) return json({ error: error.message }, 400);
      if (update.status && org_id) {
        const { count } = await sb.from("org_members").select("id", { count: "exact", head: true })
          .eq("org_id", org_id).eq("status", "active");
        await sb.from("organizations").update({ member_count: count || 0 }).eq("id", org_id);
      }
      return json({ member });
    }

    if (action === "reset-member-pin") {
      const { member_id, org_id } = body as { member_id: string; org_id: string };
      if (!member_id || !org_id) return json({ error: "member_id and org_id required" }, 400);
      const new_pin = String(Math.floor(1000 + Math.random() * 9000));
      await sb.from("org_members")
        .update({ portal_pin: new_pin, must_change_pin: true })
        .eq("id", member_id).eq("org_id", org_id);
      return json({ new_pin });
    }

    if (action === "delete-member") {
      const { member_id, org_id } = body as { member_id: string; org_id: string };
      await sb.from("org_members").update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("id", member_id).eq("org_id", org_id);
      const { count } = await sb.from("org_members").select("id", { count: "exact", head: true })
        .eq("org_id", org_id).eq("status", "active");
      await sb.from("organizations").update({ member_count: count || 0 }).eq("id", org_id);
      return json({ success: true });
    }

    if (action === "get-member-directory") {
      const { org_id } = body as { org_id: string };
      const { data: members } = await sb.from("org_members")
        .select("id, membership_id, full_name, role, status, profile_image_url, phone, email, occupation, gender, joined_date, privacy_balance, privacy_contributions, privacy_activities, savings_balance")
        .eq("org_id", org_id).eq("status", "active").order("full_name");
      return json({ members: members || [] });
    }

    // ══════════════════════════════════════════════════
    //  CONTRIBUTION PROGRAMS
    // ══════════════════════════════════════════════════

    if (action === "get-programs") {
      const { org_id } = body as { org_id: string };
      const { data: programs } = await sb.from("org_contribution_programs").select("*")
        .eq("org_id", org_id).order("created_at", { ascending: false });

      const result = await Promise.all((programs || []).map(async (p) => {
        const { data: stats } = await sb.from("org_savings")
          .select("amount")
          .eq("org_id", org_id)
          .eq("program_id", p.id)
          .eq("type", "deposit");
        const total = (stats || []).reduce((s: number, r: { amount: number }) => s + (r.amount || 0), 0);
        return { ...p, total_collected: total };
      }));

      return json({ programs: result });
    }

    if (action === "add-program") {
      const { org_id, name, description, contribution_type, amount, frequency, due_day, target_amount } =
        body as Record<string, unknown>;
      if (!org_id || !name) return json({ error: "org_id and name required" }, 400);
      const { data: program, error } = await sb.from("org_contribution_programs")
        .insert({ org_id, name, description: description || null,
          contribution_type: contribution_type || "fixed",
          amount: parseFloat(String(amount || 0)),
          frequency: frequency || "monthly",
          due_day: due_day ? parseInt(String(due_day)) : null,
          target_amount: target_amount ? parseFloat(String(target_amount)) : null,
        })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ program });
    }

    if (action === "update-program") {
      const { program_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["name","description","contribution_type","amount","frequency","due_day","target_amount","status"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      if (update.amount) update.amount = parseFloat(String(update.amount));
      const { data: program, error } = await sb.from("org_contribution_programs")
        .update(update).eq("id", program_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ program });
    }

    if (action === "delete-program") {
      const { program_id } = body as { program_id: string };
      await sb.from("org_contribution_programs").delete().eq("id", program_id);
      return json({ success: true });
    }

    // ══════════════════════════════════════════════════
    //  SAVINGS / CONTRIBUTIONS
    // ══════════════════════════════════════════════════

    if (action === "record-saving") {
      const { org_id, member_id, amount, type, payment_method, paystack_ref, notes, recorded_by, program_id } =
        body as Record<string, unknown>;
      const amt = parseFloat(String(amount));
      if (!org_id || !member_id || !amt) return json({ error: "org_id, member_id, amount required" }, 400);
      const { data: mem } = await sb.from("org_members").select("savings_balance").eq("id", member_id).single();
      const current = (mem?.savings_balance || 0) as number;
      const isWithdrawal = type === "withdrawal";
      if (isWithdrawal && current < amt) return json({ error: "Insufficient savings balance" }, 400);
      const balance_after = isWithdrawal ? current - amt : current + amt;
      const { data: saving, error } = await sb.from("org_savings")
        .insert({ org_id, member_id, amount: amt, type: type || "deposit",
          payment_method: payment_method || "cash", paystack_ref: paystack_ref || null,
          notes: notes || null, recorded_by: recorded_by || null, balance_after,
          program_id: program_id || null,
        })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      await sb.from("org_members").update({ savings_balance: balance_after }).eq("id", member_id);
      const { data: orgRow } = await sb.from("organizations")
        .select("wallet_balance,total_savings").eq("id", org_id).single();
      const delta = isWithdrawal ? -amt : amt;
      const newWal = Math.max(0, (orgRow?.wallet_balance || 0) + delta);
      const newSav = Math.max(0, (orgRow?.total_savings || 0) + delta);
      await sb.from("organizations").update({ wallet_balance: newWal, total_savings: newSav }).eq("id", org_id);
      await sb.from("org_wallet_txns").insert({
        org_id, type: isWithdrawal ? "savings_withdrawal" : "savings_deposit",
        amount: amt, description: `Savings ${isWithdrawal ? "withdrawal" : "deposit"} — ${member_id}`,
        reference_id: saving.id, paystack_ref: paystack_ref || null, balance_after: newWal,
      });
      const { data: updated_member } = await sb.from("org_members").select(MEMBER_SELECT).eq("id", member_id).single();
      return json({ saving, member: updated_member });
    }

    if (action === "get-savings") {
      const { org_id, member_id, program_id } = body as Record<string, string>;
      let q = sb.from("org_savings")
        .select("*, org_members(full_name,membership_id), org_contribution_programs(name,frequency)");
      if (org_id)    q = q.eq("org_id", org_id);
      if (member_id) q = q.eq("member_id", member_id);
      if (program_id) q = q.eq("program_id", program_id);
      const { data: savings } = await q.order("created_at", { ascending: false }).limit(100);
      return json({ savings: savings || [] });
    }

    // ══════════════════════════════════════════════════
    //  ORG WITHDRAWALS (bulk deduction from members)
    // ══════════════════════════════════════════════════

    if (action === "create-withdrawal") {
      const { org_id, purpose, method, authorized_by, notes, program_id,
              per_member_amount, individual_items } =
        body as Record<string, unknown>;
      if (!org_id || !purpose) return json({ error: "org_id and purpose required" }, 400);

      let affectedMembers: Array<{ id: string; full_name: string; savings_balance: number; amount: number }> = [];

      if (method === "equal") {
        const amt = parseFloat(String(per_member_amount || 0));
        if (!amt) return json({ error: "per_member_amount required for equal method" }, 400);
        const { data: mems } = await sb.from("org_members")
          .select("id,full_name,savings_balance").eq("org_id", org_id).eq("status", "active");
        affectedMembers = (mems || []).map((m: { id: string; full_name: string; savings_balance: number }) =>
          ({ ...m, amount: amt }));
      } else {
        const items = (individual_items || []) as Array<{ member_id: string; amount: number }>;
        for (const item of items) {
          const { data: m } = await sb.from("org_members")
            .select("id,full_name,savings_balance").eq("id", item.member_id).single();
          if (m) affectedMembers.push({ id: m.id, full_name: m.full_name, savings_balance: m.savings_balance, amount: parseFloat(String(item.amount)) });
        }
      }

      const totalAmount = affectedMembers.reduce((s, m) => s + m.amount, 0);

      const { data: wd, error: wdErr } = await sb.from("org_withdrawals")
        .insert({ org_id, purpose, total_amount: totalAmount, method: method || "equal",
          authorized_by: authorized_by || null, notes: notes || null,
          program_id: program_id || null, member_count: affectedMembers.length,
        }).select("id").single();
      if (wdErr) return json({ error: wdErr.message }, 400);

      for (const m of affectedMembers) {
        const newBal = Math.max(0, (m.savings_balance || 0) - m.amount);
        await sb.from("org_members").update({ savings_balance: newBal }).eq("id", m.id);
        await sb.from("org_savings").insert({
          org_id, member_id: m.id, amount: m.amount, type: "withdrawal",
          payment_method: "org_deduction", notes: purpose, balance_after: newBal,
          program_id: program_id || null,
        });
        await sb.from("org_withdrawal_items").insert({
          withdrawal_id: wd.id, member_id: m.id, member_name: m.full_name, amount: m.amount,
        });
      }

      const { data: orgRow } = await sb.from("organizations")
        .select("wallet_balance,total_savings").eq("id", org_id).single();
      const newWal = Math.max(0, (orgRow?.wallet_balance || 0) - totalAmount);
      const newSav = Math.max(0, (orgRow?.total_savings || 0) - totalAmount);
      await sb.from("organizations").update({ wallet_balance: newWal, total_savings: newSav }).eq("id", org_id);
      await sb.from("org_wallet_txns").insert({
        org_id, type: "org_withdrawal", amount: totalAmount,
        description: `Org withdrawal: ${purpose}`, reference_id: wd.id, balance_after: newWal,
      });

      return json({ withdrawal_id: wd.id, total_amount: totalAmount, member_count: affectedMembers.length });
    }

    if (action === "get-withdrawals") {
      const { org_id } = body as { org_id: string };
      const { data: withdrawals } = await sb.from("org_withdrawals").select("*")
        .eq("org_id", org_id).order("created_at", { ascending: false });
      return json({ withdrawals: withdrawals || [] });
    }

    if (action === "get-withdrawal-items") {
      const { withdrawal_id } = body as { withdrawal_id: string };
      const { data: items } = await sb.from("org_withdrawal_items").select("*")
        .eq("withdrawal_id", withdrawal_id).order("member_name");
      return json({ items: items || [] });
    }

    // ══════════════════════════════════════════════════
    //  LOANS
    // ══════════════════════════════════════════════════

    if (action === "apply-loan") {
      const { org_id, member_id, amount_requested, interest_rate, loan_purpose, repayment_months, notes } =
        body as Record<string, unknown>;
      if (!org_id || !member_id || !amount_requested) return json({ error: "Required fields missing" }, 400);
      const { data: loan, error } = await sb.from("org_loans")
        .insert({ org_id, member_id, amount_requested: parseFloat(String(amount_requested)),
          interest_rate: parseFloat(String(interest_rate || 0)),
          loan_purpose, repayment_months: parseInt(String(repayment_months || 1)), notes: notes || null })
        .select("*, org_members(full_name,membership_id)").single();
      if (error) return json({ error: error.message }, 400);
      return json({ loan });
    }

    if (action === "update-loan") {
      const { loan_id, org_id, status, amount_approved, approved_by_name, notes, repayment_months } =
        body as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      if (status)           update.status = status;
      if (amount_approved)  update.amount_approved = parseFloat(String(amount_approved));
      if (approved_by_name) update.approved_by_name = approved_by_name;
      if (notes !== undefined) update.notes = notes;
      if (status === "approved") {
        update.approved_at = new Date().toISOString();
        update.outstanding_balance = update.amount_approved || parseFloat(String(amount_approved || 0));
      }
      if (status === "disbursed") {
        update.disbursed_at = new Date().toISOString();
        const months = parseInt(String(repayment_months || 1));
        const due = new Date(); due.setMonth(due.getMonth() + months);
        update.due_date = due.toISOString().slice(0, 10);
        const amt = parseFloat(String(update.amount_approved || amount_approved || 0));
        if (amt > 0) {
          const { data: orgW } = await sb.from("organizations")
            .select("wallet_balance,total_loans_out").eq("id", org_id).single();
          const newBal = Math.max(0, (orgW?.wallet_balance || 0) - amt);
          await sb.from("organizations").update({
            wallet_balance: newBal,
            total_loans_out: (orgW?.total_loans_out || 0) + amt,
          }).eq("id", org_id);
          await sb.from("org_wallet_txns").insert({
            org_id, type: "loan_disbursement", amount: amt,
            description: `Loan disbursement — ${loan_id}`, reference_id: loan_id, balance_after: newBal,
          });
        }
      }
      const { data: loan, error } = await sb.from("org_loans").update(update)
        .eq("id", loan_id).select("*, org_members(full_name,membership_id)").single();
      if (error) return json({ error: error.message }, 400);
      return json({ loan });
    }

    if (action === "record-repayment") {
      const { org_id, loan_id, member_id, amount, payment_method, paystack_ref, notes } =
        body as Record<string, unknown>;
      const amt = parseFloat(String(amount));
      if (!loan_id || !amt) return json({ error: "loan_id and amount required" }, 400);
      const { data: loan } = await sb.from("org_loans").select("outstanding_balance").eq("id", loan_id).single();
      if (!loan) return json({ error: "Loan not found" }, 404);
      const newOutstanding = Math.max(0, (loan.outstanding_balance || 0) - amt);
      const { data: repayment, error } = await sb.from("org_loan_repayments")
        .insert({ org_id, loan_id, member_id, amount: amt,
          payment_method: payment_method || "cash", paystack_ref: paystack_ref || null, notes: notes || null })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      await sb.from("org_loans").update({
        outstanding_balance: newOutstanding, status: newOutstanding === 0 ? "repaid" : "disbursed",
      }).eq("id", loan_id);
      const { data: orgW } = await sb.from("organizations")
        .select("wallet_balance,total_loans_out").eq("id", org_id).single();
      const newBal = (orgW?.wallet_balance || 0) + amt;
      await sb.from("organizations").update({
        wallet_balance: newBal,
        total_loans_out: Math.max(0, (orgW?.total_loans_out || 0) - amt),
      }).eq("id", org_id);
      await sb.from("org_wallet_txns").insert({
        org_id, type: "loan_repayment", amount: amt,
        description: `Loan repayment — ${loan_id}`, reference_id: repayment.id,
        paystack_ref: paystack_ref || null, balance_after: newBal,
      });
      return json({ repayment, outstanding_balance: newOutstanding });
    }

    if (action === "get-loans") {
      const { org_id, member_id } = body as { org_id?: string; member_id?: string };
      let q = sb.from("org_loans").select("*, org_members(full_name,membership_id)");
      if (org_id)    q = q.eq("org_id", org_id);
      if (member_id) q = q.eq("member_id", member_id);
      const { data: loans } = await q.order("created_at", { ascending: false });
      return json({ loans: loans || [] });
    }

    if (action === "get-repayments") {
      const { loan_id, org_id } = body as { loan_id?: string; org_id?: string };
      let q = sb.from("org_loan_repayments").select("*, org_members(full_name,membership_id)");
      if (loan_id) q = q.eq("loan_id", loan_id);
      if (org_id)  q = q.eq("org_id", org_id);
      const { data: repayments } = await q.order("created_at", { ascending: false });
      return json({ repayments: repayments || [] });
    }

    // ══════════════════════════════════════════════════
    //  MEETINGS & ATTENDANCE
    // ══════════════════════════════════════════════════

    if (action === "create-meeting") {
      const { org_id, title, description, meeting_type, format, scheduled_at, location, meeting_link, agenda } =
        body as Record<string, string>;
      if (!org_id || !title || !scheduled_at) return json({ error: "org_id, title, scheduled_at required" }, 400);
      const { data: meeting, error } = await sb.from("org_meetings")
        .insert({ org_id, title, description: description || null,
          meeting_type: meeting_type || "general", format: format || "physical",
          scheduled_at, location: location || null,
          meeting_link: meeting_link || null, agenda: agenda || null,
        })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ meeting });
    }

    if (action === "update-meeting") {
      const { meeting_id, ...fields } = body as Record<string, unknown>;
      const allowed = ["title","description","meeting_type","format","scheduled_at","location",
                       "meeting_link","agenda","status"];
      const update: Record<string, unknown> = {};
      for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k];
      const { data: meeting, error } = await sb.from("org_meetings")
        .update(update).eq("id", meeting_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ meeting });
    }

    if (action === "get-meetings") {
      const { org_id } = body as { org_id: string };
      const { data: meetings } = await sb.from("org_meetings").select("*")
        .eq("org_id", org_id).order("scheduled_at", { ascending: false });

      const withRsvp = await Promise.all((meetings || []).map(async (m) => {
        const { data: rsvp } = await sb.from("org_meeting_rsvp")
          .select("status").eq("meeting_id", m.id);
        const counts = { attending: 0, maybe: 0, not_attending: 0 };
        (rsvp || []).forEach((r: { status: string }) => {
          if (r.status in counts) counts[r.status as keyof typeof counts]++;
        });
        return { ...m, rsvp_counts: counts };
      }));

      return json({ meetings: withRsvp });
    }

    if (action === "bulk-attendance") {
      const { meeting_id, org_id, present_ids, absent_ids } =
        body as { meeting_id: string; org_id: string; present_ids: string[]; absent_ids: string[] };
      const rows = [
        ...(present_ids || []).map((id: string) => ({ meeting_id, org_id, member_id: id, status: "present", checked_in_at: new Date().toISOString() })),
        ...(absent_ids  || []).map((id: string) => ({ meeting_id, org_id, member_id: id, status: "absent",  checked_in_at: new Date().toISOString() })),
      ];
      if (rows.length) {
        const { error } = await sb.from("org_attendance").upsert(rows, { onConflict: "meeting_id,member_id" });
        if (error) return json({ error: error.message }, 400);
      }
      await sb.from("org_meetings").update({ status: "completed" }).eq("id", meeting_id);
      return json({ count: rows.length });
    }

    if (action === "get-attendance") {
      const { meeting_id, org_id } = body as { meeting_id?: string; org_id?: string };
      let q = sb.from("org_attendance").select("*, org_members(full_name,membership_id,role)");
      if (meeting_id) q = q.eq("meeting_id", meeting_id);
      if (org_id)     q = q.eq("org_id", org_id);
      const { data: att } = await q.order("checked_in_at", { ascending: false });
      return json({ attendance: att || [] });
    }

    if (action === "qr-check-in") {
      const { qr_token, member_id } = body as { qr_token: string; member_id: string };
      const { data: meeting } = await sb.from("org_meetings").select("id,org_id,title,status")
        .eq("qr_token", qr_token).maybeSingle();
      if (!meeting) return json({ error: "Invalid QR code" }, 404);
      if (meeting.status === "cancelled") return json({ error: "Meeting cancelled" }, 400);
      const { data: att, error } = await sb.from("org_attendance")
        .upsert({ meeting_id: meeting.id, org_id: meeting.org_id, member_id, status: "present",
          checked_in_at: new Date().toISOString() }, { onConflict: "meeting_id,member_id" })
        .select("*, org_members(full_name)").single();
      if (error) return json({ error: error.message }, 400);
      return json({ attendance: att, meeting });
    }

    if (action === "set-rsvp") {
      const { meeting_id, member_id, org_id, status } = body as Record<string, string>;
      if (!meeting_id || !member_id) return json({ error: "meeting_id and member_id required" }, 400);
      const { data: rsvp, error } = await sb.from("org_meeting_rsvp")
        .upsert({ meeting_id, member_id, org_id, status: status || "attending" },
          { onConflict: "meeting_id,member_id" })
        .select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ rsvp });
    }

    if (action === "get-rsvp") {
      const { meeting_id } = body as { meeting_id: string };
      const { data: rsvps } = await sb.from("org_meeting_rsvp")
        .select("*, org_members(full_name,role)").eq("meeting_id", meeting_id);
      return json({ rsvps: rsvps || [] });
    }

    // ══════════════════════════════════════════════════
    //  ANNOUNCEMENTS
    // ══════════════════════════════════════════════════

    if (action === "send-announcement") {
      const { org_id, author_name, type, title, body: msgBody, is_pinned } =
        body as Record<string, unknown>;
      if (!org_id || !title || !msgBody) return json({ error: "org_id, title, body required" }, 400);
      const { data: ann, error } = await sb.from("org_announcements")
        .insert({ org_id, author_name: author_name || "Admin",
          type: type || "announcement", title, body: msgBody,
          is_pinned: is_pinned || false,
        }).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ announcement: ann });
    }

    if (action === "get-announcements") {
      const { org_id } = body as { org_id: string };
      const { data: announcements } = await sb.from("org_announcements").select("*")
        .eq("org_id", org_id).order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false }).limit(50);
      return json({ announcements: announcements || [] });
    }

    if (action === "pin-announcement") {
      const { announcement_id, is_pinned } = body as { announcement_id: string; is_pinned: boolean };
      await sb.from("org_announcements").update({ is_pinned }).eq("id", announcement_id);
      return json({ success: true });
    }

    if (action === "delete-announcement") {
      const { announcement_id } = body as { announcement_id: string };
      await sb.from("org_announcements").delete().eq("id", announcement_id);
      return json({ success: true });
    }

    // ══════════════════════════════════════════════════
    //  WALLET
    // ══════════════════════════════════════════════════

    if (action === "get-wallet") {
      const { org_id, limit } = body as { org_id: string; limit?: number };
      const { data: txns } = await sb.from("org_wallet_txns").select("*")
        .eq("org_id", org_id).order("created_at", { ascending: false }).limit(limit || 50);
      const { data: org } = await sb.from("organizations")
        .select("wallet_balance,total_savings,total_loans_out").eq("id", org_id).single();
      return json({ transactions: txns || [], wallet: org });
    }

    // ══════════════════════════════════════════════════
    //  MEMBER PORTAL
    // ══════════════════════════════════════════════════

    if (action === "member-auth") {
      const { membership_id, pin, org_id } = body as { membership_id: string; pin: string; org_id?: string };
      if (!membership_id || !pin) return json({ error: "Membership ID and PIN required" }, 400);
      let q = sb.from("org_members")
        .select(`${MEMBER_SELECT}, organizations(${ORG_SELECT})`)
        .eq("membership_id", membership_id.toUpperCase().trim())
        .eq("portal_pin", pin.trim());
      if (org_id) q = q.eq("org_id", org_id);
      const { data: member } = await q.maybeSingle();
      if (!member) return json({ error: "Invalid membership ID or PIN" }, 401);
      if (member.status === "suspended") return json({ error: "Your membership is suspended. Contact your organisation." }, 403);
      if (member.status === "removed")   return json({ error: "This membership is no longer active." }, 403);
      return json({ member, org: (member as Record<string,unknown>).organizations });
    }

    if (action === "member-by-token") {
      const b = body as Record<string, string>;
      const tk = b.portal_token || b.token;
      if (!tk) return json({ error: "Token required" }, 400);
      const { data: member } = await sb.from("org_members")
        .select(`${MEMBER_SELECT}, organizations(${ORG_SELECT})`)
        .eq("portal_token", tk).maybeSingle();
      if (!member) return json({ error: "Invalid portal token" }, 404);
      return json({ member, org: (member as Record<string,unknown>).organizations });
    }

    if (action === "change-member-pin") {
      const { member_id, current_pin, new_pin } = body as { member_id: string; current_pin: string; new_pin: string };
      if (!member_id || !current_pin || !new_pin) return json({ error: "All fields required" }, 400);
      if (new_pin.length < 4) return json({ error: "PIN must be at least 4 digits" }, 400);
      const { data: m } = await sb.from("org_members").select("portal_pin").eq("id", member_id).single();
      if (!m || m.portal_pin !== current_pin.trim()) return json({ error: "Current PIN is incorrect" }, 401);
      await sb.from("org_members").update({ portal_pin: new_pin, must_change_pin: false }).eq("id", member_id);
      return json({ success: true });
    }

    if (action === "member-update-privacy") {
      const { member_id, privacy_balance, privacy_contributions, privacy_activities } =
        body as Record<string, unknown>;
      await sb.from("org_members").update({
        privacy_balance: !!privacy_balance,
        privacy_contributions: !!privacy_contributions,
        privacy_activities: !!privacy_activities,
      }).eq("id", member_id);
      return json({ success: true });
    }

    if (action === "member-get-savings") {
      const { member_id, org_id } = body as { member_id: string; org_id?: string };
      let q = sb.from("org_savings")
        .select("*, org_contribution_programs(name,frequency,contribution_type)")
        .eq("member_id", member_id);
      if (org_id) q = q.eq("org_id", org_id);
      const { data: savings } = await q.order("created_at", { ascending: false }).limit(100);
      return json({ savings: savings || [] });
    }

    if (action === "member-get-loans") {
      const { member_id, org_id } = body as { member_id: string; org_id?: string };
      let q = sb.from("org_loans").select("*").eq("member_id", member_id);
      if (org_id) q = q.eq("org_id", org_id);
      const { data: loans } = await q.order("created_at", { ascending: false });
      return json({ loans: loans || [] });
    }

    if (action === "member-request-loan") {
      const { org_id, member_id, amount_requested, loan_purpose, repayment_months } =
        body as Record<string, unknown>;
      if (!org_id || !member_id || !amount_requested) return json({ error: "Required fields missing" }, 400);
      const { data: loan, error } = await sb.from("org_loans").insert({
        org_id, member_id, amount_requested: parseFloat(String(amount_requested)),
        loan_purpose: loan_purpose || null, repayment_months: parseInt(String(repayment_months || 1)),
      }).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ loan });
    }

    if (action === "member-get-meetings") {
      const { org_id, member_id } = body as { org_id: string; member_id: string };
      const { data: meetings } = await sb.from("org_meetings").select("*")
        .eq("org_id", org_id).order("scheduled_at", { ascending: false }).limit(20);
      const [{ data: attendance }, { data: rsvps }] = await Promise.all([
        sb.from("org_attendance").select("meeting_id,status").eq("member_id", member_id),
        sb.from("org_meeting_rsvp").select("meeting_id,status").eq("member_id", member_id),
      ]);
      const attMap: Record<string, string> = {};
      const rsvpMap: Record<string, string> = {};
      (attendance || []).forEach((a: Record<string,string>) => { attMap[a.meeting_id] = a.status; });
      (rsvps || []).forEach((r: Record<string,string>) => { rsvpMap[r.meeting_id] = r.status; });
      const merged = (meetings || []).map(m => ({
        ...m, my_attendance: attMap[m.id] || null, my_rsvp: rsvpMap[m.id] || null,
      }));
      return json({ meetings: merged });
    }

    if (action === "member-get-announcements") {
      const { org_id } = body as { org_id: string };
      const { data: announcements } = await sb.from("org_announcements").select("*")
        .eq("org_id", org_id)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false }).limit(30);
      return json({ announcements: announcements || [] });
    }

    if (action === "member-get-programs") {
      const { org_id } = body as { org_id: string };
      const { data: programs } = await sb.from("org_contribution_programs").select("*")
        .eq("org_id", org_id).eq("status", "active").order("created_at");
      return json({ programs: programs || [] });
    }

    if (action === "member-get-directory") {
      const { org_id } = body as { org_id: string };
      const { data: members } = await sb.from("org_members")
        .select("id, membership_id, full_name, role, profile_image_url, phone, email, occupation, joined_date, privacy_balance, privacy_contributions, privacy_activities, savings_balance")
        .eq("org_id", org_id).eq("status", "active").order("full_name");
      return json({ members: members || [] });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
