-- CEZIK AI Studio: hybrid free, purchased-credit, and Premium entitlement model.
-- Run after the existing credit and PayPal purchase migrations.

create type public.credit_grant_source as enum ('free', 'purchase', 'subscription', 'legacy');
create type public.subscription_status as enum ('approval_pending', 'active', 'past_due', 'suspended', 'cancelled', 'expired');

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]+$'),
  name text not null,
  included_credits integer not null check (included_credits > 0),
  interval_unit text not null check (interval_unit in ('month')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans (code, name, included_credits, interval_unit)
values ('premium', 'CEZIK Premium', 1000, 'month')
on conflict (code) do nothing;

create table public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  provider text not null check (provider = 'paypal'),
  provider_subscription_id text unique,
  status public.subscription_status not null default 'approval_pending',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index user_subscriptions_one_live_plan_idx
  on public.user_subscriptions (user_id, plan_id)
  where status in ('approval_pending', 'active', 'past_due', 'suspended');
create index user_subscriptions_user_status_idx on public.user_subscriptions (user_id, status);

create table public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  source public.credit_grant_source not null,
  original_amount integer not null check (original_amount > 0),
  remaining_amount integer not null check (remaining_amount >= 0 and remaining_amount <= original_amount),
  watermark_required boolean not null,
  expires_at timestamptz,
  reference text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, reference)
);

create index credit_grants_available_idx on public.credit_grants (user_id, watermark_required, expires_at, created_at)
  where remaining_amount > 0;

-- Existing balances predate source-level tracking. Preserve their availability
-- and do not retroactively degrade paid customers' stored balance.
insert into public.credit_grants (
  user_id, source, original_amount, remaining_amount, watermark_required, reference, description
)
select user_id, 'legacy', balance, balance, false, 'legacy-wallet:' || user_id::text, 'Balance created before source-level entitlement tracking'
from public.credit_wallets
where balance > 0
on conflict (user_id, reference) do nothing;

alter table public.ai_jobs
  add column if not exists credit_allocations jsonb not null default '[]'::jsonb check (jsonb_typeof(credit_allocations) = 'array'),
  add column if not exists watermark_required boolean not null default false;

alter table public.creations
  add column if not exists watermark_required boolean not null default false,
  add column if not exists entitlement_source text;

create trigger subscription_plans_touch_updated_at before update on public.subscription_plans
for each row execute function private.touch_updated_at();
create trigger user_subscriptions_touch_updated_at before update on public.user_subscriptions
for each row execute function private.touch_updated_at();
create trigger credit_grants_touch_updated_at before update on public.credit_grants
for each row execute function private.touch_updated_at();

create or replace function private.add_credit_grant(
  p_user_id uuid,
  p_source public.credit_grant_source,
  p_amount integer,
  p_watermark_required boolean,
  p_reference text,
  p_description text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_amount <= 0 then raise exception 'Credit grants must be positive'; end if;
  insert into public.credit_grants (
    user_id, source, original_amount, remaining_amount, watermark_required, expires_at, reference, description
  ) values (
    p_user_id, p_source, p_amount, p_amount, p_watermark_required, p_expires_at, p_reference, p_description
  ) on conflict (user_id, reference) do nothing;
end;
$$;

create or replace function private.allocate_credit_grants(p_user_id uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_grant public.credit_grants;
  v_remaining integer := p_amount;
  v_used integer;
  v_allocations jsonb := '[]'::jsonb;
  v_wallet_balance integer;
  v_grant_balance integer;
begin
  if p_amount <= 0 then raise exception 'Credit deduction must be positive'; end if;
  -- Keep the source ledger resilient to a future server-side admin adjustment:
  -- any wallet balance not represented by a grant is preserved as legacy clean
  -- credit instead of making a displayed balance impossible to spend.
  select balance into v_wallet_balance from public.credit_wallets where user_id = p_user_id for update;
  if not found then raise exception 'Credit wallet not found'; end if;
  select coalesce(sum(remaining_amount), 0) into v_grant_balance from public.credit_grants where user_id = p_user_id;
  if v_wallet_balance > v_grant_balance then
    perform private.add_credit_grant(p_user_id, 'legacy', v_wallet_balance - v_grant_balance, false,
      'unattributed-wallet:' || p_user_id::text || ':' || gen_random_uuid()::text,
      'Server-side credit balance created outside source-level tracking');
  end if;
  for v_grant in
    select * from public.credit_grants
    where user_id = p_user_id
      and remaining_amount > 0
      and (expires_at is null or expires_at > now())
    order by watermark_required asc, expires_at nulls last, created_at asc
    for update
  loop
    exit when v_remaining = 0;
    v_used := least(v_remaining, v_grant.remaining_amount);
    update public.credit_grants set remaining_amount = remaining_amount - v_used where id = v_grant.id;
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'grant_id', v_grant.id, 'amount', v_used, 'source', v_grant.source, 'watermark_required', v_grant.watermark_required
    ));
    v_remaining := v_remaining - v_used;
  end loop;
  if v_remaining > 0 then raise exception 'Insufficient credits'; end if;
  return v_allocations;
end;
$$;

create or replace function private.expire_credit_grants(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare v_grant public.credit_grants;
begin
  for v_grant in
    select * from public.credit_grants
    where user_id = p_user_id and remaining_amount > 0 and expires_at is not null and expires_at <= now()
    for update
  loop
    update public.credit_grants set remaining_amount = 0 where id = v_grant.id;
    perform private.deduct_credits(p_user_id, v_grant.remaining_amount, 'subscription_allowance',
      'expired-grant:' || v_grant.id::text, 'Expired CEZIK Premium allowance');
  end loop;
end;
$$;

create or replace function private.restore_credit_grants(p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare v_allocation jsonb;
begin
  for v_allocation in select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    update public.credit_grants
    set remaining_amount = least(original_amount, remaining_amount + (v_allocation ->> 'amount')::integer)
    where id = (v_allocation ->> 'grant_id')::uuid;
  end loop;
end;
$$;

-- New users receive a free, watermark-required promotional allocation.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare v_welcome_credits integer;
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email)
  on conflict (id) do nothing;
  insert into public.credit_wallets (user_id) values (new.id) on conflict (user_id) do nothing;
  v_welcome_credits := coalesce(private.get_welcome_credit_amount(), 0);
  if v_welcome_credits > 0 then
    perform private.add_credits(new.id, v_welcome_credits, 'welcome_bonus', 'welcome:' || new.id::text, 'Welcome to CEZIK AI Studio');
    perform private.add_credit_grant(new.id, 'free', v_welcome_credits, true, 'welcome:' || new.id::text, 'Free CEZIK welcome credits');
  end if;
  return new;
end;
$$;

-- Atomically chooses source grants, charges the wallet, and snapshots the
-- watermark decision on the immutable job record.
create or replace function public.start_ai_job(
  p_user_id uuid,
  p_activity_slug text,
  p_input_data jsonb,
  p_idempotency_key uuid
)
returns public.ai_jobs
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_activity public.ai_activities;
  v_job public.ai_jobs;
  v_pending_jobs integer;
  v_allocations jsonb;
  v_watermark_required boolean;
begin
  if p_input_data is null or jsonb_typeof(p_input_data) <> 'object' then raise exception 'Invalid activity input'; end if;
  select * into v_activity from public.ai_activities where slug = p_activity_slug for share;
  if not found or not v_activity.enabled or v_activity.provider is null then raise exception 'This activity is not available yet'; end if;
  select count(*) into v_pending_jobs from public.ai_jobs where user_id = p_user_id and status in ('queued', 'processing');
  if v_pending_jobs >= 3 then raise exception 'Please wait for an active generation to finish'; end if;

  insert into public.ai_jobs (user_id, activity_id, provider, status, input_data, credits_reserved, credits_charged, idempotency_key)
  values (p_user_id, v_activity.id, v_activity.provider, 'queued', p_input_data, v_activity.credit_cost, v_activity.credit_cost, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing returning * into v_job;
  if not found then
    select * into v_job from public.ai_jobs where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return v_job;
  end if;

  v_allocations := private.allocate_credit_grants(p_user_id, v_activity.credit_cost);
  select coalesce(bool_or((value ->> 'watermark_required')::boolean), false) into v_watermark_required
  from jsonb_array_elements(v_allocations);
  perform private.deduct_credits(p_user_id, v_activity.credit_cost, v_activity.transaction_type, 'job:' || v_job.id::text, v_activity.name || ' generation');
  update public.ai_jobs set credit_allocations = v_allocations, watermark_required = v_watermark_required where id = v_job.id returning * into v_job;
  return v_job;
end;
$$;

create or replace function public.complete_ai_job(
  p_job_id uuid,
  p_output_data jsonb,
  p_title text,
  p_creation_type text,
  p_storage_path text default null,
  p_preview_path text default null
)
returns public.creations
language plpgsql
security definer
set search_path = public, private
as $$
declare v_job public.ai_jobs; v_creation public.creations; v_source text;
begin
  select * into v_job from public.ai_jobs where id = p_job_id for update;
  if not found then raise exception 'AI job not found'; end if;
  if v_job.status = 'completed' then select * into v_creation from public.creations where job_id = p_job_id; return v_creation; end if;
  if v_job.status not in ('queued', 'processing') then raise exception 'AI job cannot be completed from its current state'; end if;
  select value ->> 'source' into v_source from jsonb_array_elements(v_job.credit_allocations) value limit 1;
  update public.ai_jobs set status = 'completed', output_data = coalesce(p_output_data, '{}'::jsonb) || jsonb_build_object('watermark_required', v_job.watermark_required), completed_at = now(), error_message = null where id = p_job_id;
  insert into public.creations (user_id, job_id, title, type, status, storage_path, preview_path, metadata, watermark_required, entitlement_source)
  values (v_job.user_id, p_job_id, p_title, p_creation_type, 'completed', p_storage_path, p_preview_path, coalesce(p_output_data, '{}'::jsonb) || jsonb_build_object('watermark_required', v_job.watermark_required), v_job.watermark_required, v_source)
  returning * into v_creation;
  return v_creation;
end;
$$;

create or replace function public.fail_ai_job(p_job_id uuid, p_error_message text, p_refund boolean default true)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare v_job public.ai_jobs;
begin
  select * into v_job from public.ai_jobs where id = p_job_id for update;
  if not found then raise exception 'AI job not found'; end if;
  if v_job.status in ('completed', 'failed', 'cancelled') then return; end if;
  update public.ai_jobs set status = 'failed', error_message = left(p_error_message, 1000), completed_at = now() where id = p_job_id;
  if p_refund and v_job.credits_charged > 0 then
    perform private.restore_credit_grants(v_job.credit_allocations);
    perform private.refund_credits(v_job.user_id, v_job.credits_charged, 'job-refund:' || v_job.id::text, 'Refund for failed AI generation');
    update public.ai_jobs set credits_charged = 0 where id = p_job_id;
  end if;
end;
$$;

-- Adds one verified monthly Premium allowance. Replaying an event for the same
-- provider period is harmless because both the ledger and grant are unique.
create or replace function public.grant_subscription_allowance(p_provider_subscription_id text, p_period_key text)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_subscription public.user_subscriptions; v_credits integer; v_reference text; v_balance integer;
begin
  select s.* into v_subscription from public.user_subscriptions s
  where s.provider = 'paypal' and s.provider_subscription_id = p_provider_subscription_id for update;
  if not found then raise exception 'Subscription not found'; end if;
  if v_subscription.status <> 'active' then raise exception 'Subscription is not active'; end if;
  perform private.expire_credit_grants(v_subscription.user_id);
  select included_credits into v_credits from public.subscription_plans where id = v_subscription.plan_id and active = true;
  if not found then raise exception 'Subscription plan is unavailable'; end if;
  v_reference := 'subscription:' || v_subscription.id::text || ':' || p_period_key;
  if exists (select 1 from public.credit_grants where user_id = v_subscription.user_id and reference = v_reference) then
    select balance into v_balance from public.credit_wallets where user_id = v_subscription.user_id;
    return coalesce(v_balance, 0);
  end if;
  v_balance := private.add_credits(v_subscription.user_id, v_credits, 'subscription_allowance', v_reference, 'CEZIK Premium included credits');
  perform private.add_credit_grant(v_subscription.user_id, 'subscription', v_credits, false, v_reference, 'CEZIK Premium included credits', now() + interval '1 month');
  return v_balance;
end;
$$;

-- Paid packs are explicitly clean-output credits, even if the account itself
-- remains on the free plan.
create or replace function public.confirm_paypal_credit_purchase(
  p_purchase_id uuid, p_paypal_order_id text, p_paypal_capture_id text, p_amount numeric, p_currency text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_purchase public.credit_purchases; v_balance integer; v_reference text;
begin
  select * into v_purchase from public.credit_purchases where id = p_purchase_id and provider = 'paypal' for update;
  if not found then raise exception 'Credit purchase not found'; end if;
  if v_purchase.paypal_order_id is distinct from p_paypal_order_id then raise exception 'PayPal order does not match credit purchase'; end if;
  if v_purchase.amount <> p_amount or upper(v_purchase.currency) <> upper(p_currency) then raise exception 'PayPal amount or currency does not match credit purchase'; end if;
  if v_purchase.status = 'credited' then select balance into v_balance from public.credit_wallets where user_id = v_purchase.user_id; return coalesce(v_balance, 0); end if;
  if v_purchase.status in ('failed', 'cancelled', 'refunded', 'reconciliation_required') then raise exception 'Credit purchase cannot be credited from its current state'; end if;
  if v_purchase.paypal_capture_id is not null and v_purchase.paypal_capture_id <> p_paypal_capture_id then raise exception 'PayPal capture does not match credit purchase'; end if;
  update public.credit_purchases set paypal_capture_id = p_paypal_capture_id, status = 'captured', provider_metadata = provider_metadata || jsonb_build_object('capture_id', p_paypal_capture_id) where id = v_purchase.id;
  v_reference := 'paypal:' || v_purchase.id::text || ':' || p_paypal_capture_id;
  v_balance := private.add_credits(v_purchase.user_id, v_purchase.credit_amount, 'credit_purchase', v_reference, 'Verified PayPal credit purchase ' || v_purchase.id::text);
  perform private.add_credit_grant(v_purchase.user_id, 'purchase', v_purchase.credit_amount, false, v_reference, 'Paid CEZIK credit pack');
  update public.credit_purchases set status = 'credited', credited_at = now() where id = v_purchase.id;
  return v_balance;
end;
$$;

alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.credit_grants enable row level security;
create policy "Users can read active subscription plans" on public.subscription_plans for select to authenticated using (active = true);
create policy "Users can read their own subscriptions" on public.user_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "Users can read their own credit grants" on public.credit_grants for select to authenticated using (user_id = auth.uid());

revoke all on public.subscription_plans, public.user_subscriptions, public.credit_grants from anon, authenticated;
grant select on public.subscription_plans, public.user_subscriptions, public.credit_grants to authenticated;
revoke all on function private.add_credit_grant(uuid, public.credit_grant_source, integer, boolean, text, text, timestamptz) from public;
revoke all on function private.allocate_credit_grants(uuid, integer) from public;
revoke all on function private.restore_credit_grants(jsonb) from public;
revoke all on function private.expire_credit_grants(uuid) from public;
revoke all on function public.grant_subscription_allowance(text, text) from public;
grant execute on function public.grant_subscription_allowance(text, text) to service_role;
grant execute on function public.start_ai_job(uuid, text, jsonb, uuid) to service_role;
grant execute on function public.complete_ai_job(uuid, jsonb, text, text, text, text) to service_role;
grant execute on function public.fail_ai_job(uuid, text, boolean) to service_role;
grant execute on function public.confirm_paypal_credit_purchase(uuid, text, text, numeric, text) to service_role;
