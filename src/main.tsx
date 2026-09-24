import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowRight, Bell, CheckCircle2, ChevronDown, Clapperboard, Clock3, Command, Copy,
  Download, FileVideo, FolderOpen, Grid2X2, Image, Layers3, LayoutDashboard,
  LoaderCircle, LockKeyhole, Mail, Menu, MoreHorizontal, Music2, PanelLeftClose, Play, Plus, RefreshCw, Search, Settings,
  SlidersHorizontal, Sparkles, Upload, Video, WandSparkles, X, Zap
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { isActivityAvailable, loadStudioData, type Creation, type StudioData } from './lib/cezik'
import './styles.css'
import './neon.css'
import './image-generator.css'

type Page = 'welcome' | 'auth' | 'home' | 'projects' | 'generate' | 'image' | 'editor'
type AuthMode = 'signin' | 'signup' | 'reset'

const navItems: { id: Page | null; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'projects', label: 'My Projects', icon: FolderOpen },
  { id: 'image', label: 'AI Image Generator', icon: Image },
  { id: 'generate', label: 'AI Video Generator', icon: Sparkles },
  { id: 'editor', label: 'AI Video Editor', icon: Clapperboard },
  { id: null, label: 'Templates', icon: Grid2X2 },
  { id: null, label: 'Assets', icon: Image },
  { id: null, label: 'Settings', icon: Settings },
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

function useStudio() {
  return useContext(StudioContext)
}

const tools = [
  { name: 'Image Generator', description: 'Turn prompts into ready-to-use visuals', icon: Image, color: 'rose', page: 'image' as Page },
  { name: 'Video Generator', description: 'Turn ideas into cinematic video', icon: Sparkles, color: 'violet', page: 'generate' as Page },
  { name: 'AI Video Editor', description: 'Edit projects with natural language', icon: WandSparkles, color: 'blue', page: 'editor' as Page },
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
  return <header className={`topbar ${compact ? 'compact' : ''}`}>
    <div className="mobile-logo"><Logo /></div>
    {title && <div className="page-title">{title}</div>}
    <div className="top-actions">
      {!compact && <button className="icon-button"><Search size={19} /></button>}
      <button className="icon-button notification"><Bell size={18} /><b /></button>
      <button className="profile"><span>AD</span><ChevronDown size={15} /></button>
      {!compact && <Button onClick={() => onPage('image')}><Plus size={17} /> Create</Button>}
    </div>
  </header>
}

function Sidebar({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  const [open, setOpen] = useState(true)
  const studio = useStudio()
  const balance = studio?.data?.balance
  const isActive = (page: Page, label: string) => (page === 'home' && label === 'Home') || (page === 'projects' && label === 'My Projects') || (page === 'image' && label === 'AI Image Generator') || (page === 'generate' && label === 'AI Video Generator') || (page === 'editor' && label === 'AI Video Editor')
  return <aside className={`sidebar ${open ? '' : 'collapsed'}`}>
    <div className="side-top"><Logo markOnly={!open} /><button onClick={() => setOpen(!open)} className="collapse"><PanelLeftClose size={18} /></button></div>
    <nav>{navItems.map(({ id, label, icon: Icon }, index) => <button key={`${label}-${index}`} onClick={() => id && onPage(id)} disabled={!id} className={`nav-item ${isActive(page, label) ? 'active' : ''}`}><Icon size={19} /><span>{label}</span>{label === 'AI Video Generator' ? <em>NEW</em> : !id && <em>SOON</em>}</button>)}</nav>
    <div className="side-bottom">
      {open && <div className="usage-card"><span>CEZIK CREDITS</span><strong>{studio?.loading ? '…' : balance ?? '—'} <i>available</i></strong><div className="progress"><b style={{ width: balance === undefined ? '0%' : `${Math.min(100, Math.max(4, balance / 10))}%` }} /></div><button onClick={() => onPage('image')}>Create with credits <ArrowRight size={13} /></button></div>}
      <button className="account"><span className="avatar">AD</span>{open && <span><strong>Alex Doe</strong><small>Pro workspace</small></span>}<MoreHorizontal size={18} /></button>
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

function Dashboard({ onPage, name }: { onPage: (p: Page) => void; name: string }) {
  const studio = useStudio()
  const [packagesOpen, setPackagesOpen] = useState(false)
  const projects = (studio?.data?.creations ?? []).map(toProjectCard)
  return <Shell page="home" onPage={onPage}><div className="content dashboard">
    <section className="dashboard-hero"><div><span className="overline">YOUR CEZIK WORKSPACE</span><h1>Good morning, {name}.</h1><p>What will you bring to life today?</p></div><Button onClick={() => onPage('image')}><Sparkles size={17} /> Create with AI</Button></section>
    <section className="credit-summary"><div><span className="overline">CEZIK CREDITS</span><strong>{studio?.loading ? 'Loading…' : studio?.data ? studio.data.balance.toLocaleString() : 'Unavailable'}</strong><p>{studio?.error ? 'Finish the CEZIK database setup to load your wallet.' : 'Your balance is secured and managed server-side.'}</p></div><Button variant="ghost" onClick={() => setPackagesOpen(true)}>Buy credits <ArrowRight size={15} /></Button></section>
    <section className="tool-grid">{tools.map(({ name: toolName, description, icon: Icon, color, page }) => <button className="tool-card" key={toolName} onClick={() => page && onPage(page)} disabled={!page}><span className={`tool-icon ${color}`}><Icon size={21} /></span><span><strong>{toolName}</strong><small>{description}</small></span>{page ? <ArrowRight size={18} /> : <Clock3 size={17} />}</button>)}</section>
    <section className="section-heading"><div><h2>Continue creating</h2><p>Your recent projects</p></div><button onClick={() => onPage('projects')} className="text-button">View all <ArrowRight size={15} /></button></section>
    <section className="project-row">{projects.length > 0 ? projects.slice(0, 4).map((project) => <ProjectCard key={project.id} project={project} onClick={() => onPage('editor')} />) : <button className="empty-projects" onClick={() => onPage('image')}><Image size={20} /><strong>Your creations will appear here</strong><small>Start with an AI image prompt once the provider is activated.</small></button>}<button onClick={() => onPage('projects')} className="all-projects"> <FolderOpen size={22} /><span>View all creations</span><ArrowRight size={16} /></button></section>
    <section className="inspiration"><div><span className="overline">EXPLORE THE POSSIBLE</span><h2>Made to make your<br /><i>best work yet.</i></h2><Button variant="ghost" onClick={() => onPage('generate')}>Explore templates <ArrowRight size={16} /></Button></div><div className="inspiration-art"><div className="art-ball" /><div className="art-column" /><span>01<br /><b>CREATE</b></span></div></section>
    {packagesOpen && <CreditPackages onClose={() => setPackagesOpen(false)} />}
  </div></Shell>
}

function CreditPackages({ onClose }: { onClose: () => void }) {
  const studio = useStudio()
  const packages = studio?.data?.packages ?? []
  return <div className="credit-modal-backdrop" role="presentation" onClick={onClose}><section className="credit-modal" role="dialog" aria-modal="true" aria-label="Buy CEZIK credits" onClick={(event) => event.stopPropagation()}><button className="credit-modal-close" onClick={onClose} aria-label="Close credit packages"><X size={17} /></button><span className="overline">CEZIK CREDITS</span><h2>Choose your next<br /><i>creative runway.</i></h2><p>Packages are controlled securely from CEZIK’s server configuration.</p><div className="package-grid">{studio?.loading ? <div className="package-loading">Loading packages…</div> : packages.length > 0 ? packages.map((creditPackage) => <article className="package-card" key={creditPackage.id}><span>{creditPackage.name}</span><strong>{creditPackage.credits.toLocaleString()} <i>credits</i></strong><p>{creditPackage.description}</p><b>{new Intl.NumberFormat(undefined, { style: 'currency', currency: creditPackage.currency }).format(Number(creditPackage.price))}</b><Button variant="ghost" disabled>Checkout coming soon</Button></article>) : <div className="package-loading">Credit packages will appear after the database setup is complete.</div>}</div><small>Credits are added only after a verified payment webhook confirms payment.</small></section></div>
}

function ProjectCard({ project, onClick }: { project: ProjectCardData; onClick: () => void }) { return <button className="project-card" onClick={onClick}><div className={`project-thumb ${project.color}`}>{project.assetUrl && <img src={project.assetUrl} alt="" />}<span className="play-circle">{project.type === 'image' ? <Image size={15} /> : <Play size={15} fill="currentColor" />}</span><span className="duration">AI</span></div><div className="project-info"><div><strong>{project.name}</strong><small>{project.type}</small></div><span className="more"><MoreHorizontal size={18} /></span></div><div className="project-meta"><span>{project.date}</span><b className={project.status === 'Ready' ? 'ready' : ''}>{project.status}</b></div></button> }

function Projects({ onPage }: { onPage: (p: Page) => void }) {
  const [query, setQuery] = useState('')
  const studio = useStudio()
  const projects = useMemo(() => (studio?.data?.creations ?? []).map(toProjectCard), [studio?.data?.creations])
  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())), [projects, query])
  return <Shell page="projects" onPage={onPage} title="My Projects"><div className="content projects-page">
    <section className="page-head"><div><span className="overline">YOUR WORKSPACE</span><h1>My Creations</h1><p>Every completed CEZIK job, in one place.</p></div><Button onClick={() => onPage('generate')}><Plus size={17} /> New project</Button></section>
    <div className="project-controls"><label><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search creations" />{query && <button onClick={() => setQuery('')}><X size={15} /></button>}</label><Button variant="ghost" disabled><SlidersHorizontal size={16} /> Filters soon</Button><Button variant="ghost" disabled>Newest first <ChevronDown size={15} /></Button></div>
    <div className="projects-grid">{shown.map((project) => <ProjectCard key={project.id} project={project} onClick={() => onPage('editor')} />)}{shown.length === 0 && <div className="creation-empty"><Sparkles size={21} /><strong>{studio?.loading ? 'Loading your creations…' : 'No creations yet'}</strong><small>{studio?.error ? 'Run the CEZIK database migration, then refresh this page.' : 'Generated videos, images, voiceovers, and edits will live here.'}</small></div>}<button className="new-card" onClick={() => onPage('generate')}><span><Plus size={22} /></span><strong>Start a new project</strong><small>Bring your next idea to life</small></button></div>
  </div></Shell>
}

const pillOptions = { style: ['Cinematic', 'Product film', 'Animation', 'Documentary'], ratio: ['16:9', '9:16', '1:1', '4:5'], duration: ['5 seconds', '10 seconds', '15 seconds'], quality: ['Standard', 'High', 'Ultra 4K'] }
function Generator({ onPage }: { onPage: (p: Page) => void }) {
  const [prompt, setPrompt] = useState('A solitary astronaut walking through a field of tall grass on an alien planet at sunrise, cinematic, volumetric light.')
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
  const [prompt, setPrompt] = useState('A luminous glass pavilion emerging from a misty tropical forest at dawn, editorial architecture photography, soft cinematic light.')
  const [size, setSize] = useState('1024x1024')
  const [submitting, setSubmitting] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
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
      await studio?.refresh()
      setFeedback({ type: 'success', title: 'Your image is ready', detail: 'It is saved privately to My Creations and your credit balance has been updated.' })
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
      {resultUrl ? <section className="image-result"><div className="image-result-head"><span><CheckCircle2 size={16} /> Latest generation</span><div><Button variant="ghost" onClick={() => void downloadImage(resultUrl, 'cezik-image.png')}><Download size={15} /> Download</Button><Button variant="ghost" onClick={generateImage} disabled={submitting}><RefreshCw size={15} /> Regenerate</Button></div></div><img src={resultUrl} alt={prompt} /></section> : <div className="generation-note"><span>✦</span><p>Your completed images are saved privately to <b>My Creations</b>.</p></div>}
    </section><aside className="settings-card"><h3>Image settings</h3><div className="setting"><label>Composition</label><div className="pills">{imageSizes.map((option) => <button onClick={() => setSize(option.value)} key={option.value} className={size === option.value ? 'selected' : ''}><i className={`ratio ${option.className}`} />{option.label}</button>)}</div></div><p className="setting-note">Quality, style, and multi-image controls will be added only when the selected provider supports them.</p><Button className="generate-button" onClick={generateImage} disabled={submitting}><Image size={17} /> {submitting ? 'Generating image…' : available ? 'Generate image' : 'Image generation unavailable'} <span>{cost ? `${cost} credits` : '—'}</span></Button></aside></div>
    {feedback && <div className={`generated-toast ${feedback.type}`}><span>{feedback.type === 'error' ? <X size={18} /> : <Sparkles size={18} />}</span><div><strong>{feedback.title}</strong><p>{feedback.detail}</p></div>{feedback.type === 'success' && <button onClick={() => onPage('projects')}>View creations <ArrowRight size={15} /></button>}</div>}
    <section className="image-history"><div className="section-heading"><div><h2>Image history</h2><p>Your most recent private generations</p></div><button onClick={() => onPage('projects')} className="text-button">View all <ArrowRight size={15} /></button></div><div className="image-history-grid">{imageHistory.length ? imageHistory.slice(0, 6).map((creation) => <article key={creation.id} className="image-history-card">{creation.assetUrl ? <img src={creation.assetUrl} alt={creation.title} /> : <div className="image-history-empty"><Image size={20} /></div>}<span>{creation.title}</span>{creation.assetUrl && <button onClick={() => void downloadImage(creation.assetUrl!, 'cezik-image.png')} aria-label={`Download ${creation.title}`}><Download size={15} /></button>}</article>) : <div className="creation-empty"><Image size={21} /><strong>No images yet</strong><small>Your completed image generations will appear here.</small></div>}</div></section>
  </div></Shell>
}

function Editor({ onPage }: { onPage: (p: Page) => void }) {
  const [playing, setPlaying] = useState(false); const [activeTool, setActiveTool] = useState('AI edit')
  const aiTools = [['AI edit', WandSparkles], ['Remove background', Layers3], ['Extend video', ArrowRight], ['AI voiceover', Music2], ['Generate subtitles', FileVideo], ['Improve quality', Zap], ['Add music', Music2], ['AI effects', Sparkles]] as const
  return <Shell page="editor" onPage={onPage} editor><div className="editor-top"><button onClick={() => onPage('projects')}><ArrowRight size={18} className="back" /> Projects</button><strong>Neon City</strong><span>Edited just now</span><div><Button variant="ghost"><Download size={16} /> Export</Button><Button><Upload size={16} /> Share</Button></div></div><div className="editor-workspace">
    <aside className="asset-panel"><div className="asset-tabs"><button className="active"><Image size={17} /> Media</button><button><Music2 size={17} /> Audio</button></div><div className="asset-heading"><strong>Project media</strong><button><Plus size={16} /></button></div><button className="media-upload"><Upload size={20} /><strong>Import media</strong><small>Images, video, audio</small></button><div className="media-grid"><div className="media-item m1"><Play size={14} fill="white" /></div><div className="media-item m2" /><div className="media-item m3" /><div className="media-item m4" /></div></aside>
    <section className="preview-section"><div className="preview-toolbar"><button><Menu size={17} /></button><span>Scene 01</span><div><button>Fit <ChevronDown size={13} /></button><button><MoreHorizontal size={17} /></button></div></div><div className="preview-frame"><div className="video-art"><div className="sun-orb" /><div className="city-lines"><i /><i /><i /><i /><i /></div><div className="video-title">CREATE<br /><span>WITHOUT LIMITS</span></div><div className="video-stamp">CEZIK<br />STUDIOS</div></div><button className="big-play" onClick={() => setPlaying(!playing)}>{playing ? <span className="pause" /> : <Play size={24} fill="currentColor" />}</button><span className="preview-time">00:00:07 / 00:00:24</span></div><div className="transport"><button onClick={() => setPlaying(!playing)}>{playing ? <span className="pause dark" /> : <Play size={18} fill="currentColor" />}</button><button><span className="volume">◖</span></button><span>00:00:07</span><div className="transport-line"><b /></div><span>00:00:24</span><button><Settings size={16} /></button></div></section>
    <aside className="ai-panel"><div className="ai-head"><span><Sparkles size={17} /> AI tools</span><button><X size={17} /></button></div><div className="ai-prompt"><textarea placeholder="Tell CEZIK what to change..." /><Button><ArrowRight size={16} /></Button></div><span className="suggestion-label">QUICK ACTIONS</span><div className="ai-tool-list">{aiTools.map(([name, Icon]) => <button onClick={() => setActiveTool(name)} className={activeTool === name ? 'selected' : ''} key={name}><span><Icon size={16} /></span>{name}<ArrowRight size={15} /></button>)}</div></aside>
  </div><section className="timeline"><div className="timeline-head"><div><button><Plus size={16} /></button><button><SlidersHorizontal size={16} /></button><span>00:00</span></div><div><button><span className="mag">−</span></button><input type="range" defaultValue="42" /><button><span className="mag">+</span></button></div></div><div className="ruler"><span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span><span>00:20</span></div><div className="track-area"><div className="track-label"><Video size={15} /> Video 1</div><div className="track clip-main"><b className="playhead" /><div className="mini-frames">✦　　◒　　□　　✦　　◒　　□</div></div><div className="track-label"><Music2 size={15} /> Audio 1</div><div className="track audio-track"><div className="audio-wave">∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿</div></div></div></section></Shell>
}

function AuthScreen({ mode, onModeChange, onBack, onSuccess }: { mode: AuthMode; onModeChange: (mode: AuthMode) => void; onBack: () => void; onSuccess: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const setMode = (nextMode: AuthMode) => { setMessage(null); setPassword(''); setConfirmPassword(''); onModeChange(nextMode) }
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
        {mode !== 'reset' && <label className="auth-field"><span>Password</span><div><LockKeyhole size={16} /><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></div></label>}
        {mode === 'signup' && <label className="auth-field"><span>Confirm password</span><div><LockKeyhole size={16} /><input required minLength={8} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" autoComplete="new-password" /></div></label>}
        {mode === 'signin' && <button type="button" className="forgot-password" onClick={() => setMode('reset')}>Forgot password?</button>}
        {message && <div role="status" className={`auth-message ${message.type}`}><span>{message.type === 'success' ? <CheckCircle2 size={16} /> : <X size={16} />}</span>{message.text}</div>}
        <button className="auth-submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{loading ? 'Please wait…' : copy.submit}</button>
        {mode === 'signup' && <p className="terms">By creating an account, you agree to CEZIK’s Terms of Service and Privacy Policy.</p>}
      </form>
    </section>
  </main>
}

function App() {
  const [page, setPage] = useState<Page>('welcome')
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [studioData, setStudioData] = useState<StudioData | null>(null)
  const [studioLoading, setStudioLoading] = useState(false)
  const [studioError, setStudioError] = useState<string | null>(null)
  const displayName = session?.user.user_metadata.full_name || session?.user.email?.split('@')[0] || 'Creator'

  useEffect(() => { window.scrollTo({ top: 0 }) }, [page])
  const refreshStudio = useCallback(async () => {
    if (!supabase || !session) return
    setStudioLoading(true)
    setStudioError(null)
    try {
      setStudioData(await loadStudioData(supabase))
    } catch (error) {
      setStudioData(null)
      setStudioError(error instanceof Error ? error.message : 'Your studio data could not be loaded.')
    } finally {
      setStudioLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (!session) {
      setStudioData(null)
      setStudioError(null)
      setStudioLoading(false)
      return
    }
    void refreshStudio()
  }, [session, refreshStudio])

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setAuthReady(true) } })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setAuthReady(true)
      if (nextSession) setPage((current) => current === 'welcome' || current === 'auth' ? 'home' : current)
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  const beginAuth = (mode: AuthMode) => { setAuthMode(mode); setPage('auth') }
  const navigate = (nextPage: Page) => {
    if (nextPage !== 'welcome' && nextPage !== 'auth' && !session) beginAuth('signin')
    else setPage(nextPage)
  }
  if (!authReady) return <div className="auth-loading"><Logo /><span>Preparing your studio…</span></div>
  const studio = { data: studioData, loading: studioLoading, error: studioError, refresh: refreshStudio }
  const screen = page === 'welcome'
    ? <Welcome onAuth={beginAuth} onExplore={() => navigate('editor')} />
    : page === 'auth'
      ? <AuthScreen mode={authMode} onModeChange={setAuthMode} onBack={() => setPage('welcome')} onSuccess={() => setPage('home')} />
      : page === 'home'
        ? <Dashboard onPage={navigate} name={displayName} />
        : page === 'projects'
          ? <Projects onPage={navigate} />
        : page === 'generate'
          ? <Generator onPage={navigate} />
          : page === 'image'
            ? <ImageGenerator onPage={navigate} />
            : <Editor onPage={navigate} />
  return <StudioContext.Provider value={studio}>{screen}</StudioContext.Provider>
}

createRoot(document.getElementById('root')!).render(<App />)
