import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowRight, Bell, ChevronDown, Clapperboard, Clock3, Command, Copy,
  Download, FileVideo, FolderOpen, Grid2X2, Image, Layers3, LayoutDashboard,
  Menu, MoreHorizontal, Music2, PanelLeftClose, Play, Plus, Search, Settings,
  SlidersHorizontal, Sparkles, Upload, Video, WandSparkles, X, Zap
} from 'lucide-react'
import './styles.css'
import './neon.css'

type Page = 'welcome' | 'home' | 'projects' | 'generate' | 'editor'

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'projects', label: 'My Projects', icon: FolderOpen },
  { id: 'generate', label: 'AI Video Generator', icon: Sparkles },
  { id: 'editor', label: 'AI Video Editor', icon: Clapperboard },
  { id: 'projects', label: 'Templates', icon: Grid2X2 },
  { id: 'projects', label: 'Assets', icon: Image },
  { id: 'home', label: 'Settings', icon: Settings },
]

const projects = [
  { name: 'Neon City', type: 'Product Film', date: 'Edited 2h ago', status: 'Ready', color: 'neon', progress: 100 },
  { name: 'Apex Campaign', type: 'Social Launch', date: 'Edited yesterday', status: 'In progress', color: 'apex', progress: 72 },
  { name: 'Humanity / 01', type: 'Brand Story', date: 'Created Aug 26', status: 'Ready', color: 'humanity', progress: 100 },
  { name: 'Aurelia', type: 'Concept Film', date: 'Created Aug 21', status: 'Draft', color: 'aurelia', progress: 34 },
  { name: 'Future Forms', type: 'Campaign', date: 'Created Aug 12', status: 'Ready', color: 'future', progress: 100 },
  { name: 'Arc / 08', type: 'Motion Study', date: 'Created Aug 04', status: 'Draft', color: 'arc', progress: 18 },
]

const tools = [
  ['Video Generator', 'Turn ideas into cinematic video', Sparkles, 'violet'],
  ['AI Video Editor', 'Edit with natural language', WandSparkles, 'blue'],
  ['Enhance & Upscale', 'Polish every frame in 4K', Zap, 'amber'],
]

function Logo({ markOnly = false }: { markOnly?: boolean }) {
  return <div className="logo neon-logo"><span className="logo-mark" />{!markOnly && <span className="logo-title">CEZIK <b>AI</b><small>STUDIO</small></span>}</div>
}

function Button({ children, variant = 'primary', onClick, className = '' }: { children: ReactNode; variant?: 'primary' | 'ghost' | 'quiet'; onClick?: () => void; className?: string }) {
  return <button onClick={onClick} className={`button ${variant} ${className}`}>{children}</button>
}

function TopBar({ onPage, title, compact = false }: { onPage: (p: Page) => void; title?: string; compact?: boolean }) {
  return <header className={`topbar ${compact ? 'compact' : ''}`}>
    <div className="mobile-logo"><Logo /></div>
    {title && <div className="page-title">{title}</div>}
    <div className="top-actions">
      {!compact && <button className="icon-button"><Search size={19} /></button>}
      <button className="icon-button notification"><Bell size={18} /><b /></button>
      <button className="profile"><span>AD</span><ChevronDown size={15} /></button>
      {!compact && <Button onClick={() => onPage('generate')}><Plus size={17} /> Create</Button>}
    </div>
  </header>
}

function Sidebar({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  const [open, setOpen] = useState(true)
  const isActive = (page: Page, label: string) => (page === 'home' && label === 'Home') || (page === 'projects' && label === 'My Projects') || (page === 'generate' && label === 'AI Video Generator') || (page === 'editor' && label === 'AI Video Editor')
  return <aside className={`sidebar ${open ? '' : 'collapsed'}`}>
    <div className="side-top"><Logo markOnly={!open} /><button onClick={() => setOpen(!open)} className="collapse"><PanelLeftClose size={18} /></button></div>
    <nav>{navItems.map(({ id, label, icon: Icon }, index) => <button key={`${label}-${index}`} onClick={() => onPage(id)} className={`nav-item ${isActive(page, label) ? 'active' : ''}`}><Icon size={19} /><span>{label}</span>{label === 'AI Video Generator' && <em>NEW</em>}</button>)}</nav>
    <div className="side-bottom">
      {open && <div className="usage-card"><span>CREATIVE CREDITS</span><strong>870 <i>/ 1,000</i></strong><div className="progress"><b style={{ width: '87%' }} /></div><button>Manage plan <ArrowRight size={13} /></button></div>}
      <button className="account"><span className="avatar">AD</span>{open && <span><strong>Alex Doe</strong><small>Pro workspace</small></span>}<MoreHorizontal size={18} /></button>
    </div>
  </aside>
}

function Shell({ page, onPage, children, title, editor = false }: { page: Page; onPage: (p: Page) => void; children: ReactNode; title?: string; editor?: boolean }) {
  return <div className={`app-shell ${editor ? 'editor-shell' : ''}`}><Sidebar page={page} onPage={onPage} /><main><TopBar onPage={onPage} title={title} compact={editor} />{children}</main></div>
}

function Welcome({ onPage }: { onPage: (p: Page) => void }) {
  return <div className="welcome">
    <header className="welcome-nav"><Logo /><div><Button variant="quiet" onClick={() => onPage('home')}>Sign in</Button><Button onClick={() => onPage('home')}>Start creating <ArrowRight size={16} /></Button></div></header>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className="hero">
      <div className="eyebrow"><span /><span>THE CREATIVE OPERATING SYSTEM</span></div>
      <h1>Shape the impossible<br /><i>into moving stories.</i></h1>
      <p>CEZIK AI Studio brings every part of video creation into one intelligent, effortless creative environment.</p>
      <div className="hero-cta"><Button onClick={() => onPage('home')}>Start creating free <ArrowRight size={17} /></Button><Button variant="ghost" onClick={() => onPage('editor')}><Play size={15} fill="currentColor" /> Explore the studio</Button></div>
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
  return <Shell page="home" onPage={onPage}><div className="content dashboard">
    <section className="dashboard-hero"><div><span className="overline">THURSDAY, SEPTEMBER 4</span><h1>Good morning, Alex.</h1><p>What will you bring to life today?</p></div><Button onClick={() => onPage('generate')}><Sparkles size={17} /> Create with AI</Button></section>
    <section className="tool-grid">{tools.map(([name, desc, Icon, color]) => <button className="tool-card" key={name as string} onClick={() => onPage(name === 'AI Video Editor' ? 'editor' : 'generate')}><span className={`tool-icon ${color}`}><Icon size={21} /></span><span><strong>{name as string}</strong><small>{desc as string}</small></span><ArrowRight size={18} /></button>)}</section>
    <section className="section-heading"><div><h2>Continue creating</h2><p>Your recent projects</p></div><button onClick={() => onPage('projects')} className="text-button">View all <ArrowRight size={15} /></button></section>
    <section className="project-row">{projects.slice(0, 4).map((project) => <ProjectCard key={project.name} project={project} onClick={() => onPage('editor')} />)}<button onClick={() => onPage('projects')} className="all-projects"> <FolderOpen size={22} /><span>View all projects</span><ArrowRight size={16} /></button></section>
    <section className="inspiration"><div><span className="overline">EXPLORE THE POSSIBLE</span><h2>Made to make your<br /><i>best work yet.</i></h2><Button variant="ghost" onClick={() => onPage('generate')}>Explore templates <ArrowRight size={16} /></Button></div><div className="inspiration-art"><div className="art-ball" /><div className="art-column" /><span>01<br /><b>CREATE</b></span></div></section>
  </div></Shell>
}

function ProjectCard({ project, onClick }: { project: typeof projects[0]; onClick: () => void }) { return <button className="project-card" onClick={onClick}><div className={`project-thumb ${project.color}`}><span className="play-circle"><Play size={15} fill="currentColor" /></span><span className="duration">00:24</span></div><div className="project-info"><div><strong>{project.name}</strong><small>{project.type}</small></div><span className="more"><MoreHorizontal size={18} /></span></div><div className="project-meta"><span>{project.date}</span><b className={project.status === 'Ready' ? 'ready' : ''}>{project.status}</b></div></button> }

function Projects({ onPage }: { onPage: (p: Page) => void }) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())), [query])
  return <Shell page="projects" onPage={onPage} title="My Projects"><div className="content projects-page">
    <section className="page-head"><div><span className="overline">YOUR WORKSPACE</span><h1>My Projects</h1><p>All your ideas, in motion.</p></div><Button onClick={() => onPage('generate')}><Plus size={17} /> New project</Button></section>
    <div className="project-controls"><label><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" />{query && <button onClick={() => setQuery('')}><X size={15} /></button>}</label><Button variant="ghost"><SlidersHorizontal size={16} /> Filter</Button><Button variant="ghost">Last edited <ChevronDown size={15} /></Button></div>
    <div className="projects-grid">{shown.map((project) => <ProjectCard key={project.name} project={project} onClick={() => onPage('editor')} />)}<button className="new-card" onClick={() => onPage('generate')}><span><Plus size={22} /></span><strong>Start a new project</strong><small>Bring your next idea to life</small></button></div>
  </div></Shell>
}

const pillOptions = { style: ['Cinematic', 'Product film', 'Animation', 'Documentary'], ratio: ['16:9', '9:16', '1:1', '4:5'], duration: ['5 seconds', '10 seconds', '15 seconds'], quality: ['Standard', 'High', 'Ultra 4K'] }
function Generator({ onPage }: { onPage: (p: Page) => void }) {
  const [prompt, setPrompt] = useState('A solitary astronaut walking through a field of tall grass on an alien planet at sunrise, cinematic, volumetric light.')
  const [selected, setSelected] = useState<Record<string, string>>({ style: 'Cinematic', ratio: '16:9', duration: '10 seconds', quality: 'High' })
  const [generated, setGenerated] = useState(false)
  return <Shell page="generate" onPage={onPage} title="AI Video Generator"><div className="content generator">
    <section className="generator-head"><span className="overline"><Sparkles size={13} /> CEZIK GENERATE</span><h1>Turn a thought into a <i>world.</i></h1><p>Describe what you want to see. We’ll take care of the impossible details.</p></section>
    <div className="generator-layout"><section className="prompt-column"><div className="prompt-box"><div className="prompt-top"><span><WandSparkles size={16} /> Your prompt</span><small>{prompt.length} / 2,000</small></div><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} /><div className="prompt-bottom"><button><Command size={13} /> Enhance prompt</button><button><Copy size={14} /> Paste</button></div></div>
      <div className="ref-upload"><span><Upload size={18} /></span><div><strong>Reference media <em>Optional</em></strong><small>Upload an image or video to guide your creation.</small></div><Button variant="ghost">Upload</Button></div>
      <div className="generation-note"><span>✦</span><p>Generations are saved as a new project. <b>Learn more</b></p></div>
    </section><aside className="settings-card"><h3>Creation settings</h3>{Object.entries(pillOptions).map(([key, values]) => <div className="setting" key={key}><label>{key === 'ratio' ? 'Aspect ratio' : key[0].toUpperCase() + key.slice(1)}</label><div className="pills">{values.map((value) => <button onClick={() => setSelected({ ...selected, [key]: value })} key={value} className={selected[key] === value ? 'selected' : ''}>{key === 'ratio' && <i className={`ratio r-${value.replace(':', '-')}`} />}{value}</button>)}</div></div>)}<Button className="generate-button" onClick={() => setGenerated(true)}><Sparkles size={17} /> Generate video <span>18 credits</span></Button></aside></div>
    {generated && <div className="generated-toast"><span><Sparkles size={18} /></span><div><strong>Your video is being created</strong><p>This usually takes 1–3 minutes. We’ll let you know when it’s ready.</p></div><button onClick={() => onPage('projects')}>View projects <ArrowRight size={15} /></button></div>}
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

function App() { const [page, setPage] = useState<Page>('welcome'); useEffect(() => { window.scrollTo({ top: 0 }) }, [page]); return page === 'welcome' ? <Welcome onPage={setPage} /> : page === 'home' ? <Dashboard onPage={setPage} /> : page === 'projects' ? <Projects onPage={setPage} /> : page === 'generate' ? <Generator onPage={setPage} /> : <Editor onPage={setPage} /> }

createRoot(document.getElementById('root')!).render(<App />)
