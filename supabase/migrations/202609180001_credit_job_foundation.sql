-- CEZIK AI Studio: secure credit, job, creation, and storage foundation.
-- Run through the Supabase CLI or SQL Editor as the project owner.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

create type public.credit_transaction_type as enum (
  'welcome_bonus',
  'ai_video',
  'ai_image',
  'voiceover',
  'credit_purchase',
  'refund',
  'admin_adjustment'
);

create type public.ai_job_status as enum (
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
);

create type public.payment_status as enum (
  'pending',
  'successful',
  'failed',
  'cancelled',
  'refunded'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.credit_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  type public.credit_transaction_type not null,
  amount integer not null check (amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  reference text not null,
  description text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reference)
);

create index credit_transactions_user_created_at_idx on public.credit_transactions (user_id, created_at desc);

-- Admin/server-controlled configuration; it is never writable by browsers.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('welcome_credit_policy', '{"credits": 50}'::jsonb)
on conflict (key) do nothing;

create table public.ai_activities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  credit_cost integer not null check (credit_cost > 0),
  transaction_type public.credit_transaction_type not null,
  provider text,
  enabled boolean not null default false,
  input_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  activity_id uuid not null references public.ai_activities(id) on delete restrict,
  provider text not null,
  provider_job_id text,
  status public.ai_job_status not null default 'queued',
  input_data jsonb not null default '{}'::jsonb,
  output_data jsonb,
  credits_reserved integer not null check (credits_reserved >= 0),
  credits_charged integer not null check (credits_charged >= 0),
  idempotency_key uuid not null,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);

create index ai_jobs_user_created_at_idx on public.ai_jobs (user_id, created_at desc);
create index ai_jobs_status_created_at_idx on public.ai_jobs (status, created_at asc);

create table public.creations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  job_id uuid unique references public.ai_jobs(id) on delete set null,
  title text not null,
  type text not null,
  status public.ai_job_status not null default 'queued',
  storage_bucket text not null default 'cezik-creations',
  storage_path text,
  preview_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creations_user_created_at_idx on public.creations (user_id, created_at desc);

create table public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  credits integer not null check (credits > 0),
  price numeric(12, 2) not null check (price >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  active boolean not null default true,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  package_id uuid references public.credit_packages(id) on delete set null,
  provider text not null,
  provider_reference text,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null check (char_length(currency) = 3),
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (provider, provider_reference)
);

create index payments_user_created_at_idx on public.payments (user_id, created_at desc);

insert into public.ai_activities (slug, name, description, credit_cost, transaction_type, provider, enabled, input_schema)
values (
  'video-generation',
  'AI Video Generator',
  'Create a cinematic video from a written prompt and optional reference media.',
  20,
  'ai_video',
  null,
  false,
  '{"prompt":{"type":"string","maxLength":2000},"duration":{"type":"string"},"quality":{"type":"string"},"aspect_ratio":{"type":"string"}}'::jsonb
)
on conflict (slug) do nothing;

insert into public.credit_packages (name, credits, price, currency, description, sort_order)
values
  ('Starter', 100, 10.00, 'USD', 'A focused credit pack for trying new ideas.', 10),
  ('Creator', 500, 45.00, 'USD', 'For consistent creative production.', 20),
  ('Professional', 1500, 120.00, 'USD', 'For ambitious creative teams and campaigns.', 30),
  ('Enterprise', 5000, 350.00, 'USD', 'For high-volume studio workflows.', 40)
on conflict (name) do nothing;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function private.touch_updated_at();
create trigger activities_touch_updated_at before update on public.ai_activities
for each row execute function private.touch_updated_at();
create trigger creations_touch_updated_at before update on public.creations
for each row execute function private.touch_updated_at();
create trigger packages_touch_updated_at before update on public.credit_packages
for each row execute function private.touch_updated_at();

create or replace function private.add_credits(
  p_user_id uuid,
  p_amount integer,
  p_type public.credit_transaction_type,
  p_reference text,
  p_description text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_balance integer;
begin
  if p_amount <= 0 then raise exception 'Credit additions must be positive'; end if;
  select balance into v_balance from public.credit_wallets where user_id = p_user_id for update;
  if not found then raise exception 'Credit wallet not found'; end if;
  v_balance := v_balance + p_amount;
  update public.credit_wallets set balance = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.credit_transactions (user_id, type, amount, balance_after, reference, description)
  values (p_user_id, p_type, p_amount, v_balance, p_reference, p_description);
  return v_balance;
end;
$$;

create or replace function private.deduct_credits(
  p_user_id uuid,
  p_amount integer,
  p_type public.credit_transaction_type,
  p_reference text,
  p_description text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_balance integer;
begin
  if p_amount <= 0 then raise exception 'Credit deductions must be positive'; end if;
  select balance into v_balance from public.credit_wallets where user_id = p_user_id for update;
  if not found then raise exception 'Credit wallet not found'; end if;
  if v_balance < p_amount then raise exception 'Insufficient credits'; end if;
  v_balance := v_balance - p_amount;
  update public.credit_wallets set balance = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.credit_transactions (user_id, type, amount, balance_after, reference, description)
  values (p_user_id, p_type, -p_amount, v_balance, p_reference, p_description);
  return v_balance;
end;
$$;

create or replace function private.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_reference text,
  p_description text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return private.add_credits(p_user_id, p_amount, 'refund', p_reference, p_description);
end;
$$;

-- These wrappers form the server-side credit API. They are executable only by
-- service_role; browser roles get no credit-changing RPC privilege.
create or replace function public.add_credits(
  p_user_id uuid,
  p_amount integer,
  p_type public.credit_transaction_type,
  p_reference text,
  p_description text
)
returns integer
language sql
security definer
set search_path = public, private
as $$
  select private.add_credits(p_user_id, p_amount, p_type, p_reference, p_description);
$$;

create or replace function public.deduct_credits(
  p_user_id uuid,
  p_amount integer,
  p_type public.credit_transaction_type,
  p_reference text,
  p_description text
)
returns integer
language sql
security definer
set search_path = public, private
as $$
  select private.deduct_credits(p_user_id, p_amount, p_type, p_reference, p_description);
$$;

create or replace function public.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_reference text,
  p_description text
)
returns integer
language sql
security definer
set search_path = public, private
as $$
  select private.refund_credits(p_user_id, p_amount, p_reference, p_description);
$$;

create or replace function private.get_welcome_credit_amount()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((value ->> 'credits')::integer, 0)
  from public.app_settings
  where key = 'welcome_credit_policy';
$$;

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
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Existing accounts receive the same one-time welcome balance. The transaction
-- reference is unique, so this cannot be double-applied.
insert into public.profiles (id, display_name, email)
select id, raw_user_meta_data ->> 'full_name', email from auth.users
on conflict (id) do nothing;
insert into public.credit_wallets (user_id)
select id from auth.users
on conflict (user_id) do nothing;

do $$
declare
  v_user record;
  v_welcome_credits integer := coalesce(private.get_welcome_credit_amount(), 0);
begin
  if v_welcome_credits > 0 then
    for v_user in select id from auth.users loop
      if not exists (
        select 1 from public.credit_transactions
        where user_id = v_user.id and reference = 'welcome:' || v_user.id::text
      ) then
        perform private.add_credits(v_user.id, v_welcome_credits, 'welcome_bonus', 'welcome:' || v_user.id::text, 'Welcome to CEZIK AI Studio');
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.get_credit_balance()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((select balance from public.credit_wallets where user_id = auth.uid()), 0);
$$;

-- Call only after a payment provider webhook has independently verified the
-- transaction. This is idempotent and reads the credit quantity from the
-- package stored in the database, never from the webhook/browser payload.
create or replace function public.confirm_credit_payment(
  p_payment_id uuid,
  p_provider_reference text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_payment public.payments;
  v_credits integer;
  v_balance integer;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.status = 'successful' then
    select balance into v_balance from public.credit_wallets where user_id = v_payment.user_id;
    return coalesce(v_balance, 0);
  end if;
  if v_payment.status <> 'pending' then raise exception 'Payment cannot be completed from its current state'; end if;

  select credits into v_credits from public.credit_packages where id = v_payment.package_id for share;
  if not found then raise exception 'Credit package not found'; end if;

  update public.payments
  set status = 'successful', provider_reference = p_provider_reference, paid_at = now()
  where id = v_payment.id;
  return private.add_credits(
    v_payment.user_id,
    v_credits,
    'credit_purchase',
    'payment:' || v_payment.id::text,
    'Verified ' || v_payment.provider || ' credit purchase'
  );
end;
$$;

-- Server-only: activity cost is read from ai_activities, not from the request.
-- Job creation and deduction happen inside this one transaction.
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
begin
  if p_input_data is null or jsonb_typeof(p_input_data) <> 'object' then
    raise exception 'Invalid activity input';
  end if;
  select * into v_activity from public.ai_activities where slug = p_activity_slug for share;
  if not found or not v_activity.enabled or v_activity.provider is null then
    raise exception 'This activity is not available yet';
  end if;

  select count(*) into v_pending_jobs from public.ai_jobs
  where user_id = p_user_id and status in ('queued', 'processing');
  if v_pending_jobs >= 3 then raise exception 'Please wait for an active generation to finish'; end if;

  insert into public.ai_jobs (
    user_id, activity_id, provider, status, input_data,
    credits_reserved, credits_charged, idempotency_key
  ) values (
    p_user_id, v_activity.id, v_activity.provider, 'queued', p_input_data,
    v_activity.credit_cost, v_activity.credit_cost, p_idempotency_key
  )
  on conflict (user_id, idempotency_key) do nothing
  returning * into v_job;

  if not found then
    select * into v_job from public.ai_jobs
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return v_job;
  end if;

  perform private.deduct_credits(
    p_user_id, v_activity.credit_cost, v_activity.transaction_type,
    'job:' || v_job.id::text, v_activity.name || ' generation'
  );
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
declare v_job public.ai_jobs; v_creation public.creations;
begin
  select * into v_job from public.ai_jobs where id = p_job_id for update;
  if not found then raise exception 'AI job not found'; end if;
  if v_job.status = 'completed' then
    select * into v_creation from public.creations where job_id = p_job_id;
    return v_creation;
  end if;
  if v_job.status not in ('queued', 'processing') then raise exception 'AI job cannot be completed from its current state'; end if;

  update public.ai_jobs
  set status = 'completed', output_data = p_output_data, completed_at = now(), error_message = null
  where id = p_job_id;
  insert into public.creations (user_id, job_id, title, type, status, storage_path, preview_path, metadata)
  values (v_job.user_id, p_job_id, p_title, p_creation_type, 'completed', p_storage_path, p_preview_path, coalesce(p_output_data, '{}'::jsonb))
  returning * into v_creation;
  return v_creation;
end;
$$;

create or replace function public.fail_ai_job(
  p_job_id uuid,
  p_error_message text,
  p_refund boolean default true
)
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

  update public.ai_jobs
  set status = 'failed', error_message = left(p_error_message, 1000), completed_at = now()
  where id = p_job_id;
  if p_refund and v_job.credits_charged > 0 then
    perform private.refund_credits(v_job.user_id, v_job.credits_charged, 'job-refund:' || v_job.id::text, 'Refund for failed AI generation');
    update public.ai_jobs set credits_charged = 0 where id = p_job_id;
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.app_settings enable row level security;
alter table public.ai_activities enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.creations enable row level security;
alter table public.credit_packages enable row level security;
alter table public.payments enable row level security;

create policy "Users can read their profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "Users can read their wallet" on public.credit_wallets for select to authenticated using (user_id = auth.uid());
create policy "Users can read their own credit ledger" on public.credit_transactions for select to authenticated using (user_id = auth.uid());
create policy "Users can read AI activity catalogue" on public.ai_activities for select to authenticated using (true);
create policy "Users can read their own AI jobs" on public.ai_jobs for select to authenticated using (user_id = auth.uid());
create policy "Users can read their own creations" on public.creations for select to authenticated using (user_id = auth.uid());
create policy "Users can read active credit packages" on public.credit_packages for select to authenticated using (active = true);
create policy "Users can read their own payments" on public.payments for select to authenticated using (user_id = auth.uid());

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.credit_wallets, public.credit_transactions, public.ai_activities, public.ai_jobs, public.creations, public.credit_packages, public.payments to authenticated;
revoke all on function private.add_credits(uuid, integer, public.credit_transaction_type, text, text) from public;
revoke all on function private.deduct_credits(uuid, integer, public.credit_transaction_type, text, text) from public;
revoke all on function private.refund_credits(uuid, integer, text, text) from public;
revoke all on function public.add_credits(uuid, integer, public.credit_transaction_type, text, text) from public;
revoke all on function public.deduct_credits(uuid, integer, public.credit_transaction_type, text, text) from public;
revoke all on function public.refund_credits(uuid, integer, text, text) from public;
revoke all on function public.confirm_credit_payment(uuid, text) from public;
revoke all on function public.start_ai_job(uuid, text, jsonb, uuid) from public;
revoke all on function public.complete_ai_job(uuid, jsonb, text, text, text, text) from public;
revoke all on function public.fail_ai_job(uuid, text, boolean) from public;
revoke all on function public.get_credit_balance() from public;
grant execute on function public.get_credit_balance() to authenticated;
grant execute on function public.add_credits(uuid, integer, public.credit_transaction_type, text, text) to service_role;
grant execute on function public.deduct_credits(uuid, integer, public.credit_transaction_type, text, text) to service_role;
grant execute on function public.refund_credits(uuid, integer, text, text) to service_role;
grant execute on function public.confirm_credit_payment(uuid, text) to service_role;
grant execute on function public.start_ai_job(uuid, text, jsonb, uuid) to service_role;
grant execute on function public.complete_ai_job(uuid, jsonb, text, text, text, text) to service_role;
grant execute on function public.fail_ai_job(uuid, text, boolean) to service_role;

insert into storage.buckets (id, name, public)
values ('cezik-creations', 'cezik-creations', false)
on conflict (id) do update set public = false;

create policy "Users can read their own CEZIK media" on storage.objects
for select to authenticated using (bucket_id = 'cezik-creations' and owner_id = auth.uid()::text);
create policy "Users can upload into their own CEZIK media folder" on storage.objects
for insert to authenticated with check (
  bucket_id = 'cezik-creations'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "Users can update their own CEZIK media" on storage.objects
for update to authenticated using (bucket_id = 'cezik-creations' and owner_id = auth.uid()::text)
with check (bucket_id = 'cezik-creations' and owner_id = auth.uid()::text);
create policy "Users can delete their own CEZIK media" on storage.objects
for delete to authenticated using (bucket_id = 'cezik-creations' and owner_id = auth.uid()::text);
