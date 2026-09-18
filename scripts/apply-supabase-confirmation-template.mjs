import { readFile } from 'node:fs/promises'

const accessToken = process.env.SUPABASE_ACCESS_TOKEN
const projectRef = process.env.SUPABASE_PROJECT_REF || 'xbzfxdmvbstucxjjcrug'

if (!accessToken) {
  console.error('Missing SUPABASE_ACCESS_TOKEN. Create a Supabase personal access token and set it only in your terminal session.')
  process.exit(1)
}

const templateUrl = new URL('../supabase/email-templates/confirm-signup.html', import.meta.url)
const confirmationTemplate = await readFile(templateUrl, 'utf8')
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    mailer_subjects_confirmation: 'Confirm your CEZIK AI Studio account',
    mailer_templates_confirmation_content: confirmationTemplate,
  }),
})

if (!response.ok) {
  const detail = await response.text()
  console.error(`Supabase rejected the template update (${response.status}). ${detail}`)
  process.exit(1)
}

console.log('CEZIK confirmation email template is now live in Supabase.')
