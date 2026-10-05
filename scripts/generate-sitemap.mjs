import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const rawSiteUrl = process.env.VITE_SITE_URL?.trim()

if (!rawSiteUrl) {
  console.error('VITE_SITE_URL is required. Example: VITE_SITE_URL=https://www.example.com npm run seo:sitemap')
  process.exit(1)
}

let siteUrl
try {
  siteUrl = new URL(rawSiteUrl)
  if (!['http:', 'https:'].includes(siteUrl.protocol)) throw new Error('Unsupported protocol')
} catch {
  console.error('VITE_SITE_URL must be an absolute http(s) URL without a path. Example: https://www.example.com')
  process.exit(1)
}

if (siteUrl.pathname !== '/' || siteUrl.search || siteUrl.hash) {
  console.error('VITE_SITE_URL must contain only the site origin. Example: https://www.example.com')
  process.exit(1)
}

const origin = siteUrl.origin
const today = new Date().toISOString().slice(0, 10)
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`
const robots = `User-agent: *
Allow: /
Disallow: /auth
Disallow: /dashboard
Disallow: /projects
Disallow: /billing
Disallow: /account
Disallow: /settings
Disallow: /generate
Disallow: /image
Disallow: /editor
Disallow: /background-remover
Disallow: /image-compressor
Disallow: /image-resizer
Disallow: /image-converter

Sitemap: ${origin}/sitemap.xml
`

const publicDirectory = resolve('public')
await mkdir(publicDirectory, { recursive: true })
await Promise.all([
  writeFile(resolve(publicDirectory, 'sitemap.xml'), sitemap),
  writeFile(resolve(publicDirectory, 'robots.txt'), robots),
])

console.log(`Generated public sitemap and robots files for ${origin}`)
