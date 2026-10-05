-- Commit the enum addition separately so later migrations can safely use it.
alter type public.credit_transaction_type add value if not exists 'subscription_allowance';
