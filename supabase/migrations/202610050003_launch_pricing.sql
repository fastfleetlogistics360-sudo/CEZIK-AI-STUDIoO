-- Launch pricing is intentionally conservative while CEZIK's active paid AI
-- workload is low-quality GPT Image 1 generation. Premium is configured as a
-- separate PayPal monthly plan at USD 9.99; this migration only sets one-time
-- credit packs held in CEZIK's database.

update public.credit_packages
set price = case name
  when 'Starter' then 3.99
  when 'Creator' then 14.99
  when 'Professional' then 34.99
  when 'Enterprise' then 99.99
  else price
end,
description = case name
  when 'Starter' then '100 clean-output credits for trying new ideas.'
  when 'Creator' then '500 clean-output credits for consistent creative work.'
  when 'Professional' then '1,500 clean-output credits for campaigns and client work.'
  when 'Enterprise' then '5,000 clean-output credits for high-volume studio workflows.'
  else description
end,
updated_at = now()
where name in ('Starter', 'Creator', 'Professional', 'Enterprise');
