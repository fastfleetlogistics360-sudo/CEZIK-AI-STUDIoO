import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowRight, CheckCircle2, ChevronDown, Clapperboard, Clock3, Command, Copy, Eye, EyeOff,
  Download, Eraser, FileImage, FileVideo, FolderOpen, Image, LayoutDashboard, Maximize2, Minimize2,
  CreditCard, History, LoaderCircle, LockKeyhole, LogOut, Mail, MoreHorizontal, PanelLeftClose, Play, Plus, RefreshCw, Search, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Upload, UserRound, Video, WandSparkles, X, Zap
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { isActivityAvailable, loadStudioData, type Creation, type CreditPackage, type StudioData } from './lib/cezik'
import { acceptedImageTypes, addCezikWatermark, compressImage, convertImage, extensionByType, filenameFor, formatBytes, readImageDetails, removeBackground, resizeImage, validateImageFile, type ImageDetails, type OutputFormat } from './lib/image-processing'
import './styles.css'
import './neon.css'
import './image-generator.css'
import './native-image-tools.css'
import './product.css'

type Page = 'welcome' | 'auth' | 'home' | 'projects' | 'billing' | 'account' | 'settings' | 'generate' | 'image' | 'editor' | 'background-remover' | 'image-compressor' | 'image-resizer' | 'image-converter'
type AuthMode = 'signin' | 'signup' | 'reset'

const pagePaths: Record<Page, string> = {
  welcome: '/', auth: '/auth', home: '/dashboard', projects: '/projects', billing: '/billing', account: '/account', settings: '/settings',
  generate: '/generate', image: '/image', editor: '/editor', 'background-remover': '/background-remover', 'image-compressor': '/image-compressor', 'image-resizer': '/image-resizer', 'image-converter': '/image-converter',
}

function pageForPath(pathname: string): Page {
  const page = (Object.entries(pagePaths).find(([, path]) => path === pathname)?.[0] as Page | undefined)
  return page ?? 'welcome'
}

function isKnownPath(pathname: string) {
  return Object.values(pagePaths).includes(pathname)
}

function SeoMetadata({ page }: { page: Page }) {
  useEffect(() => {
    const isPublicPage = page === 'welcome'
    const title = isPublicPage ? 'CEZIK AI Studio | Create with AI' : 'CEZIK AI Studio'
    const description = isPublicPage
      ? 'CEZIK AI Studio is a creative workspace for AI-powered images, video, and practical image tools.'
      : 'CEZIK AI Studio workspace.'
    const updateMeta = (selector: string, attributes: Record<string, string>) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector)
      if (!element) { element = document.createElement('meta'); document.head.appendChild(element) }
      Object.entries(attributes).forEach(([key, value]) => element?.setAttribute(key, value))
    }
    document.title = title
    updateMeta('meta[name="description"]', { name: 'description', content: description })
    updateMeta('meta[name="robots"]', { name: 'robots', content: isPublicPage ? 'index,follow' : 'noindex,nofollow' })
    updateMeta('meta[property="og:title"]', { property: 'og:title', content: title })
    updateMeta('meta[property="og:description"]', { property: 'og:description', content: description })
    updateMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary' })
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical) }
    canonical.href = `${window.location.origin}${pagePaths[page]}`
    const structuredDataId = 'cezik-structured-data'
    document.getElementById(structuredDataId)?.remove()
    if (isPublicPage) {
      const structuredData = document.createElement('script')
      structuredData.id = structuredDataId
      structuredData.type = 'application/ld+json'
      structuredData.text = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'WebApplication', name: 'CEZIK AI Studio',
        url: `${window.location.origin}/`, applicationCategory: 'MultimediaApplication', operatingSystem: 'Web',
        description,
      })
      document.head.appendChild(structuredData)
    }
  }, [page])
  return null
}

type PayPalButtons = {
  render: (container: HTMLElement) => Promise<void> | void
  close?: () => void
}

type PayPalSdk = {
  Buttons: (options: {
    createOrder: () => Promise<string>
    onApprove: (data: { orderID: string }) => Promise<void>
    onCancel?: () => void
    onError?: () => void
  }) => PayPalButtons
}

declare global {
  interface Window { paypal?: PayPalSdk }
}

let paypalSdkPromise: Promise<void> | null = null
let paypalSdkCurrency: string | null = null
let paypalConfigPromise: Promise<{ clientId: string }> | null = null

function loadPaypalSdk(clientId: string, currency: string) {
  if (paypalSdkPromise) {
    if (paypalSdkCurrency !== currency) return Promise.reject(new Error('PayPal checkout is available in one currency at a time.'))
    return paypalSdkPromise
  }
  paypalSdkCurrency = currency
  paypalSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`
    script.async = true
    script.onload = () => window.paypal ? resolve() : reject(new Error('PayPal checkout did not load.'))
    script.onerror = () => reject(new Error('PayPal checkout could not load.'))
    document.head.appendChild(script)
  })
  paypalSdkPromise.catch(() => {
    paypalSdkPromise = null
    paypalSdkCurrency = null
  })
  return paypalSdkPromise
}

function loadPaypalConfig() {
  if (paypalConfigPromise) return paypalConfigPromise
  if (!supabase) return Promise.reject(new Error('Sign in to purchase credits.'))
  paypalConfigPromise = supabase.functions.invoke('paypal-sdk-config', { method: 'GET' }).then(({ data, error }) => {
    if (error || !data?.clientId) throw new Error('PayPal Sandbox is not configured.')
    return data as { clientId: string }
  }).catch((error) => {
    paypalConfigPromise = null
    throw error
  })
  return paypalConfigPromise
}

const navItems: { id: Page | null; label: string; icon: typeof LayoutDashboard; comingSoon?: boolean }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'projects', label: 'My Projects', icon: FolderOpen },
  { id: 'image', label: 'AI Image Generator', icon: Image },
  { id: 'background-remover', label: 'Background Remover', icon: Eraser },
  { id: 'generate', label: 'AI Video Generator', icon: Sparkles },
  { id: 'editor', label: 'AI Video Editor', icon: Clapperboard, comingSoon: true },
  { id: 'billing', label: 'Billing & credits', icon: CreditCard },
  { id: 'settings', label: 'Settings', icon: Settings },
]

type ProjectCardData = {
  id: string
  name: string
  type: string
  date: string
  status: string
  color: 'neon' | 'apex' | 'humanity' | 'aurelia' | 'future' | 'arc'
  assetUrl: string | null
}

type StudioContextValue = {
  data: StudioData | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const StudioContext = createContext<StudioContextValue | null>(null)
type AccountContextValue = { displayName: string | null; email: string | null; initials: string; signOut: () => Promise<Error | null> }
const AccountContext = createContext<AccountContextValue | null>(null)

function useStudio() {
  return useContext(StudioContext)
}

function useAccount() {
  return useContext(AccountContext)
}

function greetingForCurrentTime() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 22) return 'Good evening'
  return 'Welcome back'
}

function displayInitials(name: string | null, email: string | null) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (words.length) return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  return email?.slice(0, 2).toUpperCase() || 'CE'
}

const tools = [
  { name: 'Image Generator', description: 'Turn prompts into ready-to-use visuals', icon: Image, color: 'rose', page: 'image' as Page },
  { name: 'Video Generator', description: 'Turn ideas into cinematic video', icon: Sparkles, color: 'violet', page: 'generate' as Page },
  { name: 'AI Video Editor', description: 'Coming soon — AI-assisted video editing', icon: WandSparkles, color: 'blue', page: 'editor' as Page },
  { name: 'Background Remover', description: 'Remove a portrait background privately', icon: Eraser, color: 'mint', page: 'background-remover' as Page },
  { name: 'Image Compressor', description: 'Make JPGs and WebPs smaller locally', icon: Minimize2, color: 'cyan', page: 'image-compressor' as Page },
  { name: 'Image Resizer', description: 'Change image dimensions in your browser', icon: Maximize2, color: 'indigo', page: 'image-resizer' as Page },
  { name: 'Image Converter', description: 'Convert JPG, PNG, and WebP locally', icon: FileImage, color: 'orange', page: 'image-converter' as Page },
  { name: 'Enhance & Upscale', description: 'Coming soon — polish every frame in 4K', icon: Zap, color: 'amber', page: null },
]

const projectColors: ProjectCardData['color'][] = ['neon', 'apex', 'humanity', 'aurelia', 'future', 'arc']

function formatCreationDate(date: string) {
  const timestamp = new Date(date)
  if (Number.isNaN(timestamp.getTime())) return 'Created recently'
  return `Created ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)}`
}

function toProjectCard(creation: Creation, index: number): ProjectCardData {
  return {
    id: creation.id,
    name: creation.title,
    type: creation.type,
    date: formatCreationDate(creation.created_at),
    status: creation.status === 'completed' ? 'Ready' : creation.status,
    color: projectColors[index % projectColors.length],
    assetUrl: creation.assetUrl,
  }
}

function Logo({ markOnly = false }: { markOnly?: boolean }) {
  return <div className="logo neon-logo"><span className="logo-mark" />{!markOnly && <span className="logo-title">CEZIK <b>AI</b><small>STUDIO</small></span>}</div>
}

function Button({ children, variant = 'primary', onClick, className = '', disabled = false }: { children: ReactNode; variant?: 'primary' | 'ghost' | 'quiet'; onClick?: () => void; className?: string; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={`button ${variant} ${className}`}>{children}</button>
}

function TopBar({ onPage, title, compact = false }: { onPage: (p: Page) => void; title?: string; compact?: boolean }) {
  const account = useAccount()
  return <header className={`topbar ${compact ? 'compact' : ''}`}>
    <div className="mobile-logo"><Logo /></div>
    {title && <div className="page-title">{title}</div>}
    <div className="top-actions">
      <button className="profile" onClick={() => onPage('account')} aria-label="Open account"><span>{account?.initials ?? 'CE'}</span><ChevronDown size={15} /></button>
      {!compact && <Button onClick={() => onPage('image')}><Plus size={17} /> Create</Button>}
    </div>
  </header>
}

function Sidebar({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  const [open, setOpen] = useState(true)
  const studio = useStudio()
  const balance = studio?.data?.balance
  const account = useAccount()
  return <aside className={`sidebar ${open ? '' : 'collapsed'}`}>
    <div className="side-top"><Logo markOnly={!open} /><button onClick={() => setOpen(!open)} className="collapse" aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}><PanelLeftClose size={18} /></button></div>
    <nav>{navItems.map(({ id, label, icon: Icon, comingSoon }) => <button key={label} onClick={() => id && onPage(id)} disabled={!id} aria-label={label} className={`nav-item ${page === id ? 'active' : ''}`}><Icon size={19} /><span>{label}</span>{comingSoon && <em>SOON</em>}</button>)}</nav>
    <div className="side-bottom">
      {open && <div className="usage-card"><span>CEZIK CREDITS</span><strong>{studio?.loading ? '…' : balance ?? '—'} <i>available</i></strong><div className="progress"><b style={{ width: balance === undefined ? '0%' : `${Math.min(100, Math.max(4, balance / 10))}%` }} /></div><button onClick={() => onPage('billing')}>Manage credits <ArrowRight size={13} /></button></div>}
      <button className="account" onClick={() => onPage('account')} aria-label="Open account"><span className="avatar">{account?.initials ?? 'CE'}</span>{open && <span><strong>{account?.displayName ?? 'Your account'}</strong><small>{account?.email ?? 'Account details'}</small></span>}<MoreHorizontal size={18} /></button>
    </div>
  </aside>
}

function Shell({ page, onPage, children, title, editor = false }: { page: Page; onPage: (p: Page) => void; children: ReactNode; title?: string; editor?: boolean }) {
  return <div className={`app-shell ${editor ? 'editor-shell' : ''}`}><Sidebar page={page} onPage={onPage} /><main><TopBar onPage={onPage} title={title} compact={editor} />{children}</main></div>
}

function Welcome({ onAuth, onExplore }: { onAuth: (mode: AuthMode) => void; onExplore: () => void }) {
  return <div className="welcome">
    <header className="welcome-nav"><Logo /><div className="welcome-actions"><Button variant="quiet" onClick={() => onAuth('signin')}>Sign in</Button><Button onClick={() => onAuth('signup')}>Start creating <ArrowRight size={16} /></Button></div></header>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className="hero">
      <div className="eyebrow"><span /><span>THE CREATIVE OPERATING SYSTEM</span></div>
      <h1>Shape the impossible<br /><i>into moving stories.</i></h1>
      <p>CEZIK AI Studio brings every part of video creation into one intelligent, effortless creative environment.</p>
      <div className="hero-cta"><Button onClick={() => onAuth('signup')}>Start creating free <ArrowRight size={17} /></Button><Button variant="ghost" onClick={onExplore}><Play size={15} fill="currentColor" /> Explore the studio</Button></div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="floating-card card-left"><span className="tiny-label">AI DIRECTOR</span><div className="waveform">⌁⌁⌁⌁⌁⌁</div><strong>Refine the lighting<br />and make it feel cinematic.</strong></div>
        <div className="floating-card card-right"><span className="spark-icon">✦</span><span>Generation complete</span><b>00:16</b></div>
        <div className="hero-core"><div className="core-rings" /><span><Logo markOnly /></span></div>
        <div className="horizon" />
      </div>
    </section>
    <footer className="welcome-foot"><span>MADE FOR THE NEXT ERA OF CREATIVITY</span><div><span>GENERATE</span><i /> <span>EDIT</span><i /> <span>PUBLISH</span></div></footer>
  </div>
}

function Dashboard({ onPage }: { onPage: (p: Page) => void }) {
  const studio = useStudio()
  const account = useAccount()
  const projects = (studio?.data?.creations ?? []).map(toProjectCard)
  return <Shell page="home" onPage={onPage}><div className="content dashboard">
    <section className="dashboard-hero"><div><span className="overline">YOUR CEZIK WORKSPACE</span><h1>{greetingForCurrentTime()}{account?.displayName ? `, ${account.displayName}` : ''}.</h1><p>Choose a tool or continue with your recent work.</p></div><Button onClick={() => onPage('image')}><Sparkles size={17} /> Create with AI</Button></section>
    <section className="credit-summary"><div><span className="overline">CEZIK CREDITS</span><strong>{studio?.loading ? 'Loading…' : studio?.data ? studio.data.balance.toLocaleString() : 'Unavailable'}</strong><p>{studio?.error ? 'Your wallet could not be loaded. Please refresh and try again.' : 'Your credits and purchases are verified server-side.'}</p></div><Button variant="ghost" onClick={() => onPage('billing')}>Manage credits <ArrowRight size={15} /></Button></section>
    <section className="tool-grid">{tools.map(({ name: toolName, description, icon: Icon, color, page }) => <button className="tool-card" key={toolName} onClick={() => page && onPage(page)} disabled={!page}><span className={`tool-icon ${color}`}><Icon size={21} /></span><span><strong>{toolName}</strong><small>{description}</small></span>{page ? <ArrowRight size={18} /> : <Clock3 size={17} />}</button>)}</section>
    <section className="section-heading"><div><h2>Continue creating</h2><p>Your recent projects</p></div><button onClick={() => onPage('projects')} className="text-button">View all <ArrowRight size={15} /></button></section>
    <section className="project-row">{projects.length > 0 ? projects.slice(0, 4).map((project) => <ProjectCard key={project.id} project={project} />) : <button className="empty-projects" onClick={() => onPage('image')}><Image size={20} /><strong>Your creations will appear here</strong><small>Start with an AI image prompt once the provider is activated.</small></button>}<button onClick={() => onPage('projects')} className="all-projects"> <FolderOpen size={22} /><span>View all creations</span><ArrowRight size={16} /></button></section>
    <section className="inspiration"><div><span className="overline">EXPLORE THE POSSIBLE</span><h2>Made to make your<br /><i>best work yet.</i></h2><Button variant="ghost" onClick={() => onPage('generate')}>Try video generation <ArrowRight size={16} /></Button></div><div className="inspiration-art"><div className="art-ball" /><div className="art-column" /><span>01<br /><b>CREATE</b></span></div></section>
  </div></Shell>
}

function PayPalCheckoutButton({ creditPackage, onComplete }: { creditPackage: CreditPackage; onComplete: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const orderInProgress = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    let buttons: PayPalButtons | undefined
    let purchaseId: string | null = null
    const client = supabase
    setReady(false)
    const render = async () => {
      if (!client || !container.current) { if (active) setMessage('Sign in to purchase credits.'); return }
      try {
        const config = await loadPaypalConfig()
        await loadPaypalSdk(config.clientId, creditPackage.currency)
        if (!active || !container.current || !window.paypal) return
        buttons = window.paypal.Buttons({
          createOrder: async () => {
            if (orderInProgress.current) throw new Error('A secure checkout is already being created.')
            orderInProgress.current = true
            setMessage('Creating secure checkout…')
            try {
              const { data, error } = await client.functions.invoke('create-paypal-credit-order', { body: { packageId: creditPackage.id } })
              if (error || !data?.orderId || !data?.purchaseId) throw new Error(data?.error ?? 'Could not create PayPal checkout.')
              purchaseId = data.purchaseId
              setMessage(null)
              return data.orderId
            } finally { orderInProgress.current = false }
          },
          onApprove: async () => {
            if (!purchaseId) throw new Error('Credit purchase was not initialized.')
            setMessage('Confirming payment and adding credits…')
            const { data, error } = await client.functions.invoke('capture-paypal-credit-order', { body: { purchaseId } })
            if (error || data?.status !== 'credited') throw new Error(data?.error ?? 'Payment is processing. Check purchase history shortly.')
            if (active) { setMessage('Credits added successfully.'); onComplete() }
          },
          onCancel: () => { if (active) setMessage('Checkout cancelled. No credits were added.') },
          onError: () => { if (active) setMessage('Checkout could not be completed. No credits were added.') },
        })
        await buttons.render(container.current)
        if (active) setReady(true)
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'PayPal checkout is unavailable.')
      }
    }
    void render()
    return () => { active = false; buttons?.close?.(); if (container.current) container.current.replaceChildren() }
  }, [creditPackage.id, creditPackage.currency, onComplete])
  return <div className="paypal-checkout" aria-busy={!ready && !message}><div ref={container} />{message ? <small role="status">{message}</small> : !ready && <small role="status">Preparing secure checkout…</small>}</div>
}

function ProjectCard({ project }: { project: ProjectCardData }) { return <article className="project-card"><div className={`project-thumb ${project.color}`}>{project.assetUrl && <img src={project.assetUrl} alt="" />}<span className="duration">{project.type}</span></div><div className="project-info"><div><strong>{project.name}</strong><small>{project.type}</small></div></div><div className="project-meta"><span>{project.date}</span><b className={project.status === 'Ready' ? 'ready' : ''}>{project.status}</b></div></article> }

function Projects({ onPage }: { onPage: (p: Page) => void }) {
  const [query, setQuery] = useState('')
  const studio = useStudio()
  const projects = useMemo(() => (studio?.data?.creations ?? []).map(toProjectCard), [studio?.data?.creations])
  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())), [projects, query])
  return <Shell page="projects" onPage={onPage} title="My Projects"><div className="content projects-page">
    <section className="page-head"><div><span className="overline">YOUR WORKSPACE</span><h1>My Creations</h1><p>Every completed CEZIK job, in one place.</p></div><Button onClick={() => onPage('generate')}><Plus size={17} /> New project</Button></section>
    <div className="project-controls"><label><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search creations" />{query && <button onClick={() => setQuery('')}><X size={15} /></button>}</label><Button variant="ghost" disabled><SlidersHorizontal size={16} /> Filters soon</Button><Button variant="ghost" disabled>Newest first <ChevronDown size={15} /></Button></div>
    <div className="projects-grid">{shown.map((project) => <ProjectCard key={project.id} project={project} />)}{shown.length === 0 && <div className="creation-empty"><Sparkles size={21} /><strong>{studio?.loading ? 'Loading your creations…' : 'No creations yet'}</strong><small>{studio?.error ? 'Your creations could not be loaded. Please refresh and try again.' : 'Generated videos and images will appear here.'}</small></div>}<button className="new-card" onClick={() => onPage('generate')}><span><Plus size={22} /></span><strong>Start a new project</strong><small>Bring your next idea to life</small></button></div>
  </div></Shell>
}

const pillOptions = { style: ['Cinematic', 'Product film', 'Animation', 'Documentary'], ratio: ['16:9', '9:16', '1:1', '4:5'], duration: ['5 seconds', '10 seconds', '15 seconds'], quality: ['Standard', 'High', 'Ultra 4K'] }
function Generator({ onPage }: { onPage: (p: Page) => void }) {
  const [prompt, setPrompt] = useState('')
  const [selected, setSelected] = useState<Record<string, string>>({ style: 'Cinematic', ratio: '16:9', duration: '10 seconds', quality: 'High' })
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; title: string; detail: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const studio = useStudio()
  const activity = studio?.data?.activity ?? null
  const available = isActivityAvailable(activity)
  const cost = activity?.credit_cost

  const submitGeneration = async () => {
    const cleanPrompt = prompt.trim()
    setFeedback(null)
    if (!cleanPrompt) {
      setFeedback({ type: 'error', title: 'Describe your video first', detail: 'A prompt is required before a generation can begin.' })
      return
    }
    if (!activity) {
      setFeedback({ type: 'error', title: 'Pricing is unavailable', detail: 'Finish the CEZIK database setup before starting a generation.' })
      return
    }
    if (!available) {
      setFeedback({ type: 'info', title: 'Video generation is coming soon', detail: `The activity is priced at ${activity.credit_cost} credits, but no secure provider has been connected yet. No credits were used.` })
      return
    }
    if (!supabase) return
    setSubmitting(true)
    try {
      const { data, error } = await supabase.functions.invoke('submit-ai-job', {
        body: {
          activitySlug: activity.slug,
          idempotencyKey: crypto.randomUUID(),
          input: {
            prompt: cleanPrompt,
            style: selected.style,
            aspect_ratio: selected.ratio,
            duration: selected.duration,
            quality: selected.quality,
          },
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await studio?.refresh()
      setFeedback({ type: 'success', title: 'Your video job is queued', detail: 'CEZIK is processing your request. Its live status will appear in My Creations.' })
    } catch (error) {
      setFeedback({ type: 'error', title: 'Your generation could not start', detail: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return <Shell page="generate" onPage={onPage} title="AI Video Generator"><div className="content generator">
    <section className="generator-head"><span className="overline"><Sparkles size={13} /> CEZIK GENERATE</span><h1>Turn a thought into a <i>world.</i></h1><p>Describe what you want to see. We’ll take care of the impossible details.</p></section>
    <section className="generator-credit-bar"><span><Sparkles size={15} /> Your CEZIK Credits</span><strong>{studio?.loading ? 'Loading…' : studio?.data ? studio.data.balance.toLocaleString() : 'Unavailable'}</strong><i>{cost ? `${cost} credits per generation` : 'Loading activity pricing…'}</i></section>
    <div className="generator-layout"><section className="prompt-column"><div className="prompt-box"><div className="prompt-top"><span><WandSparkles size={16} /> Your prompt</span><small>{prompt.length} / 2,000</small></div><textarea maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} /><div className="prompt-bottom"><button disabled><Command size={13} /> Prompt assist soon</button><button disabled><Copy size={14} /> Paste soon</button></div></div>
      <div className="ref-upload"><span><Upload size={18} /></span><div><strong>Reference media <em>Optional</em></strong><small>Uploads will be available when the media pipeline is connected.</small></div><Button variant="ghost" disabled>Coming soon</Button></div>
      <div className="generation-note"><span>✦</span><p>Every successful generation is saved privately to <b>My Creations</b>.</p></div>
    </section><aside className="settings-card"><h3>Creation settings</h3>{Object.entries(pillOptions).map(([key, values]) => <div className="setting" key={key}><label>{key === 'ratio' ? 'Aspect ratio' : key[0].toUpperCase() + key.slice(1)}</label><div className="pills">{values.map((value) => <button onClick={() => setSelected({ ...selected, [key]: value })} key={value} className={selected[key] === value ? 'selected' : ''}>{key === 'ratio' && <i className={`ratio r-${value.replace(':', '-')}`} />}{value}</button>)}</div></div>)}<Button className="generate-button" onClick={submitGeneration} disabled={submitting}><Sparkles size={17} /> {submitting ? 'Starting job…' : available ? 'Generate video' : 'Video generation coming soon'} <span>{cost ? `${cost} credits` : '—'}</span></Button></aside></div>
    {feedback && <div className={`generated-toast ${feedback.type}`}><span>{feedback.type === 'error' ? <X size={18} /> : <Sparkles size={18} />}</span><div><strong>{feedback.title}</strong><p>{feedback.detail}</p></div>{feedback.type === 'success' && <button onClick={() => onPage('projects')}>View creations <ArrowRight size={15} /></button>}</div>}
  </div></Shell>
}

const imageSizes = [
  { label: 'Square', value: '1024x1024', className: 'r-1-1' },
  { label: 'Landscape', value: '1536x1024', className: 'r-16-9' },
  { label: 'Portrait', value: '1024x1536', className: 'r-9-16' },
]

function ImageGenerator({ onPage }: { onPage: (p: Page) => void }) {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [submitting, setSubmitting] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultWatermarked, setResultWatermarked] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; title: string; detail: string } | null>(null)
  const studio = useStudio()
  const activity = studio?.data?.imageActivity ?? null
  const available = isActivityAvailable(activity)
  const cost = activity?.credit_cost
  const imageHistory = (studio?.data?.creations ?? []).filter((creation) => creation.type === 'image')

  const downloadImage = async (url: string, filename: string) => {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error('Download unavailable')
      const objectUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const generateImage = async () => {
    const cleanPrompt = prompt.trim()
    setFeedback(null)
    if (!cleanPrompt) {
      setFeedback({ type: 'error', title: 'Describe the image first', detail: 'A prompt is required before a generation can begin.' })
      return
    }
    if (!activity) {
      setFeedback({ type: 'error', title: 'Image pricing is unavailable', detail: 'Run the image-generation database migration before starting a generation.' })
      return
    }
    if (!available) {
      setFeedback({ type: 'info', title: 'Image generation is not activated yet', detail: `The activity is priced at ${activity.credit_cost} credits. Add the provider secret and activate the database activity; no credits were used.` })
      return
    }
    if (!supabase) return
    setSubmitting(true)
    try {
      const { data, error } = await supabase.functions.invoke('submit-ai-job', {
        body: { activitySlug: activity.slug, idempotencyKey: crypto.randomUUID(), input: { prompt: cleanPrompt, size } },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      const storagePath = data?.creation?.storage_path as string | undefined
      if (!storagePath) throw new Error('The image was created but its private asset could not be located.')
      const { data: signedAsset, error: signedAssetError } = await supabase.storage.from('cezik-creations').createSignedUrl(storagePath, 60 * 60)
      if (signedAssetError || !signedAsset?.signedUrl) throw new Error('The image was created but could not be opened.')
      setResultUrl(signedAsset.signedUrl)
      setResultWatermarked(Boolean(data?.creation?.watermark_required))
      await studio?.refresh()
      setFeedback({ type: 'success', title: 'Your image is ready', detail: data?.creation?.watermark_required ? 'Your free generation has a transparent CEZIK watermark. Buy credits or upgrade for clean outputs.' : 'It is saved privately to My Creations and your credit balance has been updated.' })
    } catch (error) {
      setFeedback({ type: 'error', title: 'Your image could not be generated', detail: error instanceof Error ? error.message : 'Please try again. Any failed generation is refunded automatically.' })
    } finally {
      setSubmitting(false)
    }
  }

  return <Shell page="image" onPage={onPage} title="AI Image Generator"><div className="content generator image-generator">
    <section className="generator-head"><span className="overline"><Image size={13} /> CEZIK IMAGES</span><h1>Make the imagined <i>visible.</i></h1><p>Describe the visual, choose a composition, and create a private, downloadable image.</p></section>
    <section className="generator-credit-bar"><span><Sparkles size={15} /> Your CEZIK Credits</span><strong>{studio?.loading ? 'Loading…' : studio?.data ? studio.data.balance.toLocaleString() : 'Unavailable'}</strong><i>{cost ? `${cost} credits per image` : 'Run the image migration to load pricing'}</i></section>
    <div className="generator-layout"><section className="prompt-column"><div className="prompt-box"><div className="prompt-top"><span><WandSparkles size={16} /> Your prompt</span><small>{prompt.length} / 2,000</small></div><textarea maxLength={2000} value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="prompt-bottom"><span>Images are generated securely and stored in your private workspace.</span></div></div>
      {resultUrl ? <section className="image-result"><div className="image-result-head"><span><CheckCircle2 size={16} /> Latest generation{resultWatermarked ? ' · Free export' : ''}</span><div><Button variant="ghost" onClick={() => void downloadImage(resultUrl, resultWatermarked ? 'cezik-image-watermarked.svg' : 'cezik-image.png')}><Download size={15} /> Download</Button><Button variant="ghost" onClick={generateImage} disabled={submitting}><RefreshCw size={15} /> Regenerate</Button></div></div><img src={resultUrl} alt={prompt} /></section> : <div className="generation-note"><span>✦</span><p>Your completed images are saved privately to <b>My Creations</b>.</p></div>}
    </section><aside className="settings-card"><h3>Image settings</h3><div className="setting"><label>Composition</label><div className="pills">{imageSizes.map((option) => <button onClick={() => setSize(option.value)} key={option.value} className={size === option.value ? 'selected' : ''}><i className={`ratio ${option.className}`} />{option.label}</button>)}</div></div><p className="setting-note">Quality, style, and multi-image controls will be added only when the selected provider supports them.</p><Button className="generate-button" onClick={generateImage} disabled={submitting}><Image size={17} /> {submitting ? 'Generating image…' : available ? 'Generate image' : 'Image generation unavailable'} <span>{cost ? `${cost} credits` : '—'}</span></Button></aside></div>
    {feedback && <div className={`generated-toast ${feedback.type}`}><span>{feedback.type === 'error' ? <X size={18} /> : <Sparkles size={18} />}</span><div><strong>{feedback.title}</strong><p>{feedback.detail}</p></div>{feedback.type === 'success' && <button onClick={() => onPage('projects')}>View creations <ArrowRight size={15} /></button>}</div>}
    <section className="image-history"><div className="section-heading"><div><h2>Image history</h2><p>Your most recent private generations</p></div><button onClick={() => onPage('projects')} className="text-button">View all <ArrowRight size={15} /></button></div><div className="image-history-grid">{imageHistory.length ? imageHistory.slice(0, 6).map((creation) => <article key={creation.id} className="image-history-card">{creation.assetUrl ? <img src={creation.assetUrl} alt={creation.title} /> : <div className="image-history-empty"><Image size={20} /></div>}<span>{creation.title}</span>{creation.assetUrl && <button onClick={() => void downloadImage(creation.assetUrl!, creation.watermark_required ? 'cezik-image-watermarked.svg' : 'cezik-image.png')} aria-label={`Download ${creation.title}`}><Download size={15} /></button>}</article>) : <div className="creation-empty"><Image size={21} /><strong>No images yet</strong><small>Your completed image generations will appear here.</small></div>}</div></section>
  </div></Shell>
}

type NativeToolKind = 'background-remover' | 'image-compressor' | 'image-resizer' | 'image-converter'

const nativeToolCopy: Record<NativeToolKind, { title: string; accent: string; description: string; icon: typeof Image }> = {
  'background-remover': { title: 'Remove the background.', accent: 'Keep the subject.', description: 'Made for portraits. The open-source model runs in your browser and makes a transparent PNG.', icon: Eraser },
  'image-compressor': { title: 'Make the file lighter.', accent: 'Keep the look.', description: 'Create a smaller JPG or WebP without uploading your image anywhere.', icon: Minimize2 },
  'image-resizer': { title: 'Resize with control.', accent: 'Keep it sharp.', description: 'Set exact dimensions and export the result directly from your browser.', icon: Maximize2 },
  'image-converter': { title: 'Convert simply.', accent: 'Keep creating.', description: 'Turn a JPG, PNG, or WebP into the format you need, right here in CEZIK.', icon: FileImage },
}

function NativeImageTool({ kind, onPage }: { kind: NativeToolKind; onPage: (p: Page) => void }) {
  const studio = useStudio()
  const copy = nativeToolCopy[kind]
  const Icon = copy.icon
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [sourceDetails, setSourceDetails] = useState<ImageDetails | null>(null)
  const [resultDetails, setResultDetails] = useState<ImageDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [workLabel, setWorkLabel] = useState('Processing image…')
  const [quality, setQuality] = useState(0.75)
  const [format, setFormat] = useState<OutputFormat>('image/png')
  const [width, setWidth] = useState(1200)
  const [height, setHeight] = useState(1200)
  const [lockedRatio, setLockedRatio] = useState(true)
  const sourceRef = useRef<string | null>(null)
  const resultRef = useRef<string | null>(null)
  const watermarkRequired = studio?.data?.subscription?.status !== 'active'

  useEffect(() => () => {
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current)
    if (resultRef.current) URL.revokeObjectURL(resultRef.current)
  }, [])

  const chooseFile = async (chosen: File | undefined) => {
    if (!chosen) return
    setError(null)
    const fileError = validateImageFile(chosen)
    if (fileError) { setError(fileError); return }
    try {
      const details = await readImageDetails(chosen)
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current)
      if (resultRef.current) URL.revokeObjectURL(resultRef.current)
      const nextUrl = URL.createObjectURL(chosen)
      sourceRef.current = nextUrl
      resultRef.current = null
      setFile(chosen)
      setSourceUrl(nextUrl)
      setResultUrl(null)
      setSourceDetails(details)
      setResultDetails(null)
      setWidth(details.width)
      setHeight(details.height)
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'This image could not be opened.')
    }
  }

  const changeWidth = (next: number) => {
    setWidth(next)
    if (lockedRatio && sourceDetails && next > 0) setHeight(Math.max(1, Math.round(next * sourceDetails.height / sourceDetails.width)))
  }

  const changeHeight = (next: number) => {
    setHeight(next)
    if (lockedRatio && sourceDetails && next > 0) setWidth(Math.max(1, Math.round(next * sourceDetails.width / sourceDetails.height)))
  }

  const processImage = async () => {
    if (!file) return
    setError(null)
    setWorking(true)
    setWorkLabel(kind === 'background-remover' ? 'Preparing background remover…' : 'Processing image…')
    try {
      const output = kind === 'background-remover'
        ? await removeBackground(file, (percent) => setWorkLabel(percent < 100 ? `Downloading private model… ${Math.round(percent)}%` : 'Removing background…'))
        : kind === 'image-compressor'
          ? await compressImage(file, format === 'image/png' ? 'image/webp' : format, quality)
          : kind === 'image-resizer'
            ? await resizeImage(file, width, height, format)
            : await convertImage(file, format)
      const outputType = kind === 'background-remover' ? 'image/png' : kind === 'image-compressor' && format === 'image/png' ? 'image/webp' : format
      const deliveredOutput = watermarkRequired ? await addCezikWatermark(output, outputType) : output
      if (resultRef.current) URL.revokeObjectURL(resultRef.current)
      const nextUrl = URL.createObjectURL(deliveredOutput)
      resultRef.current = nextUrl
      setResultUrl(nextUrl)
      setResultDetails(await readImageDetails(deliveredOutput))
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : 'The image could not be processed. Please try another image.')
    } finally {
      setWorking(false)
    }
  }

  const downloadResult = () => {
    if (!file || !resultUrl) return
    const outputType = kind === 'background-remover' ? 'image/png' : kind === 'image-compressor' && format === 'image/png' ? 'image/webp' : format
    const anchor = document.createElement('a')
    anchor.href = resultUrl
    anchor.download = filenameFor(file, extensionByType[outputType])
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const outputLabel = kind === 'background-remover' ? 'Remove background' : kind === 'image-compressor' ? 'Compress image' : kind === 'image-resizer' ? 'Resize image' : 'Convert image'
  const acceptedFormats = acceptedImageTypes.join(',')
  return <Shell page={kind} onPage={onPage} title={copy.title.replace('.', '')}><div className="content native-tool-page">
    <section className="native-tool-head"><span className="overline"><Icon size={13} /> CEZIK NATIVE TOOLS</span><h1>{copy.title} <i>{copy.accent}</i></h1><p>{copy.description}</p></section>
    <div className="native-private-note"><LockKeyhole size={16} /><span><strong>Private by default.</strong> Your image stays on this device. Nothing is sent to CEZIK storage and no credits are used.{watermarkRequired ? ' Free exports include a transparent CEZIK watermark.' : ' Premium exports are clean.'}</span></div>
    <section className="native-tool-layout">
      <div className="native-workspace">
        <label className={`native-upload ${file ? 'has-file' : ''}`}><input type="file" accept={acceptedFormats} onChange={(event) => void chooseFile(event.target.files?.[0])} /><Upload size={22} /><strong>{file ? 'Choose a different image' : 'Choose an image'}</strong><small>JPG, PNG, or WebP · up to 12 MB</small></label>
        {error && <div className="native-error"><X size={17} /><span>{error}</span></div>}
        {sourceUrl && <div className="native-preview-grid"><article><div className="native-preview-label">Before</div><div className="native-image-frame"><img src={sourceUrl} alt="Original upload" /></div><small>{sourceDetails && `${sourceDetails.width} × ${sourceDetails.height} · ${formatBytes(sourceDetails.bytes)}`}</small></article><article className="native-result"><div className="native-preview-label">After</div><div className="native-image-frame checkerboard">{resultUrl ? <img src={resultUrl} alt="Processed result" /> : <span>{working ? workLabel : 'Your result will appear here'}</span>}</div><small>{resultDetails ? `${resultDetails.width} × ${resultDetails.height} · ${formatBytes(resultDetails.bytes)}` : 'Not uploaded or saved automatically'}</small>{resultUrl && <Button variant="ghost" onClick={downloadResult}><Download size={15} /> Download result</Button>}</article></div>}
      </div>
      <aside className="native-settings-card"><h3>{kind === 'background-remover' ? 'Portrait processing' : 'Export settings'}</h3>
        {kind === 'background-remover' && <p className="setting-note">The first run downloads the MODNet model to this browser. It is best for people and portrait-style photos. The result is always a transparent PNG.</p>}
        {kind === 'image-compressor' && <><div className="setting"><label>Output format</label><div className="pills"><button className={format === 'image/jpeg' ? 'selected' : ''} onClick={() => setFormat('image/jpeg')}>JPG</button><button className={format === 'image/webp' ? 'selected' : ''} onClick={() => setFormat('image/webp')}>WebP</button></div></div><div className="setting"><label>Quality <b>{Math.round(quality * 100)}%</b></label><input className="native-range" type="range" min="0.35" max="0.95" step="0.05" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /><small>Lower is smaller; higher keeps more detail.</small></div></>}
        {kind === 'image-resizer' && <><div className="native-size-fields"><label>Width<input type="number" min="1" max="6000" value={width} onChange={(event) => changeWidth(Number(event.target.value))} /></label><span>×</span><label>Height<input type="number" min="1" max="6000" value={height} onChange={(event) => changeHeight(Number(event.target.value))} /></label></div><label className="native-check"><input type="checkbox" checked={lockedRatio} onChange={(event) => setLockedRatio(event.target.checked)} /> Keep proportions</label><div className="setting"><label>Output format</label><select value={format} onChange={(event) => setFormat(event.target.value as OutputFormat)}><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></div></>}
        {kind === 'image-converter' && <div className="setting"><label>Convert to</label><select value={format} onChange={(event) => setFormat(event.target.value as OutputFormat)}><option value="image/png">PNG — supports transparency</option><option value="image/jpeg">JPG — small photo file</option><option value="image/webp">WebP — modern compact file</option></select></div>}
        <Button className="generate-button native-process-button" onClick={processImage} disabled={!file || working}><Icon size={17} /> {working ? workLabel : outputLabel}</Button>
      </aside>
    </section>
  </div></Shell>
}

function Billing({ onPage }: { onPage: (p: Page) => void }) {
  const studio = useStudio()
  const packages = studio?.data?.packages ?? []
  const purchases = studio?.data?.purchases ?? []
  const transactions = studio?.data?.transactions ?? []
  const subscription = studio?.data?.subscription ?? null
  const [premiumMessage, setPremiumMessage] = useState<string | null>(null)
  const [startingPremium, setStartingPremium] = useState(false)
  const startPremium = async () => {
    if (!supabase) return
    setStartingPremium(true); setPremiumMessage(null)
    try {
      const { data, error } = await supabase.functions.invoke('create-paypal-premium-subscription', { method: 'POST' })
      if (error || !data?.approveUrl) throw new Error(data?.error ?? 'Premium checkout could not be started.')
      window.location.assign(data.approveUrl)
    } catch (error) {
      setPremiumMessage(error instanceof Error ? error.message : 'Premium checkout could not be started.')
      setStartingPremium(false)
    }
  }
  const premiumActive = subscription?.status === 'active'
  return <Shell page="billing" onPage={onPage} title="Billing & credits"><div className="content billing-page">
    <section className="page-head"><div><span className="overline">CEZIK CREDITS</span><h1>Billing & credits</h1><p>Use free credits with watermarked exports, buy clean-output credits when needed, or unlock Premium.</p></div><div className="balance-panel"><span>Available now</span><strong>{studio?.loading ? '…' : studio?.data?.balance.toLocaleString() ?? '—'}</strong><small>credits</small></div></section>
    {studio?.error ? <div className="data-state error"><X size={18} /><div><strong>Billing data is unavailable</strong><p>{studio.error}</p></div><Button variant="ghost" onClick={() => void studio?.refresh()}>Try again</Button></div> : <><section className="premium-card"><div><span className="overline">CEZIK PREMIUM</span><h2>{premiumActive ? 'Premium is active' : 'Make every export clean.'}</h2><p>{premiumActive ? `${subscription?.subscription_plans?.included_credits.toLocaleString() ?? 'Included'} credits renew each month. Your paid-generation and Premium exports are watermark-free.` : 'All tools, priority processing, 1,000 included credits every month, and clean exports. Extra credit packs are also clean.'}</p>{subscription?.current_period_end && <small>Current period ends {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(subscription.current_period_end))}.</small>}</div>{premiumActive ? <span className="premium-status"><ShieldCheck size={17} /> Active</span> : <Button onClick={() => void startPremium()} disabled={startingPremium || subscription?.status === 'approval_pending'}>{startingPremium ? 'Opening PayPal…' : subscription?.status === 'approval_pending' ? 'Awaiting approval' : 'Get Premium'} <ArrowRight size={15} /></Button>}</section>{premiumMessage && <div className="data-state error"><X size={18} /><div><strong>Premium checkout</strong><p>{premiumMessage}</p></div></div>}
    <section className="billing-section"><div className="section-heading"><div><h2>Add clean-output credits</h2><p>Credit packs do not expire under this policy and remove the watermark only from generations they fund.</p></div></div><div className="package-grid">{studio?.loading ? <div className="package-loading">Loading available credit packages…</div> : packages.length ? packages.map((creditPackage) => <article className="package-card" key={creditPackage.id}><span>{creditPackage.name}</span><strong>{creditPackage.credits.toLocaleString()} <i>credits</i></strong><p>{creditPackage.description}</p><b>{new Intl.NumberFormat(undefined, { style: 'currency', currency: creditPackage.currency }).format(Number(creditPackage.price))}</b><PayPalCheckoutButton creditPackage={creditPackage} onComplete={() => void studio?.refresh()} /></article>) : <div className="package-loading">No credit packages are available right now.</div>}</div></section>
    <section className="billing-history"><div><h2>Recent credit activity</h2><p>Only successful, server-recorded ledger entries appear here.</p></div>{transactions.length ? <div className="activity-list">{transactions.map((transaction) => <div key={transaction.id}><div><strong>{transaction.description}</strong><small>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transaction.created_at))}</small></div><span className={transaction.amount > 0 ? 'positive' : ''}>{transaction.amount > 0 ? '+' : ''}{transaction.amount.toLocaleString()} credits</span></div>)}</div> : <div className="data-state"><History size={18} /><div><strong>No credit activity yet</strong><p>Your purchases and generation usage will appear after they are processed.</p></div></div>}</section>
    <section className="billing-history"><div><h2>Purchase history</h2><p>Payment status is refreshed after PayPal verification.</p></div>{purchases.length ? <div className="activity-list">{purchases.map((purchase) => <div key={purchase.id}><div><strong>{purchase.credit_packages?.name ?? 'Credit package'} · {purchase.credit_amount.toLocaleString()} credits</strong><small>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(purchase.created_at))}</small></div><span>{purchase.status}</span></div>)}</div> : <div className="data-state"><CreditCard size={18} /><div><strong>No purchases yet</strong><p>Completed and pending credit purchases will appear here.</p></div></div>}</section></>}
  </div></Shell>
}

function Account({ onPage }: { onPage: (p: Page) => void }) {
  const account = useAccount()
  const studio = useStudio()
  const profile = studio?.data?.profile
  const createdAt = profile?.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(profile.created_at)) : null
  return <Shell page="account" onPage={onPage} title="Account"><div className="content account-page"><section className="page-head"><div><span className="overline">ACCOUNT</span><h1>Your account</h1><p>Authenticated account information from your CEZIK profile.</p></div></section><section className="account-card"><span className="account-avatar">{account?.initials ?? 'CE'}</span><div><span className="overline">PROFILE</span><h2>{account?.displayName ?? 'Name unavailable'}</h2><p>{account?.email ?? 'Email unavailable'}</p>{createdAt && <small>Joined CEZIK {createdAt}</small>}</div></section><section className="settings-list"><button onClick={() => onPage('settings')}><span><Settings size={18} /><div><strong>Settings & security</strong><small>Reset your password or sign out securely.</small></div></span><ArrowRight size={17} /></button><button onClick={() => onPage('billing')}><span><CreditCard size={18} /><div><strong>Billing & credits</strong><small>Review purchases and manage your available credits.</small></div></span><ArrowRight size={17} /></button></section></div></Shell>
}

function SettingsPage({ onPage }: { onPage: (p: Page) => void }) {
  const account = useAccount()
  const [message, setMessage] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const sendReset = async () => {
    if (!supabase || !account?.email) return
    setWorking(true); setMessage(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(account.email, { redirectTo: window.location.origin })
      setMessage(error ? error.message : 'Password reset instructions were sent to your email address.')
    } catch {
      setMessage('Password reset instructions could not be sent. Please try again.')
    } finally { setWorking(false) }
  }
  const signOut = async () => {
    setWorking(true); setMessage(null)
    const error = await account?.signOut()
    if (error) { setMessage(error.message); setWorking(false); return }
    onPage('welcome')
  }
  return <Shell page="settings" onPage={onPage} title="Settings"><div className="content settings-page"><section className="page-head"><div><span className="overline">SETTINGS</span><h1>Account settings</h1><p>Only controls backed by your current account are shown here.</p></div></section><section className="settings-list"><button onClick={() => onPage('account')}><span><UserRound size={18} /><div><strong>Account details</strong><small>View the name and email stored in your CEZIK profile.</small></div></span><ArrowRight size={17} /></button><div className="settings-action"><span><ShieldCheck size={18} /><div><strong>Password</strong><small>Send a secure password reset link to {account?.email ?? 'your email'}.</small></div></span><Button variant="ghost" onClick={() => void sendReset()} disabled={working || !account?.email}>Send reset link</Button></div><div className="settings-action"><span><LogOut size={18} /><div><strong>Sign out</strong><small>End this browser session.</small></div></span><Button variant="ghost" onClick={() => void signOut()} disabled={working}>Sign out</Button></div></section>{message && <div className="data-state"><Mail size={18} /><div><strong>Security update</strong><p>{message}</p></div></div>}</div></Shell>
}

function Editor({ onPage }: { onPage: (p: Page) => void }) {
  return <Shell page="editor" onPage={onPage} title="AI Video Editor"><div className="content upcoming-page"><Clapperboard size={28} /><span className="overline">COMING SOON</span><h1>AI video editing is not available yet.</h1><p>The prior editor screen was a visual prototype with no project, media, export, or AI-editing backend. It has been replaced with this honest availability state until those services are connected.</p><div><Button onClick={() => onPage('projects')}>View creations</Button><Button variant="ghost" onClick={() => onPage('generate')}>Try video generation</Button></div></div></Shell>
}

function AuthScreen({ mode, onModeChange, onBack, onSuccess }: { mode: AuthMode; onModeChange: (mode: AuthMode) => void; onBack: () => void; onSuccess: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const setMode = (nextMode: AuthMode) => { setMessage(null); setPassword(''); setConfirmPassword(''); setShowPassword(false); setShowConfirmPassword(false); onModeChange(nextMode) }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    if (!supabase || !isSupabaseConfigured) {
      setMessage({ type: 'error', text: 'Supabase still needs its project URL and publishable key. Add them to .env.local to enable live authentication.' })
      return
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Your passwords do not match. Please try again.' })
      return
    }
    setLoading(true)
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        setMessage({ type: 'success', text: 'Password reset instructions are on their way. Check your inbox.' })
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (data.session) onSuccess()
        else setMessage({ type: 'success', text: 'Account created. Please confirm your email, then return to sign in.' })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onSuccess()
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Something went wrong. Please try again.' })
    } finally { setLoading(false) }
  }

  const copy = mode === 'signup'
    ? { eyebrow: 'YOUR CREATIVE ACCOUNT', title: <>Start making the <i>impossible.</i></>, detail: 'Create your CEZIK account to save ideas, collaborate, and create without limits.', submit: 'Create account' }
    : mode === 'reset'
      ? { eyebrow: 'ACCOUNT RECOVERY', title: <>Reset your <i>password.</i></>, detail: 'Tell us where to send secure recovery instructions.', submit: 'Send reset link' }
      : { eyebrow: 'WELCOME BACK', title: <>Welcome back to <i>CEZIK.</i></>, detail: 'Sign in to continue building your next moving story.', submit: 'Sign in' }

  return <main className="auth-page">
    <div className="auth-ambient auth-ambient-one" /><div className="auth-ambient auth-ambient-two" />
    <header className="auth-nav"><button onClick={onBack} className="auth-logo-button" aria-label="Back to CEZIK home"><Logo /></button><button className="back-home" onClick={onBack}>← Back to home</button></header>
    <section className="auth-layout">
      <div className="auth-intro"><span className="overline"><Sparkles size={13} /> {copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.detail}</p><div className="auth-feature"><span><CheckCircle2 size={17} /></span><p><strong>Your work, always ready.</strong> Your projects and creative preferences stay securely connected to your account.</p></div></div>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-card-heading"><div><h2>{mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Recover access' : 'Sign in'}</h2><p>{mode === 'signup' ? 'Already have an account?' : mode === 'signin' ? 'New to CEZIK?' : 'Remembered your password?' } <button type="button" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Sign in' : 'Create one'}</button></p></div><span className="auth-mark"><Logo markOnly /></span></div>
        {mode === 'signup' && <label className="auth-field"><span>Full name</span><div><Mail size={16} /><input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" autoComplete="name" /></div></label>}
        <label className="auth-field"><span>Email address</span><div><Mail size={16} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></div></label>
        {mode !== 'reset' && <label className="auth-field"><span>Password</span><div><LockKeyhole size={16} /><input required minLength={8} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
        {mode === 'signup' && <label className="auth-field"><span>Confirm password</span><div><LockKeyhole size={16} /><input required minLength={8} type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" autoComplete="new-password" /><button type="button" className="password-toggle" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
        {mode === 'signin' && <button type="button" className="forgot-password" onClick={() => setMode('reset')}>Forgot password?</button>}
        {message && <div role="status" className={`auth-message ${message.type}`}><span>{message.type === 'success' ? <CheckCircle2 size={16} /> : <X size={16} />}</span>{message.text}</div>}
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{loading ? 'Please wait…' : copy.submit}</button>
        {mode === 'signup' && <p className="terms">By creating an account, you agree to CEZIK’s Terms of Service and Privacy Policy.</p>}
      </form>
    </section>
  </main>
}

function App() {
  const [page, setPage] = useState<Page>(() => pageForPath(window.location.pathname))
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [studioData, setStudioData] = useState<StudioData | null>(null)
  const [studioLoading, setStudioLoading] = useState(false)
  const [studioError, setStudioError] = useState<string | null>(null)
  const studioRequestRef = useRef(0)
  const intendedPageRef = useRef<Page | null>(null)
  const displayName = studioData?.profile?.display_name || session?.user.user_metadata.full_name || null
  const email = studioData?.profile?.email || session?.user.email || null

  useEffect(() => {
    const onPopState = () => {
      if (!isKnownPath(window.location.pathname)) window.history.replaceState({}, '', pagePaths.welcome)
      setPage(pageForPath(window.location.pathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    if (!isKnownPath(window.location.pathname)) window.history.replaceState({}, '', pagePaths.welcome)
  }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [page])
  const refreshStudio = useCallback(async () => {
    if (!supabase || !session) return
    const requestId = ++studioRequestRef.current
    setStudioLoading(true)
    setStudioError(null)
    try {
      const data = await loadStudioData(supabase)
      if (requestId === studioRequestRef.current) setStudioData(data)
    } catch (error) {
      if (requestId === studioRequestRef.current) {
        setStudioData(null)
        setStudioError(error instanceof Error ? error.message : 'Your studio data could not be loaded.')
      }
    } finally {
      if (requestId === studioRequestRef.current) setStudioLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (!session) {
      studioRequestRef.current += 1
      setStudioData(null)
      setStudioError(null)
      setStudioLoading(false)
      return
    }
    void refreshStudio()
  }, [session, refreshStudio])

  useEffect(() => {
    if (session) void loadPaypalConfig().catch(() => undefined)
  }, [session])

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    let authEventReceived = false
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && !authEventReceived) { setSession(data.session); setAuthReady(true) }
    }).catch(() => { if (mounted && !authEventReceived) setAuthReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      authEventReceived = true
      setSession(nextSession)
      setAuthReady(true)
      if (nextSession) setPage((current) => {
        const destination = intendedPageRef.current ?? (current === 'welcome' || current === 'auth' ? 'home' : current)
        intendedPageRef.current = null
        window.history.replaceState({}, '', pagePaths[destination])
        return destination
      })
      else {
        window.history.replaceState({}, '', '/')
        setPage('welcome')
      }
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  const setPageWithHistory = (nextPage: Page, replace = false) => {
    const nextPath = pagePaths[nextPage]
    if (window.location.pathname !== nextPath) window.history[replace ? 'replaceState' : 'pushState']({}, '', nextPath)
    setPage(nextPage)
  }
  const beginAuth = (mode: AuthMode) => { setAuthMode(mode); setPageWithHistory('auth') }
  const navigate = (nextPage: Page) => {
    if (nextPage !== 'welcome' && nextPage !== 'auth' && !session) {
      intendedPageRef.current = nextPage
      beginAuth('signin')
    }
    else setPageWithHistory(nextPage)
  }
  const signOut = async () => {
    if (!supabase) return new Error('Authentication is not configured.')
    const { error } = await supabase.auth.signOut()
    return error
  }
  const protectedRoute = page !== 'welcome' && page !== 'auth'
  useEffect(() => {
    if (authReady && !session && protectedRoute) {
      intendedPageRef.current = page
      setAuthMode('signin')
      setPageWithHistory('auth', true)
    }
  }, [authReady, session, protectedRoute])
  if (!authReady) return <div className="auth-loading"><Logo /><span>Preparing your studio…</span></div>
  const studio = { data: studioData, loading: studioLoading, error: studioError, refresh: refreshStudio }
  const onAuthSuccess = () => {
    const destination = intendedPageRef.current ?? 'home'
    intendedPageRef.current = null
    setPageWithHistory(destination, true)
  }
  const screen = !session && protectedRoute
    ? <AuthScreen mode="signin" onModeChange={setAuthMode} onBack={() => setPageWithHistory('welcome')} onSuccess={onAuthSuccess} />
    : page === 'welcome'
    ? <Welcome onAuth={beginAuth} onExplore={() => navigate('editor')} />
      : page === 'auth'
      ? <AuthScreen mode={authMode} onModeChange={setAuthMode} onBack={() => setPageWithHistory('welcome')} onSuccess={onAuthSuccess} />
      : page === 'home'
        ? <Dashboard onPage={navigate} />
        : page === 'projects'
          ? <Projects onPage={navigate} />
          : page === 'billing'
            ? <Billing onPage={navigate} />
            : page === 'account'
              ? <Account onPage={navigate} />
              : page === 'settings'
                ? <SettingsPage onPage={navigate} />
          : page === 'generate'
          ? <Generator onPage={navigate} />
          : page === 'image'
            ? <ImageGenerator onPage={navigate} />
            : page === 'background-remover' || page === 'image-compressor' || page === 'image-resizer' || page === 'image-converter'
              ? <NativeImageTool kind={page} onPage={navigate} />
              : <Editor onPage={navigate} />
  return <StudioContext.Provider value={studio}><AccountContext.Provider value={{ displayName, email, initials: displayInitials(displayName, email), signOut }}><SeoMetadata page={page} />{screen}</AccountContext.Provider></StudioContext.Provider>
}

createRoot(document.getElementById('root')!).render(<App />)
