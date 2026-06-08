-- Permission-aware access for staff accounts.
-- These helper functions run as the database owner so policy checks do not
-- recurse through RLS on staff and staff_permissions.

create or replace function public.is_active_staff_for(target_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff s
    where s.owner_id = target_owner
      and s.status = 'active'
      and (
        s.user_id = auth.uid()
        or (
          s.user_id is null
          and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

create or replace function public.staff_can(
  target_owner uuid,
  target_module text,
  require_create boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff s
    join public.staff_permissions p on p.staff_id = s.id
    where s.owner_id = target_owner
      and s.status = 'active'
      and p.module = target_module
      and p.can_view = true
      and (require_create = false or p.can_create = true)
      and (
        s.user_id = auth.uid()
        or (
          s.user_id is null
          and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

grant execute on function public.is_active_staff_for(uuid) to authenticated;
grant execute on function public.staff_can(uuid, text, boolean) to authenticated;

drop policy if exists "staff can read own account" on public.staff;
create policy "staff can read own account"
on public.staff for select
to authenticated
using (
  owner_id = auth.uid()
  or user_id = auth.uid()
  or (
    user_id is null
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists "staff can link own legacy account" on public.staff;
create policy "staff can link own legacy account"
on public.staff for update
to authenticated
using (
  owner_id = auth.uid()
  or user_id = auth.uid()
  or (
    user_id is null
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
)
with check (
  owner_id = auth.uid()
  or user_id = auth.uid()
);

drop policy if exists "staff can read assigned permissions" on public.staff_permissions;
create policy "staff can read assigned permissions"
on public.staff_permissions for select
to authenticated
using (
  exists (
    select 1
    from public.staff s
    where s.id = staff_id
      and (
        s.owner_id = auth.uid()
        or s.user_id = auth.uid()
        or (
          s.user_id is null
          and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  )
);

drop policy if exists "staff can read owner profile" on public.profiles;
create policy "staff can read owner profile"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_active_staff_for(id));

drop policy if exists "staff can read transactions" on public.transactions;
create policy "staff can read transactions"
on public.transactions for select
to authenticated
using (
  user_id = auth.uid()
  or public.staff_can(user_id, 'transactions', false)
  or public.staff_can(user_id, 'bills', false)
);

drop policy if exists "staff can create transactions" on public.transactions;
create policy "staff can create transactions"
on public.transactions for insert
to authenticated
with check (
  user_id = auth.uid()
  or (
    payment_type = 'bill_payment'
    and public.staff_can(user_id, 'bills', true)
  )
  or (
    payment_type <> 'bill_payment'
    and public.staff_can(user_id, 'transactions', true)
  )
);

drop policy if exists "staff can update transactions" on public.transactions;
create policy "staff can update transactions"
on public.transactions for update
to authenticated
using (
  user_id = auth.uid()
  or public.staff_can(user_id, 'transactions', true)
  or public.staff_can(user_id, 'bills', true)
)
with check (
  user_id = auth.uid()
  or public.staff_can(user_id, 'transactions', true)
  or public.staff_can(user_id, 'bills', true)
);

drop policy if exists "staff can delete transactions" on public.transactions;
create policy "staff can delete transactions"
on public.transactions for delete
to authenticated
using (
  user_id = auth.uid()
  or public.staff_can(user_id, 'transactions', true)
  or public.staff_can(user_id, 'bills', true)
);

drop policy if exists "staff can read credits" on public.credits;
create policy "staff can read credits"
on public.credits for select
to authenticated
using (user_id = auth.uid() or public.staff_can(user_id, 'credit', false));

drop policy if exists "staff can create credits" on public.credits;
create policy "staff can create credits"
on public.credits for insert
to authenticated
with check (user_id = auth.uid() or public.staff_can(user_id, 'credit', true));

drop policy if exists "staff can update credits" on public.credits;
create policy "staff can update credits"
on public.credits for update
to authenticated
using (user_id = auth.uid() or public.staff_can(user_id, 'credit', true))
with check (user_id = auth.uid() or public.staff_can(user_id, 'credit', true));

drop policy if exists "staff can read aso clients" on public.aso_clients;
create policy "staff can read aso clients"
on public.aso_clients for select
to authenticated
using (user_id = auth.uid() or public.staff_can(user_id, 'aso', false));

drop policy if exists "staff can create aso clients" on public.aso_clients;
create policy "staff can create aso clients"
on public.aso_clients for insert
to authenticated
with check (user_id = auth.uid() or public.staff_can(user_id, 'aso', true));

drop policy if exists "staff can update aso clients" on public.aso_clients;
create policy "staff can update aso clients"
on public.aso_clients for update
to authenticated
using (user_id = auth.uid() or public.staff_can(user_id, 'aso', true))
with check (user_id = auth.uid() or public.staff_can(user_id, 'aso', true));

drop policy if exists "staff can create audit logs" on public.audit_logs;
create policy "staff can create audit logs"
on public.audit_logs for insert
to authenticated
with check (
  owner_id = auth.uid()
  or public.is_active_staff_for(owner_id)
);
