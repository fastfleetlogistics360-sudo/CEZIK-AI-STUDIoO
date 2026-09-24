-- CEZIK AI Studio: image-generation activity and private generated-image access.
-- Safe to run after 202609180001_credit_job_foundation.sql.

insert into public.ai_activities (
  slug, name, description, credit_cost, transaction_type, provider, enabled, input_schema
)
values (
  'image-generation',
  'AI Image Generator',
  'Create a production-ready image from a written prompt.',
  10,
  'ai_image',
  null,
  false,
  '{"prompt":{"type":"string","maxLength":2000},"size":{"type":"string","enum":["1024x1024","1536x1024","1024x1536"]}}'::jsonb
)
on conflict (slug) do nothing;

-- Generated files are written by a service-role worker, so owner_id is not
-- necessarily populated. Folder ownership keeps browser reads scoped to the
-- authenticated user's UUID without making the bucket public.
drop policy if exists "Users can read their own CEZIK media" on storage.objects;
create policy "Users can read their own CEZIK media" on storage.objects
for select to authenticated using (
  bucket_id = 'cezik-creations'
  and (storage.foldername(name))[1] = auth.uid()::text
);
