-- CEZIK AI Studio: PayPal Sandbox credit purchases.
-- Additive only. This migration deliberately keeps the existing wallet,
-- transaction ledger, packages, and payments foundation unchanged.

create table public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  credit_package_id uuid not null references public.credit_packages(id) on delete restrict,
  credit_amount integer not null check (credit_amount > 0),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null check (char_length(currency) = 3),
  provider text not null check (provider = 'paypal'),
  paypal_order_id text,
  paypal_capture_id text,
  status text not null default 'created' check (status in (
    'created', 'approved', 'captured', 'credited', 'failed', 'cancelled',
    'refunded', 'reconciliation_required'
  )),
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  credited_at timestamptz,
  unique (provider, paypal_order_id),
  unique (provider, paypal_capture_id)
);

create index credit_purchases_user_created_at_idx
  on public.credit_purchases (user_id, created_at desc);
create index credit_purchases_status_created_at_idx
  on public.credit_purchases (status, created_at asc);

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'paypal'),
  environment text not null check (environment = 'sandbox'),
  provider_event_id text not null,
  event_type text not null,
  provider_created_at timestamptz,
  payload_hash text not null,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  processing_attempts integer not null default 1 check (processing_attempts > 0),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (provider, environment, provider_event_id)
);

create index billing_webhook_events_status_created_at_idx
  on public.billing_webhook_events (processing_status, created_at asc);

create trigger credit_purchases_touch_updated_at before update on public.credit_purchases
for each row execute function private.touch_updated_at();

-- Service-role only. This is the single, idempotent bridge from a verified
-- PayPal completed capture into CEZIK's existing locked wallet/ledger model.
create or replace function public.confirm_paypal_credit_purchase(
  p_purchase_id uuid,
  p_paypal_order_id text,
  p_paypal_capture_id text,
  p_amount numeric,
  p_currency text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_purchase public.credit_purchases;
  v_balance integer;
begin
  select * into v_purchase
  from public.credit_purchases
  where id = p_purchase_id and provider = 'paypal'
  for update;

  if not found then raise exception 'Credit purchase not found'; end if;
  if v_purchase.paypal_order_id is distinct from p_paypal_order_id then
    raise exception 'PayPal order does not match credit purchase';
  end if;
  if v_purchase.amount <> p_amount or upper(v_purchase.currency) <> upper(p_currency) then
    raise exception 'PayPal amount or currency does not match credit purchase';
  end if;
  if v_purchase.status = 'credited' then
    select balance into v_balance from public.credit_wallets where user_id = v_purchase.user_id;
    return coalesce(v_balance, 0);
  end if;
  if v_purchase.status in ('failed', 'cancelled', 'refunded', 'reconciliation_required') then
    raise exception 'Credit purchase cannot be credited from its current state';
  end if;
  if v_purchase.paypal_capture_id is not null and v_purchase.paypal_capture_id <> p_paypal_capture_id then
    raise exception 'PayPal capture does not match credit purchase';
  end if;

  update public.credit_purchases
  set paypal_capture_id = p_paypal_capture_id,
      status = 'captured',
      provider_metadata = provider_metadata || jsonb_build_object('capture_id', p_paypal_capture_id)
  where id = v_purchase.id;

  v_balance := private.add_credits(
    v_purchase.user_id,
    v_purchase.credit_amount,
    'credit_purchase',
    'paypal:' || v_purchase.id::text || ':' || p_paypal_capture_id,
    'Verified PayPal credit purchase ' || v_purchase.id::text
  );

  update public.credit_purchases
  set status = 'credited', credited_at = now()
  where id = v_purchase.id;
  return v_balance;
end;
$$;

alter table public.credit_purchases enable row level security;
alter table public.billing_webhook_events enable row level security;

create policy "Users can read their own credit purchases" on public.credit_purchases
for select to authenticated using (user_id = auth.uid());

revoke all on public.credit_purchases, public.billing_webhook_events from anon, authenticated;
grant select on public.credit_purchases to authenticated;
revoke all on function public.confirm_paypal_credit_purchase(uuid, text, text, numeric, text) from public;
grant execute on function public.confirm_paypal_credit_purchase(uuid, text, text, numeric, text) to service_role;
