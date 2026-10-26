import { createContext, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { Activity as ActivityIcon, AlertCircle, ArrowDownUp, ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Check, CheckCheck, ChevronDown, Copy, FileCheck2, FileText, Gauge, Info, Lightbulb, ListChecks, LoaderCircle, Menu, MessageSquare, MoreHorizontal, Pencil, Plus, RotateCcw, Save, Search, Send, Settings, Shield, ShieldCheck, Sparkles, Trash2, Undo2, Upload, UserRound, Users, X, type LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analyzeContent, API_BASE_URL } from './api/client';
import { faqItems } from './chatbot/faq';
import { emptySession, queueSamples, sampleDraft, sampleFacts, sampleFindings, sampleGuidelines } from './data/sample';
import Mascot from './components/Mascot';
import WorkspaceContent from './layouts/WorkspaceContent';
import NotFound from './pages/NotFound';
import { sampleChartData, sampleFindingsTimeline, sampleTriggeredGuidelines, sampleUnclearGuidelines } from './mocks/insights';
import type { AnalyzeError, AnalyzeErrorKind, BrandKit, Finding, LocalDecision, ReviewSession, Severity, UserRole } from './types';
import './index.css';

const STORAGE_KIT = 'inkguard-brand-kit';
const STORAGE_ROLE = 'inkguard-role';
const STORAGE_DEMO = 'inkguard-demo';
const DEFAULT_KIT: BrandKit = { guidelines: [...sampleGuidelines], facts: [...sampleFacts], terminology: [{ preferred: 'members', avoided: 'users' }], assets: ['Northstar primary logo', 'Editorial voice reference'] };

function readStorage<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readStorage(key, fallback));
  const [writeRevision, setWriteRevision] = useState(0);
  const skipNextWrite = useRef(false);
  useEffect(() => {
    if (skipNextWrite.current) { skipNextWrite.current = false; return; }
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browser storage may be unavailable. */ }
  }, [key, value, writeRevision]);
  const clear = (next: T) => {
    try { localStorage.removeItem(key); } catch { /* Browser storage may be unavailable. */ }
    skipNextWrite.current = true;
    setValue(next);
    setWriteRevision((revision) => revision + 1);
  };
  return [value, setValue, clear];
}
type AppContextValue = {
  role: UserRole; setRole: (role: UserRole) => void;
  demo: boolean; setDemo: (value: boolean) => void;
  kit: BrandKit; setKit: (kit: BrandKit) => void;
  session: ReviewSession; setSession: (session: ReviewSession) => void;
  activity: string[]; addActivity: (message: string) => void;
  apiState: 'unknown' | 'connected' | 'offline' | 'error' | 'invalid-response' | 'timeout';
  resetLocalData: () => void;
  sessionVersion: number;
};
const AppContext = createContext<AppContextValue | null>(null);
function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('App context is missing');
  return value;
}

const navGroups: { label: string; links: { href: string; text: string; icon: LucideIcon }[] }[] = [
  { label: 'WORKSPACE', links: [{ href: '/app/review', text: 'Review draft', icon: FileCheck2 }, { href: '/app/queue', text: 'Review queue', icon: ListChecks }] },
  { label: 'BRAND', links: [{ href: '/app/brand-kit', text: 'Brand kit', icon: BookOpen }, { href: '/app/insights', text: 'Insights', icon: Gauge }, { href: '/app/activity', text: 'Activity', icon: ActivityIcon }] },
];

function Inky({ status = 'idle' }: { status?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'inky'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [location] = useLocation();
  const { session, setSession, demo, sessionVersion } = useApp();
  useEffect(() => {
    setOpen(false);
    setMessages([]);
    setInput('');
    setTyping(false);
  }, [sessionVersion]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const answerQuestion = (text: string): string => {
    const query = text.toLowerCase();
    if (query.includes('what it does') || (query.includes('what') && query.includes('inkguard'))) return faqItems[0].answer;
    if (query.includes('why') && (query.includes('no finding') || query.includes('no issue') || (session.analysisStatus === 'success' && session.findings.length === 0))) {
      return 'The service returned no findings for the supplied context. That is not a guarantee that the draft is correct; keep your human editorial review in place. You can retry if you expected findings.';
    }
    const match = faqItems.find((faq) => {
      const words = faq.label.toLowerCase().replace(/[?]/g, '').split(/\s+/).filter((word) => word.length > 3);
      return words.some((word) => query.includes(word));
    });
    if (query.includes('privacy') || query.includes('private') || query.includes('confidential') || query.includes('send')) return faqItems[7].answer;
    if (query.includes('form') || query.includes('guideline') || query.includes('approved fact') || query.includes('how do i review')) return faqItems[1].answer;
    if (query.includes('severity') || query.includes('critical') || query.includes('high')) return faqItems[2].answer;
    if (query.includes('accept') || query.includes('edit') || query.includes('reject') || query.includes('decision')) return faqItems[4].answer;
    if (query.includes('configured') || query.includes('not connected')) return faqItems[3].answer;
    if (query.includes('demo') || query.includes('sample')) return faqItems[6].answer;
    return match?.answer ?? `I can help with ${location.includes('review') ? 'this review workflow, findings, and decisions' : 'the InkGuard workflow, brand rules, and review decisions'}. I use local FAQ matching only.`;
  };
  const ask = (text: string, retry = false) => {
    if (!text.trim()) return;
    setMessages((currentMessages) => [...currentMessages, { role: 'user', text }]);
    setInput('');
    setTyping(true);
    window.setTimeout(() => {
      if (!retry) {
        setMessages((currentMessages) => [...currentMessages, { role: 'inky', text: answerQuestion(text) }]);
        setTyping(false);
        return;
      }
      void (async () => {
        if (!session.brand.trim() || !session.content.trim()) {
          setMessages((currentMessages) => [...currentMessages, { role: 'inky', text: 'Add a brand name and draft in Review first. Then I can retry the analysis when you ask.' }]);
          setTyping(false);
          return;
        }
        if (demo) {
          setSession({ ...session, analysisStatus: 'demo', findings: sampleFindings, decisions: {}, message: 'Sample review data. No draft was sent to the backend.' });
          setMessages((currentMessages) => [...currentMessages, { role: 'inky', text: 'I loaded the clearly labeled sample review. No draft was sent to the backend.' }]);
          setTyping(false);
          return;
        }
        setSession({ ...session, analysisStatus: 'loading', findings: [], errorKind: undefined, errorStatus: undefined });
        try {
          const response = await analyzeContent({ brand_name: session.brand, content: session.content, brand_guidelines: session.guidelines, approved_facts: session.facts });
          setSession({ ...session, analysisStatus: response.status === 'analysis_not_configured' ? 'not-configured' : 'success', findings: response.status === 'analysis_not_configured' ? [] : normalizeFindings(response.findings), message: response.message });
          setMessages((currentMessages) => [...currentMessages, { role: 'inky', text: response.status === 'analysis_not_configured' ? response.message || faqItems[3].answer : 'The analysis request finished. Open Review to inspect the returned findings.' }]);
        } catch (error) {
          const issue = error as AnalyzeError;
          setSession({ ...session, analysisStatus: 'error', findings: [], message: issue.message, errorKind: issue.kind, errorStatus: issue.status });
          setMessages((currentMessages) => [...currentMessages, { role: 'inky', text: `The retry did not complete: ${issue.message}` }]);
        } finally {
          setTyping(false);
        }
      })();
    }, 360);
  };
  const current = location.includes('review') ? 'Review workspace' : location.split('/').filter(Boolean).at(-1)?.replace('-', ' ') ?? 'InkGuard';
  return <>
    <button type="button" className="inky-fab" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Inky help' : 'Open Inky help'} aria-expanded={open} data-testid="button-inky">
      <Mascot state={status} />
      <span className="inky-fab-label">Ask Inky</span>
    </button>
    {open && <section className="inky-panel card" role="dialog" aria-modal="false" aria-labelledby="inky-title">
      <header className="inky-header"><div className="flex items-center gap-3"><Mascot state={status} /><div><strong id="inky-title">Inky</strong><div className="small muted">Local help · not AI</div></div></div><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close help"><X size={17} /></button></header>
      <div className="inky-context small muted">You’re in {current}. {session.analysisStatus === 'not-configured' ? 'Analysis is not configured yet.' : 'I can answer questions without sending your text anywhere.'}</div>
      <div className="inky-messages" aria-live="polite">{messages.length === 0 && <p className="small muted">Ask a question or choose a quick reply. Your message stays in this browser.</p>}{messages.map((message,index) => <div className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'user' ? 'You' : 'Inky'}</span><p>{message.text}</p></div>)}{typing && <div className="chat-bubble inky typing">Inky is thinking locally…</div>}</div>
      <div className="quick-replies">{faqItems.slice(0, 4).map((faq) => <button key={faq.label} className="quick-reply" onClick={() => ask(faq.label)}>{faq.label}</button>)}
        <button className="quick-reply" onClick={() => ask('How do decisions work?')}>How do decisions work?</button>
        <button className="quick-reply" onClick={() => ask('Privacy and drafts')}>Privacy and drafts</button>
        {(session.analysisStatus === 'error' || session.analysisStatus === 'not-configured') && <button className="quick-reply" onClick={() => ask('Retry analysis', true)}>Retry analysis</button>}
        {session.analysisStatus === 'success' && session.findings.length === 0 && <button className="quick-reply" onClick={() => ask('Why were no findings returned?')}>Why no findings?</button>}
      </div>
      <form className="inky-compose" onSubmit={(event) => { event.preventDefault(); ask(input); }}><label className="sr-only" htmlFor="inky-message">Ask Inky a question</label><input id="inky-message" className="field" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a local FAQ…" /><button className="btn btn-primary" type="submit" disabled={!input.trim() || typing} aria-label="Send question"><Send size={15}/></button></form>
      <p className="small muted mb-0">Inky uses fixed help answers. Your prompt is never sent to a service.</p>
    </section>}
  </>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [role, setRole] = useState(false);
  const { role: currentRole, setRole: updateRole, demo, setDemo, apiState, session } = useApp();
  const title = navGroups.flatMap((group) => group.links).find((link) => link.href === location)?.text ?? 'Workspace';
  const links = (mobile = false) => <div className="nav-scroll">
    {navGroups.map((group) => <div key={group.label} className="nav-group"><div className="nav-group-label">{group.label}</div>{group.links.map(({ href, text, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} onClick={() => mobile && setDrawer(false)}><Icon size={17} strokeWidth={1.8} /><span>{text}</span>{text === 'Review queue' && <span className="nav-count">4</span>}</Link>)}</div>)}
    <div className="nav-group"><div className="nav-group-label">PREFERENCES</div><Link href="/app/settings" className={`nav-link ${location === '/app/settings' ? 'active' : ''}`}><Settings size={17} strokeWidth={1.8} /><span>Settings</span></Link></div>
    {mobile && <Link className="nav-link" href="/" onClick={() => setDrawer(false)}><ArrowLeft size={17} />Back to home</Link>}
  </div>;
  const sidebar = <aside className={`sidebar ${drawer ? 'drawer' : 'desktop'}`} aria-label="Main navigation">
    <Link href="/app/review" className="brand-mark"><span className="logo-drop"><Mascot /></span><span>InkGuard</span></Link>
    <div className="workspace-select"><div className="workspace-icon">N</div><div className="min-w-0"><strong>Northstar Studio</strong><span>Editorial workspace</span></div><ChevronDown size={14} /></div>
    {links(drawer)}
    <div className="sidebar-bottom">
      <div className={`connection-status ${apiState}`}><span className="status-dot" /><span>{apiState === 'unknown' ? 'Backend not checked' : apiState === 'connected' ? 'Backend responded' : apiState === 'offline' ? 'Backend unreachable' : apiState === 'invalid-response' ? 'Backend response unreadable' : apiState === 'timeout' ? 'Analysis timed out' : 'Backend returned an error'}</span></div>
      <div className="sidebar-note">Draft analysis uses your configured InkGuard backend.</div>
      <Link href="/" className="back-home"><ArrowLeft size={15} />Back to home</Link>
    </div>
  </aside>;
  return <div className="app-shell">
    {sidebar}
    {drawer && <><button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawer(false)} /><button className="drawer-close" aria-label="Close navigation" onClick={() => setDrawer(false)}><X /></button></>}
    <main className="main-shell">
      <header className="topbar">
        <div className="flex items-center gap-3"><button className="mobile-menu icon-btn" onClick={() => setDrawer(true)} aria-label="Open navigation"><Menu /></button><div className="breadcrumb">Workspace <span>/</span> <strong>{title}</strong></div></div>
        <div className="topbar-actions">
          <label className="demo-switch"><input type="checkbox" checked={demo} onChange={(event) => setDemo(event.target.checked)} /><span className="switch-track" /><span>Demo mode</span></label>
          <div className="relative">
            <button className="role-button" onClick={() => setRole((value) => !value)} aria-expanded={role}><span className="avatar">M</span><span className="role-text"><b>{currentRole}</b><small>Role simulation</small></span><ChevronDown size={14} /></button>
            {role && <div className="dropdown role-menu"><div className="dropdown-title">Simulate a role</div>{(['Creator', 'Manager', 'Reviewer'] as UserRole[]).map((item) => <button key={item} onClick={() => { updateRole(item); setRole(false); }} className="dropdown-item"><UserRound size={15} />{item}{currentRole === item && <Check size={14} />}</button>)}<p className="dropdown-note">Role simulation only. InkGuard does not authenticate users.</p></div>}
          </div>
          <div className="relative">
            <button className="icon-btn" aria-label="Account menu" onClick={() => setMenu((value) => !value)}><MoreHorizontal size={19} /></button>
            {menu && <div className="dropdown avatar-menu"><div className="dropdown-title">Maya Chen</div><div className="dropdown-sub">Northstar Studio</div><Link href="/app/settings" className="dropdown-item" onClick={() => setMenu(false)}><Settings size={15} />Settings</Link><Link href="/" className="dropdown-item" onClick={() => setMenu(false)}><ArrowLeft size={15} />Back to home</Link></div>}
          </div>
        </div>
      </header>
      <div className="workspace-disclosure" data-testid="text-workspace-privacy-disclosure"><Shield size={14} /><span>Your draft is sent to the InkGuard backend for AI analysis. Do not paste confidential material you are not authorised to share.</span></div>
      <WorkspaceContent>{children}</WorkspaceContent>
    </main>
    <Inky status={session.analysisStatus} />
  </div>;
}

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}
function PrivacyNotice() { return <div className="privacy-notice" data-testid="text-privacy-disclosure"><Shield size={16} /><span>Your draft is sent to the InkGuard backend for AI analysis. Do not paste confidential material you are not authorised to share.</span></div>; }
function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`btn ${className}`} {...props}>{children}</button>; }

function Landing() {
  const [, setLocation] = useLocation();
  const { setDemo } = useApp();
  const trySample = () => { setDemo(true); setLocation('/app/review'); };
  return <div className="landing">
    <header className="landing-nav"><Link href="/" className="brand-mark"><span className="landing-logo"><Mascot /></span><span>InkGuard</span></Link><nav><a href="#how">How it works</a><a href="#features">Features</a><a href="#trust">Trust & privacy</a><Link href="/app/brand-kit">Brand kit</Link></nav><div className="landing-nav-cta"><Link href="/app/review" className="btn btn-quiet">Open workspace</Link><button className="btn btn-primary" onClick={trySample}>Try a sample draft <ArrowRight size={16} /></button></div></header>
    <section className="hero"><div className="hero-copy"><div className="hero-tag"><ShieldCheck size={15} /> A thoughtful final check for your words</div><h1>Clear copy.<br /><span>Confident publishing.</span></h1><p>Check every draft against your brand rules and approved facts, then make the final call with your team.</p><div className="hero-actions"><Link className="btn btn-primary btn-large" href="/app/review">Open workspace <ArrowRight size={16} /></Link><button className="btn btn-large" onClick={trySample}>Try a sample draft</button></div><div className="hero-footnote"><span className="small muted">Built for people, not autopilot.</span><span className="hero-dot" /> <span className="small muted">You stay in control of every decision.</span></div></div>
      <div className="hero-proof card"><div className="proof-top"><div><span className="small muted">NORTHSTAR STUDIO</span><h2>Draft review</h2></div><span className="pill"><span className="tiny-dot" />4 review points</span></div><div className="proof-body"><div className="proof-doc"><p>Northstar is <mark className="sample-highlight high">the only publishing platform you will ever need</mark>.</p><p>Our <mark className="sample-highlight medium">automatic editorial tools</mark> make every story perfect in seconds.</p><p>Join <mark className="sample-highlight critical">50,000 users</mark> who trust us to grow their audience.</p></div><div className="proof-findings"><div className="proof-finding"><span className="severity-chip critical"><AlertCircle size={13} /> Critical</span><b>Unverified audience figure</b><span className="small muted">Compare claims with approved facts.</span></div><div className="proof-finding"><span className="severity-chip high"><AlertCircle size={13} /> High</span><b>Absolute promise</b><span className="small muted">Ground the product claim.</span></div><div className="proof-footer"><span>Review suggestions</span><span className="mono">01 / 04</span></div></div></div><div className="proof-caption"><span><span className="legend-dot critical" />Critical</span><span><span className="legend-dot high" />High</span><span><span className="legend-dot medium" />Medium</span><span>Human decision required</span></div></div>
      <div className="hero-aside">BRAND REVIEW<br />BEFORE YOU PUBLISH <span>— 01 / 04</span></div>
    </section>
    <section className="how-section" id="how"><div className="section-intro"><span className="section-kicker">A clear path from draft to decision</span><h2>Four steps. Your call at every one.</h2><p>InkGuard helps make brand review a repeatable part of publishing—not a black box.</p></div><div className="steps">{[['01','Bring your draft','Choose a brand, then add the copy you are preparing to publish.'],['02','Set the context','Include the guidelines and approved facts that matter for this draft.'],['03','Review the signals','Read each finding in context. Check the evidence, rule, and proposed wording.'],['04','Decide together','Accept, edit, or reject suggestions. Keep people in the publishing loop.']].map(([number,title,body]) => <article className="step" key={number}><span className="step-number">{number}</span><div><h3>{title}</h3><p>{body}</p></div><ArrowRight size={17} /></article>)}</div></section>
    <section className="features-section" id="features"><div className="section-intro"><span className="section-kicker">Made for careful publishing</span><h2>Guardrails that explain themselves.</h2><p>Specific context, clear evidence, and decisions your team can own.</p></div><div className="feature-grid">{[
      [ShieldCheck,'Your rules, in context','Review against the guidelines and facts you actually supplied.'],
      [FileText,'Evidence beside the draft','See the exact wording behind each review point.'],
      [Lightbulb,'Suggestions, not commands','Consider practical edits without giving up editorial control.'],
      [Users,'A shared review queue','Keep handoffs and approvals visible to the right roles.'],
      [CheckCheck,'Decisions you can trace','Review choices stay visible in the current browser session.'],
      [LockIcon,'Privacy stated plainly','Know when text is sent and what is stored locally.'],
    ].map(([Icon,title,body]) => { const FeatureIcon = Icon as LucideIcon; return <article className="feature-card" key={title as string}><div className="feature-icon"><FeatureIcon size={19} /></div><h3>{title as string}</h3><p>{body as string}</p></article>; })}</div></section>
    <section className="trust-section" id="trust"><div className="trust-copy"><div className="trust-icon"><Shield size={22} /></div><h2>Trust starts with a clear boundary.</h2><p>InkGuard helps authors compare their words with the brand context they provide. A person reviews the evidence and chooses what happens next.</p><p className="trust-strong">Your draft is sent to the InkGuard backend for AI analysis. Do not paste confidential material you are not authorised to share.</p><Link href="/app/settings" className="text-link">See privacy and environment settings <ArrowRight size={15} /></Link></div><div className="trust-list"><div><span>01</span><p><strong>No silent edits</strong><br />Suggestions never change a draft on their own.</p></div><div><span>02</span><p><strong>No invented certainty</strong><br />A signal is a prompt to review, not a final verdict.</p></div><div><span>03</span><p><strong>Local means local</strong><br />Decisions and Brand Kit items are stored in this browser.</p></div></div></section>
    <section className="closing-cta"><div><h2>Make the last read a better read.</h2><p>Bring your brand context into the review—then publish with a human decision.</p></div><Link href="/app/review" className="btn btn-primary btn-large">Start a review <ArrowRight size={16} /></Link></section>
    <footer className="landing-footer"><Link href="/" className="brand-mark"><span className="mini-logo"><Mascot /></span>InkGuard</Link><span>Brand review before you publish.</span><div><Link href="/app/brand-kit">Brand Kit</Link><Link href="/app/settings">Privacy & settings</Link><span>© InkGuard</span></div></footer>
    <Inky />
  </div>;
}
function LockIcon({ size = 19 }: { size?: number }) { return <ShieldCheck size={size} />; }

function severityOf(finding: Finding): Severity { return finding.severity && ['low','medium','high','critical'].includes(finding.severity) ? finding.severity : 'medium'; }
function findingId(finding: Finding, index: number): string { return finding.id || `finding-${index}`; }
function normalizeFindings(items: Finding[]): Finding[] {
  return items.filter((item) => item && typeof item === 'object' && typeof item.issue === 'string').map((item) => {
    const severity = ['low','medium','high','critical'].includes(String(item.severity)) ? item.severity : undefined;
    const safeString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
    return {
      issue: item.issue,
      id: safeString(item.id),
      severity,
      evidence: safeString(item.evidence),
      brand_rule: safeString(item.brand_rule),
      explanation: safeString(item.explanation),
      suggested_correction: safeString(item.suggested_correction),
      confidence: typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? item.confidence : undefined,
      category: safeString(item.category),
    };
  });
}
function ReviewPage() {
  const { session, setSession, kit, role, demo, addActivity, setDemo } = useApp();
  const [activeId, setActiveId] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<'severity' | 'position'>('severity');
  const [editId, setEditId] = useState('');
  const [editText, setEditText] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState('');
  const [guidelineInput, setGuidelineInput] = useState('');
  const [factInput, setFactInput] = useState('');
  const [roleAction, setRoleAction] = useState('');
  const [flashTarget, setFlashTarget] = useState('');
  const counts = useMemo(() => session.findings.reduce((acc, finding) => { acc[severityOf(finding)] += 1; return acc; }, { critical: 0, high: 0, medium: 0, low: 0 }), [session.findings]);
  const orderedFindings = useMemo(() => {
    const list = session.findings.map((finding, index) => ({ finding, index, id: findingId(finding, index) })).filter(({ finding }) => filter === 'all' || severityOf(finding) === filter);
    if (sort === 'severity') list.sort((a,b) => ['critical','high','medium','low'].indexOf(severityOf(a.finding)) - ['critical','high','medium','low'].indexOf(severityOf(b.finding)));
    return list;
  }, [session.findings, filter, sort]);
  const pending = session.findings.filter((finding, index) => !session.decisions[findingId(finding,index)]).length;
  const analyzed = session.analysisStatus === 'success' || session.analysisStatus === 'demo';
  const update = (patch: Partial<ReviewSession>) => setSession({ ...session, ...patch });
  const parsePasted = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const addList = (type: 'guidelines' | 'facts', value: string) => {
    const values = parsePasted(value);
    if (!values.length) return;
    update({ [type]: [...session[type], ...values] });
    if (type === 'guidelines') setGuidelineInput(''); else setFactInput('');
  };
  const loadSample = () => { setDemo(true); setFormError(''); setSession({ brand: 'Northstar Studio', content: sampleDraft, guidelines: [...sampleGuidelines], facts: [...sampleFacts], findings: [], decisions: {}, analysisStatus: 'idle' }); };
  const clearForm = () => { setSession({ ...emptySession, guidelines: [...session.guidelines], facts: [...session.facts] }); setFormError(''); setActiveId(''); };
  const submit = async () => {
    if (!session.brand.trim() || !session.content.trim()) { setFormError('Add a brand name and draft before reviewing.'); return; }
    if (session.content.trim().length < 20) { setFormError('Add a little more draft context before reviewing (at least 20 characters).'); return; }
    if (!session.guidelines.length && !session.facts.length) { setFormError('Add at least one guideline or approved fact so the review has context.'); return; }
    setFormError(''); update({ analysisStatus: 'loading', findings: [], decisions: {}, message: undefined, errorKind: undefined, errorStatus: undefined });
    addActivity(`Submitted a draft for ${session.brand} analysis.`);
    if (demo) {
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      setSession({ ...session, analysisStatus: 'demo', findings: sampleFindings, decisions: {}, message: 'Sample review data. No draft was sent to the backend.' });
      return;
    }
    try {
      const response = await analyzeContent({ brand_name: session.brand, content: session.content, brand_guidelines: session.guidelines, approved_facts: session.facts });
      if (response.status === 'analysis_not_configured') {
        setSession({ ...session, analysisStatus: 'not-configured', findings: [], message: response.message || 'AI analysis is not connected yet.', errorKind: undefined, errorStatus: undefined });
      } else {
        const safeFindings = normalizeFindings(response.findings);
        setSession({ ...session, analysisStatus: 'success', findings: safeFindings, message: response.message, errorKind: undefined, errorStatus: undefined });
      }
    } catch (error) {
      const issue = error as AnalyzeError;
      setSession({ ...session, analysisStatus: 'error', findings: [], message: issue.message, errorKind: issue.kind, errorStatus: issue.status });
    }
  };
  const decide = (id: string, decision: LocalDecision['decision'], replacement?: string, reason?: string) => {
    const decisions = { ...session.decisions };
    if (decision === 'accepted' && replacement) decisions[id] = { findingId: id, decision, replacement, at: new Date().toISOString() };
    else decisions[id] = { findingId: id, decision, reason, at: new Date().toISOString() };
    update({ decisions }); addActivity(`Marked finding ${id} ${decision}.`);
  };
  const accept = (finding: Finding, id: string) => decide(id, 'accepted', finding.suggested_correction || undefined);
  const revert = (id: string) => { const decisions = { ...session.decisions }; delete decisions[id]; update({ decisions }); addActivity(`Undid decision for finding ${id}.`); };
  const startEdit = (finding: Finding, id: string) => { setEditId(id); setEditText(session.decisions[id]?.replacement || finding.suggested_correction || ''); };
  const saveEdit = (id: string) => { if (!editText.trim()) return; decide(id, 'edited', editText.trim()); setEditId(''); };
  const reject = (id: string) => { const reason = window.prompt('Optional reason for rejecting this suggestion:') ?? ''; decide(id, 'rejected', undefined, reason.trim() || undefined); };
  const revisedDraft = useMemo(() => {
    let result = session.content;
    session.findings.forEach((finding, index) => {
      const decision = session.decisions[findingId(finding,index)];
      if (!decision || (decision.decision !== 'accepted' && decision.decision !== 'edited') || !decision.replacement) return;
      const original = finding.evidence || finding.issue;
      if (original && result.includes(original)) result = result.replace(original, decision.replacement);
    });
    return result;
  }, [session.content, session.findings, session.decisions]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!activeId || !(session.analysisStatus === 'success' || session.analysisStatus === 'demo')) return;
      if (['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement).tagName)) return;
      const selected = session.findings.find((finding,index) => findingId(finding,index) === activeId);
      if (!selected) return;
      if (event.key.toLowerCase() === 'a') accept(selected, activeId);
      if (event.key.toLowerCase() === 'e') startEdit(selected, activeId);
      if (event.key.toLowerCase() === 'r') reject(activeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, session]);
  const copyDraft = async () => { try { await navigator.clipboard.writeText(revisedDraft); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } };
  const jumpToFinding = (id: string, counterpart: 'card' | 'mark') => {
    setActiveId(id);
    const targetId = counterpart === 'card' ? `finding-${id}` : `marked-${id}`;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (target instanceof HTMLElement) {
      const focusable = target.matches('button') ? target : target.querySelector('button');
      if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: true });
      else target.focus({ preventScroll: true });
    }
    setFlashTarget(targetId);
    window.setTimeout(() => setFlashTarget((current) => current === targetId ? '' : current), 1100);
  };
  const markedDraft = () => {
    let nodes: React.ReactNode[] = [session.content];
    session.findings.forEach((finding,index) => {
      const phrase = [finding.evidence, finding.issue].find((candidate) => Boolean(candidate && session.content.includes(candidate)));
      if (!phrase) return;
      const next: React.ReactNode[] = [];
      nodes.forEach((node) => {
        if (typeof node !== 'string' || !node.includes(phrase)) { next.push(node); return; }
        const pieces = node.split(phrase);
        pieces.forEach((piece, part) => { if (piece) next.push(piece); if (part < pieces.length - 1) {
          const id = findingId(finding,index);
          next.push(<mark key={`${id}-${part}`} id={`marked-${id}`} data-severity={severityOf(finding)} className={`finding-mark ${flashTarget === `marked-${id}` ? 'flash-target' : ''}`}><button className="mark-phrase" type="button" aria-label={`Jump from marked draft text to finding ${index+1}`} onClick={() => jumpToFinding(id,'card')}>{phrase}</button><button className="finding-marker" type="button" aria-label={`Go to finding ${index+1}`} onClick={() => jumpToFinding(id,'card')}><sup>{index+1}</sup></button></mark>);
        } });
      });
      nodes = next;
    });
    return nodes;
  };
  const submitForReview = () => { setRoleAction('Draft submitted for manager review. This status is local to this browser.'); addActivity('Submitted draft for review.'); };
  const managerAction = (action: string) => { setRoleAction(`${action}. This decision is local to this browser.`); addActivity(action); };
  return <div className="review-page">
    <PageHeader title="Review a draft" subtitle="Check a draft against the brand context before it goes out." action={<span className="pill"><ShieldCheck size={14} /> Human review required</span>} />
    <div className="review-toolbar"><div><span className="step-label">DRAFT CHECK</span><span className="muted"> — Context first, then a careful read.</span></div><div className="toolbar-actions"><Button className="btn-quiet" onClick={loadSample}><Sparkles size={15} />Load sample</Button><Button className="btn-quiet" onClick={clearForm}><RotateCcw size={15} />Clear form</Button></div></div>
    <PrivacyNotice />
    {(session.analysisStatus === 'idle' || session.analysisStatus === 'loading' || session.analysisStatus === 'error' || session.analysisStatus === 'not-configured') && <section className="card form-card">
      <div className="form-card-heading"><div><h2>Review context</h2><p>Give the review the right brand details. Pasted lines are added separately.</p></div><span className="pill">Required fields marked *</span></div>
      <div className="form-grid">
        <div className="form-left">
          <label className="label" htmlFor="brand-name">Brand name <span className="required">*</span></label><input id="brand-name" className="field" value={session.brand} onChange={(e) => update({ brand: e.target.value })} placeholder="For example, Northstar Studio" disabled={session.analysisStatus === 'loading'} data-testid="input-brand-name" />
          <div className="field-heading"><label className="label" htmlFor="draft-content">Draft content <span className="required">*</span></label><span className="small muted">{session.content.trim() ? session.content.trim().split(/\s+/).filter(Boolean).length : 0} words · {session.content.length.toLocaleString()} characters</span></div>
          <textarea id="draft-content" className="field draft-input" value={session.content} onChange={(e) => update({ content: e.target.value })} placeholder="Paste the copy you want to review…" disabled={session.analysisStatus === 'loading'} data-testid="input-draft-content" />
          <div className="field-help">Keep the original wording intact so findings can link back to the draft.</div>
        </div>
        <div className="form-context">
          <ListEditor title="Brand guidelines" subtitle="Tone, terminology, and claims" values={session.guidelines} placeholder="Add a guideline…" input={guidelineInput} setInput={setGuidelineInput} add={(value) => addList('guidelines',value)} remove={(index) => update({ guidelines: session.guidelines.filter((_,i)=>i!==index) })} disabled={session.analysisStatus === 'loading'} />
          <ListEditor title="Approved facts" subtitle="Facts this draft may rely on" values={session.facts} placeholder="Add an approved fact…" input={factInput} setInput={setFactInput} add={(value) => addList('facts',value)} remove={(index) => update({ facts: session.facts.filter((_,i)=>i!==index) })} disabled={session.analysisStatus === 'loading'} />
        </div>
      </div>
      {(session.guidelines.length === 0 || session.facts.length === 0) && <div className="context-warning"><Info size={15} /><span>{session.guidelines.length === 0 && session.facts.length === 0 ? 'Add at least one guideline or approved fact to give the review useful context.' : session.guidelines.length === 0 ? 'No guidelines added. Brand voice and terminology checks may be limited.' : 'No approved facts added. The review may have less context for fact checking.'}</span></div>}
      {formError && <div className="field-error" role="alert"><AlertCircle size={15} />{formError}</div>}
      {session.analysisStatus === 'loading' && <div className="loading-panel"><div className="skeleton loading-line" /><div className="skeleton loading-line short" /><div><strong>Reviewing your draft…</strong><p className="small muted">The form is locked while the backend responds.</p></div></div>}
      {session.analysisStatus === 'not-configured' && <div className="info-box" role="status"><Info size={18} /><div><strong>Analysis is not configured yet</strong><p>{session.message || 'AI analysis is not connected yet.'} This response is not a clean review. Your draft is ready to retry when the service is configured.</p></div><Button onClick={submit}>Retry analysis</Button></div>}
      {session.analysisStatus === 'error' && <div className="error-box" role="alert"><div className="flex items-start gap-3"><AlertCircle size={19} /><div className="flex-1"><strong>{session.errorKind === 'server' ? `The analysis service returned HTTP ${session.errorStatus ?? 'error'}` : session.errorKind === 'invalid-json' ? 'The analysis service response could not be read' : session.errorKind === 'timeout' ? 'The analysis request timed out' : 'The analysis service could not be reached'}</strong><p className="small">{session.message}</p><p className="small muted">{session.errorKind === 'server' ? 'The service responded with an error status. Check its logs and try again.' : session.errorKind === 'invalid-json' ? 'The service responded, but did not return valid analysis JSON.' : session.errorKind === 'timeout' ? 'The service did not finish within 60 seconds. You can retry the request.' : 'Check that the API is running and allows this browser origin through CORS.'}</p></div><Button onClick={submit}><RotateCcw size={15} />Retry</Button></div></div>}
      <div className="form-footer"><span className="small muted"><Shield size={14} /> Your draft is sent only when you select Review draft.</span><Button className="btn-primary btn-review" onClick={submit} disabled={session.analysisStatus === 'loading'}>{session.analysisStatus === 'loading' ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}Review draft</Button></div>
    </section>}
    {analyzed && <section className="results-section">
      <div className={`analysis-banner ${session.analysisStatus === 'demo' ? 'sample-banner' : ''}`} role="status"><div className="analysis-banner-icon">{session.analysisStatus === 'demo' ? <Sparkles size={19} /> : <BadgeCheck size={19} />}</div><div><strong>{session.analysisStatus === 'demo' ? 'Sample review — no draft sent' : 'Analysis complete'}</strong><span>{session.analysisStatus === 'demo' ? 'Explore the review workflow using clearly labeled sample findings.' : session.message || 'Review the findings and make each decision yourself.'}</span></div><span className="pill">{session.findings.length} {session.findings.length === 1 ? 'finding' : 'findings'}</span></div>
      {session.analysisStatus === 'demo' && <div className="sample-strip"><Info size={15} />Sample data only. These findings are illustrative and are not backend analysis.</div>}
      {session.findings.length === 0 ? <div className="card calm-empty"><div className="empty-icon"><CheckCheck size={22} /></div><h2>No issues found, human review still recommended</h2><p>The analysis service returned no findings for this draft. This does not guarantee the copy is correct; keep your editorial review in place.</p><Button onClick={() => update({ analysisStatus: 'idle' })}>Review another draft</Button></div> : <>
        <div className="result-summary card"><div className="result-counts">{(['critical','high','medium','low'] as Severity[]).map((severity) => <button className={`count-item ${filter === severity ? 'selected' : ''}`} key={severity} onClick={() => setFilter(filter === severity ? 'all' : severity)}><span className={`severity-dot ${severity}`} /><span className={`severity-name severity-${severity}`}>{severity[0].toUpperCase()+severity.slice(1)}</span><b>{counts[severity]}</b></button>)}</div><div className="progress-wrap"><div className="progress-text"><span>Reviewed</span><strong>{session.findings.length - pending} of {session.findings.length}</strong></div><div className="progress-track"><div style={{ width: `${session.findings.length ? (session.findings.length-pending)/session.findings.length*100 : 0}%` }} /></div></div></div>
        <div className="results-grid">
          <section className="card draft-result"><div className="section-card-heading"><div><h2>Draft with findings</h2><span className="small muted">Select a highlight to inspect its finding</span></div><button className="icon-btn" aria-label="Copy draft" onClick={() => { void copyDraft(); }}><Copy size={16} /></button></div>
            <div className="draft-review-text">{showDiff ? <DiffView original={session.content} revised={revisedDraft} /> : markedDraft()}</div>
            <div className="draft-actions"><div><Button className={showDiff ? 'btn-primary' : ''} onClick={() => setShowDiff((value) => !value)}><FileText size={15} />{showDiff ? 'Show marked draft' : 'Compare revised draft'}</Button><Button onClick={() => { void copyDraft(); }}><Copy size={15} />{copied ? 'Copied' : 'Copy revised draft'}</Button></div><span className="small muted">{Object.values(session.decisions).filter((d) => d.decision !== 'rejected').length} suggested edit(s) applied</span></div>
          </section>
          <section className="findings-column"><div className="findings-head"><div><h2>Review findings</h2><span className="small muted">{filter === 'all' ? 'All findings' : `${filter[0].toUpperCase()+filter.slice(1)} findings`} · choose a decision</span></div><button className="sort-button" onClick={() => setSort(sort === 'severity' ? 'position' : 'severity')}><ArrowDownUp size={14} />{sort === 'severity' ? 'Severity' : 'Draft order'}</button></div>
            {orderedFindings.length === 0 ? <div className="card no-results">No findings match this filter. <button onClick={() => setFilter('all')}>Show all</button></div> : orderedFindings.map(({ finding,index,id }) => <FindingCard key={id} finding={finding} index={index} id={id} selected={activeId===id} flash={flashTarget===`finding-${id}`} decision={session.decisions[id]} editing={editId===id} editText={editText} setEditText={setEditText} onSelect={() => jumpToFinding(id,'mark')} onAccept={() => accept(finding,id)} onEdit={() => startEdit(finding,id)} onSave={() => saveEdit(id)} onCancel={() => setEditId('')} onReject={() => reject(id)} onUndo={() => revert(id)} />)}
          </section>
        </div>
        <div className="refresh-loss-notice"><Info size={15} /><span>Review decisions are stored in this browser session only and may be lost when you refresh.</span></div>
        {roleAction && <div className="success-box role-message" role="status"><Check size={16} />{roleAction}<button aria-label="Dismiss" onClick={() => setRoleAction('')}><X size={15} /></button></div>}
        <div className="decision-footer card"><div><strong>{pending === 0 ? 'Every finding has a decision' : `${pending} ${pending === 1 ? 'finding needs' : 'findings need'} a decision`}</strong><span className="small muted">Decisions stay local until an API is available.</span></div><div className="decision-buttons">
          {role === 'Creator' ? <Button className="btn-primary" disabled={pending > 0} onClick={submitForReview}><Send size={15} />Submit for review</Button> : <><Button className="btn-primary" disabled={pending > 0} onClick={() => managerAction('Approved draft')}><Check size={15} />Approve</Button><Button className="btn-danger" onClick={() => managerAction('Changes requested')}><RotateCcw size={15} />Request changes</Button></>}
        </div></div>
      </>}
    </section>}
  </div>;
}

function ListEditor({ title, subtitle, values, placeholder, input, setInput, add, remove, disabled = false }: { title: string; subtitle: string; values: string[]; placeholder: string; input: string; setInput: (value: string) => void; add: (value: string) => void; remove: (index: number) => void; disabled?: boolean }) {
  return <div className="list-editor"><div className="list-title"><div><strong>{title}</strong><span>{subtitle}</span></div><span className="list-count">{values.length}</span></div><div className="context-items">{values.map((value,index) => <div className="context-item" key={`${value}-${index}`}><span>{value}</span><button type="button" aria-label={`Remove ${title} item ${index+1}`} disabled={disabled} onClick={() => remove(index)}><X size={13} /></button></div>)}</div><div className="list-add"><textarea className="field" rows={2} placeholder={placeholder} value={input} onChange={(event) => setInput(event.target.value)} disabled={disabled} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); add(input); } }} /><button className="icon-btn add-icon" type="button" disabled={disabled || !input.trim()} onClick={() => add(input)} aria-label={`Add ${title}`}><Plus size={17} /></button></div><span className="small muted">Press Enter to add a line. Shift+Enter for a new line.</span></div>;
}

function FindingCard({ finding, index, id, selected, flash, decision, editing, editText, setEditText, onSelect, onAccept, onEdit, onSave, onCancel, onReject, onUndo }: { finding: Finding; index: number; id: string; selected: boolean; flash: boolean; decision?: LocalDecision; editing: boolean; editText: string; setEditText: (value: string) => void; onSelect: () => void; onAccept: () => void; onEdit: () => void; onSave: () => void; onCancel: () => void; onReject: () => void; onUndo: () => void }) {
  const severity = severityOf(finding);
  const Icon = severity === 'critical' || severity === 'high' ? AlertCircle : severity === 'medium' ? Info : Check;
  return <article className={`finding-card card ${selected ? 'selected' : ''} ${decision ? 'decided' : ''} ${flash ? 'flash-target' : ''}`} id={`finding-${id}`} tabIndex={0} role="group" aria-label={`Finding ${index+1}: ${finding.issue}`} onClick={onSelect} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } }}>
    <div className="finding-top"><span className={`severity-chip ${severity}`}><Icon size={13} />{severity[0].toUpperCase()+severity.slice(1)}</span><span className="finding-number">Finding {String(index+1).padStart(2,'0')}</span>{decision && <span className={`decision-tag ${decision.decision}`}>{decision.decision}</span>}</div>
    <div className="finding-title-row"><h3>{finding.category || 'Brand review'}</h3>{typeof finding.confidence === 'number' && Number.isFinite(finding.confidence) && <span className="confidence">{Math.round(Math.max(0,Math.min(1,finding.confidence))*100)}% confidence</span>}</div>
    <p className="finding-issue">{finding.issue || 'Potential brand inconsistency'}</p>
    {finding.evidence && <div className="finding-detail"><span className="detail-label">Evidence</span><blockquote>{finding.evidence}</blockquote></div>}
    {finding.brand_rule && <div className="finding-detail"><span className="detail-label">Brand rule</span><p>{finding.brand_rule}</p></div>}
    {finding.explanation && <div className="finding-detail"><span className="detail-label">Why it matters</span><p>{finding.explanation}</p></div>}
    {(finding.suggested_correction || editing) && <div className="suggestion"><div className="suggestion-head"><span className="detail-label">Suggested correction</span><span className="suggestion-label">PROPOSED</span></div>{editing ? <><textarea className="field edit-suggestion" value={editText} onChange={(event) => setEditText(event.target.value)} aria-label="Edit suggested correction" onClick={(event) => event.stopPropagation()} /><div className="edit-actions"><Button className="btn-primary" onClick={(event) => { event.stopPropagation(); onSave(); }}><Save size={14} />Save edit</Button><Button onClick={(event) => { event.stopPropagation(); onCancel(); }}>Cancel</Button></div></> : <p>{finding.suggested_correction || 'No suggested replacement was provided.'}</p>}</div>}
    <div className="finding-actions">{decision ? <><span className="small muted">{decision.decision === 'rejected' ? decision.reason ? `Reason: ${decision.reason}` : 'Suggestion rejected; original wording kept.' : 'Suggestion applied to revised draft.'}</span><Button className="btn-quiet" onClick={(event) => { event.stopPropagation(); onUndo(); }}><Undo2 size={14} />Undo</Button></> : <><Button className="btn-primary compact" onClick={(event) => { event.stopPropagation(); onAccept(); }}><Check size={14} />Accept <kbd>A</kbd></Button><Button className="compact" onClick={(event) => { event.stopPropagation(); onEdit(); }}><Pencil size={14} />Edit <kbd>E</kbd></Button><Button className="btn-quiet compact" onClick={(event) => { event.stopPropagation(); onReject(); }}><X size={14} />Reject <kbd>R</kbd></Button></>}</div>
  </article>;
}
function DiffView({ original, revised }: { original: string; revised: string }) {
  if (original === revised) return <p className="muted">No accepted or edited suggestions have been applied yet.</p>;
  return <div className="diff-view"><div><span className="diff-label removed">Original</span><p>{original}</p></div><div><span className="diff-label added">Revised</span><p>{revised}</p></div></div>;
}

function QueuePage() {
  const [items, setItems] = useState(queueSamples);
  const [filter, setFilter] = useState('All drafts');
  const [selected, setSelected] = useState<typeof queueSamples[number] | null>(null);
  const [comment, setComment] = useState('');
  const [comments, setComments] = useState<Record<string,string[]>>({});
  const { role, addActivity } = useApp();
  const lanes = ['Draft','In review','Changes requested','Approved'];
  const shown = items.filter((item) => filter === 'All drafts' || item.status === filter);
  const changeStatus = (id: string, status: string) => { setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item)); setSelected((current) => current?.id === id ? { ...current, status } : current); addActivity(`Queue item ${id} moved to ${status}.`); };
  return <><PageHeader title="Review queue" subtitle="A shared view of work moving through brand review." action={<span className="pill"><Info size={14} />Sample queue</span>} />
    <div className="queue-sample-notice"><Info size={16} /><span>These queue items are sample data. Comments, status changes, and revision notes are local to this browser.</span></div>
    <div className="queue-toolbar card"><div><strong>Editorial drafts</strong><span className="small muted">4 items · Northstar Studio</span></div><div className="queue-filters">{['All drafts',...lanes].map((item) => <button key={item} className={`filter-chip ${filter===item?'active':''}`} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
    <div className="card table-card"><div className="table-wrap"><table className="data-table"><thead><tr><th>Draft</th><th>Owner</th><th>Updated</th><th>Status</th><th>Notes</th><th aria-label="Actions" /></tr></thead><tbody>{shown.map((item) => <tr key={item.id}><td><button className="draft-link" onClick={() => setSelected(item)}><strong>{item.title}</strong><span>{item.id} · Northstar Studio</span></button></td><td>{item.owner}</td><td className="muted">{item.date}</td><td><span className={`status-label ${item.status.toLowerCase().replaceAll(' ','-')}`}><span />{item.status}</span></td><td className="note-cell">{item.note}</td><td><button className="icon-btn" aria-label={`Open ${item.title}`} onClick={() => setSelected(item)}><ArrowRight size={16} /></button></td></tr>)}</tbody></table></div>{shown.length===0 && <div className="no-results">No drafts in this status.</div>}</div>
    <div className="queue-lanes">{lanes.map((lane) => <section className="lane-card card" key={lane}><div className="lane-header"><span className={`status-label ${lane.toLowerCase().replaceAll(' ','-')}`}><span />{lane}</span><span className="lane-count">{items.filter((item)=>item.status===lane).length}</span></div>{items.filter((item)=>item.status===lane).map((item) => <button className="lane-item" key={item.id} onClick={() => setSelected(item)}><strong>{item.title}</strong><span>{item.owner} · {item.id}</span></button>)}{!items.some((item)=>item.status===lane) && <p className="lane-empty">No drafts here</p>}</section>)}</div>
    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="modal-card card" role="dialog" aria-modal="true" aria-labelledby="queue-modal-title"><div className="modal-head"><div><span className="small muted mono">{selected.id} · SAMPLE ITEM</span><h2 id="queue-modal-title">{selected.title}</h2></div><button className="icon-btn" aria-label="Close details" onClick={() => setSelected(null)}><X /></button></div><div className="queue-detail-grid"><div><span className="detail-label">Status</span><span className={`status-label ${selected.status.toLowerCase().replaceAll(' ','-')}`}><span />{selected.status}</span></div><div><span className="detail-label">Owner</span><strong>{selected.owner}</strong></div><div><span className="detail-label">Updated</span><span>{selected.date}</span></div></div><div className="revision-box"><h3>Revision history</h3><div className="revision-item"><span className="timeline-dot" /><p><strong>{selected.date}</strong><br />{selected.note}</p></div><div className="revision-item"><span className="timeline-dot muted-dot" /><p><strong>Draft submitted</strong><br />Initial copy added to the sample queue.</p></div></div>
      <div className="comment-area"><h3><MessageSquare size={16} /> Comments <span className="small muted">Local only</span></h3><div className="comment-list">{(comments[selected.id]||[]).map((text,index)=><p className="comment-bubble" key={`${text}-${index}`}><strong>{role}</strong><br />{text}</p>)}{(comments[selected.id]||[]).length===0&&<p className="small muted">No comments yet.</p>}</div><div className="comment-compose"><input className="field" value={comment} onChange={(event)=>setComment(event.target.value)} placeholder="Add a review note…" onKeyDown={(event)=>{if(event.key==='Enter'&&comment.trim()){setComments({...comments,[selected.id]:[...(comments[selected.id]||[]),comment.trim()]});setComment('');}}} /><Button disabled={!comment.trim()} onClick={()=>{setComments({...comments,[selected.id]:[...(comments[selected.id]||[]),comment.trim()]});setComment('');}}>Add note</Button></div></div>
      <div className="modal-actions">{role==='Creator' ? <Button onClick={()=>changeStatus(selected.id,'In review')}>Submit for review</Button> : <><Button className="btn-primary" onClick={()=>changeStatus(selected.id,'Approved')}><Check size={14} />Approve</Button><Button className="btn-danger" onClick={()=>changeStatus(selected.id,'Changes requested')}>Request changes</Button></>}<Button onClick={()=>setSelected(null)}>Close</Button></div>
    </section></div>}
  </>;
}

type KitTab = 'Guidelines' | 'Approved facts' | 'Terminology' | 'Assets';
function BrandKitPage() {
  const [, setLocation] = useLocation();
  const { kit, setKit, session, setSession, addActivity } = useApp();
  const [tab, setTab] = useState<KitTab>('Guidelines');
  const [draft, setDraft] = useState('');
  const [preferred, setPreferred] = useState('');
  const [avoided, setAvoided] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const tabItems: KitTab[] = ['Guidelines','Approved facts','Terminology','Assets'];
  const values = tab === 'Guidelines' ? kit.guidelines : tab === 'Approved facts' ? kit.facts : kit.assets;
  const persist = (next: BrandKit) => { setKit(next); setMessage('Saved in this browser.'); window.setTimeout(()=>setMessage(''),2200); };
  const addRows = () => {
    if (tab === 'Terminology') {
      if (!preferred.trim() || !avoided.trim()) return;
      persist({ ...kit, terminology: [...kit.terminology,{ preferred: preferred.trim(), avoided: avoided.trim() }] }); setPreferred(''); setAvoided('');
    } else {
      const entries = draft.split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);
      if (!entries.length) return;
      if (tab === 'Guidelines') persist({ ...kit, guidelines: [...kit.guidelines,...entries] });
      else if (tab === 'Approved facts') persist({ ...kit, facts: [...kit.facts,...entries] });
      else persist({ ...kit, assets: [...kit.assets,...entries] });
      setDraft('');
    }
    addActivity(`Updated Brand Kit: ${tab.toLowerCase()}.`);
  };
  const remove = (index: number) => {
    if (tab === 'Guidelines') persist({ ...kit, guidelines: kit.guidelines.filter((_,i)=>i!==index) });
    if (tab === 'Approved facts') persist({ ...kit, facts: kit.facts.filter((_,i)=>i!==index) });
    if (tab === 'Assets') persist({ ...kit, assets: kit.assets.filter((_,i)=>i!==index) });
    if (tab === 'Terminology') persist({ ...kit, terminology: kit.terminology.filter((_,i)=>i!==index) });
    addActivity(`Removed an item from Brand Kit: ${tab.toLowerCase()}.`);
  };
  const saveEdit = (index: number) => {
    if (tab === 'Guidelines') persist({ ...kit, guidelines: kit.guidelines.map((item,i)=>i===index?editValue.trim():item) });
    if (tab === 'Approved facts') persist({ ...kit, facts: kit.facts.map((item,i)=>i===index?editValue.trim():item) });
    if (tab === 'Assets') persist({ ...kit, assets: kit.assets.map((item,i)=>i===index?editValue.trim():item) });
    setEditing(null);
  };
  const useInReview = () => {
    setSession({ ...session, guidelines: [...kit.guidelines], facts: [...kit.facts], findings: [], decisions: {}, analysisStatus: 'idle', message: undefined });
    addActivity('Loaded Brand Kit guidelines and facts into the review form.');
    setLocation('/app/review');
  };
  return <><PageHeader title="Brand Kit" subtitle="Keep the context you reuse close to the review." action={<Button className="btn-primary" onClick={useInReview}><FileCheck2 size={15} />Use in review</Button>} />
    <div className="local-storage-banner"><Save size={16} /><div><strong>Browser-only storage</strong><span>Brand Kit items are saved in this browser using localStorage. They are not synced or sent to the backend.</span></div></div>
    <div className="kit-layout"><nav className="kit-tabs card" aria-label="Brand Kit categories">{tabItems.map((item)=> <button key={item} className={`kit-tab ${tab===item?'active':''}`} onClick={()=>{setTab(item);setEditing(null);}}>{item}<span>{item==='Guidelines'?kit.guidelines.length:item==='Approved facts'?kit.facts.length:item==='Terminology'?kit.terminology.length:kit.assets.length}</span></button>)}</nav>
      <section className="card kit-content"><div className="kit-content-heading"><div><span className="small muted">NORTHSTAR STUDIO</span><h2>{tab}</h2><p>{tab==='Guidelines'?'Rules for voice, claims, and presentation.':tab==='Approved facts'?'Approved facts to check factual claims against.':tab==='Terminology'?'Preferred words paired with terms to avoid.':'Reference assets for your editorial team.'}</p></div><span className="pill"><Save size={13} />Saved locally</span></div>
        {tab==='Terminology' ? <div className="terminology-list">{kit.terminology.map((item,index)=><div className="term-row" key={`${item.preferred}-${index}`}>{editing===index?<><input className="field" value={preferred} onChange={(e)=>setPreferred(e.target.value)} aria-label="Preferred term" /><input className="field" value={avoided} onChange={(e)=>setAvoided(e.target.value)} aria-label="Avoided term" /><Button onClick={()=>{persist({...kit,terminology:kit.terminology.map((term,i)=>i===index?{preferred,avoided}:term)});setEditing(null);}}>Save</Button></>:<><span className="term-preferred">{item.preferred}</span><ArrowRight size={15}/><span className="term-avoided">{item.avoided}</span><button className="icon-btn" aria-label="Edit terminology" onClick={()=>{setEditing(index);setPreferred(item.preferred);setAvoided(item.avoided);}}><Pencil size={14}/></button><button className="icon-btn" aria-label="Remove terminology" onClick={()=>remove(index)}><Trash2 size={14}/></button></>}</div>)}</div> : <div className="kit-items">{values.map((value,index)=><div className="kit-item" key={`${value}-${index}`}><span className="kit-item-number">{String(index+1).padStart(2,'0')}</span>{editing===index?<><input className="field" value={editValue} onChange={(e)=>setEditValue(e.target.value)} aria-label={`Edit ${tab} item`} /><Button onClick={()=>saveEdit(index)}>Save</Button></>:<><span className="kit-item-text">{value}</span><button className="icon-btn" aria-label={`Edit ${tab} item`} onClick={()=>{setEditing(index);setEditValue(value);}}><Pencil size={14}/></button><button className="icon-btn" aria-label={`Remove ${tab} item`} onClick={()=>remove(index)}><Trash2 size={14}/></button></>}</div>)}{values.length===0&&<div className="kit-empty"><BookOpen size={22}/><strong>No {tab.toLowerCase()} yet</strong><span>Add a few items to give future reviews useful context.</span></div>}</div>}
        <div className="kit-add-area">{tab==='Terminology'?<div className="term-inputs"><label><span className="label">Preferred term</span><input className="field" value={preferred} onChange={(e)=>setPreferred(e.target.value)} placeholder="members"/></label><label><span className="label">Avoid</span><input className="field" value={avoided} onChange={(e)=>setAvoided(e.target.value)} placeholder="users"/></label><Button className="btn-primary" onClick={addRows} disabled={!preferred.trim()||!avoided.trim()}><Plus size={15}/>Add pair</Button></div>:<><label className="label" htmlFor="kit-add">{tab==='Assets'?'Add asset reference':`Add ${tab.toLowerCase()}`}</label><textarea id="kit-add" className="field" rows={3} value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder={tab==='Assets'?'Describe a logo, guide, or asset reference. Add one per line.':'Add one item per line. Paste multiple lines to import them together.'}/><div className="kit-add-footer"><span className="small muted"><Upload size={13}/>Enter-separated paste import</span><Button className="btn-primary" onClick={addRows} disabled={!draft.trim()}><Plus size={15}/>Add items</Button></div></>}</div>
        {message&&<div className="saved-message" role="status"><Check size={14}/>{message}</div>}
      </section>
    </div>
  </>;
}

function InsightsPage() {
  const { demo } = useApp();
  return <><PageHeader title="Insights" subtitle="A sample view of review patterns for an editorial team." action={<span className="pill"><Info size={14}/>Sample analytics</span>}/>
    <div className="insights-disclaimer"><Info size={16}/><span>Illustrative sample data only. No backend analytics or audit endpoint is connected.</span></div>
    <div className="metric-grid"><div className="metric-card card"><span>Drafts reviewed</span><strong>110</strong><small>Across the sample period</small><div className="metric-spark"><span style={{height:'35%'}}/><span style={{height:'50%'}}/><span style={{height:'43%'}}/><span style={{height:'68%'}}/><span style={{height:'59%'}}/><span style={{height:'82%'}}/></div></div><div className="metric-card card"><span>Review points found</span><strong>46</strong><small>Sample findings, not a quality score</small><div className="metric-bars"><i/><i/><i/><i/></div></div><div className="metric-card card"><span>Edits considered</span><strong>71%</strong><small>Sample share of suggestions accepted</small><div className="metric-progress"><span/></div></div></div>
    <section className="card chart-card"><div className="section-card-heading"><div><h2>Review activity</h2><span className="small muted">Sample weekly volume · illustrative</span></div><span className="pill">Last 6 weeks</span></div><div className="chart-legend"><span><i className="legend-bar reviewed"/>Drafts reviewed</span><span><i className="legend-bar changes"/>Changes requested</span></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={sampleChartData} margin={{top:12,right:12,left:-18,bottom:2}} barGap={5}><CartesianGrid stroke="#22396f" vertical={false}/><XAxis dataKey="week" stroke="#a6b2cf" tickLine={false} axisLine={false} tick={{fontSize:11}}/><YAxis stroke="#a6b2cf" tickLine={false} axisLine={false} tick={{fontSize:11}}/><Tooltip contentStyle={{background:'#0d1c42',border:'1px solid #22396f',borderRadius:8,color:'#f3f0e6'}}/><Bar dataKey="reviewed" fill="#d8c58f" radius={[3,3,0,0]} maxBarSize={22}/><Bar dataKey="changes" fill="#8798bd" radius={[3,3,0,0]} maxBarSize={22}/></BarChart></ResponsiveContainer></div></section>
    <section className="card chart-card findings-timeline"><div className="section-card-heading"><div><h2>Findings over time</h2><span className="small muted">Illustrative sample finding counts by week</span></div><span className="pill">Sample data</span></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={sampleFindingsTimeline} margin={{top:12,right:12,left:-18,bottom:2}}><CartesianGrid stroke="#22396f" vertical={false}/><XAxis dataKey="week" stroke="#a6b2cf" tickLine={false} axisLine={false} tick={{fontSize:11}}/><YAxis stroke="#a6b2cf" tickLine={false} axisLine={false} tick={{fontSize:11}}/><Tooltip contentStyle={{background:'#0d1c42',border:'1px solid #22396f',borderRadius:8,color:'#f3f0e6'}}/><Bar dataKey="findings" name="Findings" fill="#d8c58f" radius={[3,3,0,0]} maxBarSize={28}/></BarChart></ResponsiveContainer></div></section>
    <div className="insights-lower"><section className="card"><div className="section-card-heading"><div><h2>Top recurring categories</h2><span className="small muted">Illustrative sample categorization</span></div></div>{[['Unsupported claim',32,'critical'],['Terminology mismatch',26,'medium'],['Tone and voice',24,'high'],['Feature clarity',18,'low']].map(([label,value,severity])=><div className="theme-row" key={label as string}><div><span className={`severity-dot ${severity as string}`}/><span>{label as string}</span><strong>{value}%</strong></div><div className="theme-track"><span className={severity as string} style={{width:`${value}%`}}/></div></div>)}</section><section className="card insight-note"><div className="feature-icon"><Gauge size={18}/></div><h2>What these numbers can—and can’t—say</h2><p>Review counts describe workflow activity, not writing quality. A high finding count can reflect strong guardrails, a detailed draft, or a need for more approved context.</p><p>Connect an audit API in a future release to replace this sample view with real, permission-aware reporting.</p><span className="pill">{demo?'Demo mode enabled':'Local sample view'}</span></section></div>
    <div className="insights-followup-grid"><section className="card followup-card"><div className="section-card-heading"><div><h2>Most-triggered guidelines</h2><span className="small muted">Illustrative sample audit counts</span></div></div>{sampleTriggeredGuidelines.map((item,index)=><div className="guideline-stat" key={item.label}><div><span className="mono">{String(index+1).padStart(2,'0')}</span><strong>{item.label}</strong><b>{item.count}</b></div><div className="theme-track"><span style={{width:`${item.count/19*100}%`}}/></div></div>)}</section><section className="card followup-card"><div className="section-card-heading"><div><h2>Guidelines that may be unclear</h2><span className="small muted">Signals for editorial refinement, not a verdict</span></div></div>{sampleUnclearGuidelines.map((item)=><div className="unclear-guideline" key={item.label}><div><strong>{item.label}</strong><span className="pill">{item.count} sample questions</span></div><p>{item.note}</p></div>)}</section></div>
    <p className="small muted insight-audit"><ActivityIcon size={14}/>Backend audit trail: not connected. A future audit endpoint could provide a verified review history.</p>
  </>;
}

function ActivityPage() {
  const { activity } = useApp();
  const starter = ['Opened the InkGuard workspace.','Sample queue loaded for Northstar Studio.','Brand Kit starter context is available in this browser.'];
  const events = [...activity].reverse();
  return <><PageHeader title="Activity" subtitle="A local timeline of actions in this browser session." action={<span className="pill"><ActivityIcon size={14}/>Session only</span>}/><div className="local-storage-banner"><Info size={16}/><div><strong>Local session timeline</strong><span>Activity events are not synced, audited, or sent to a backend.</span></div></div><section className="card activity-card"><div className="section-card-heading"><div><h2>Recent activity</h2><span className="small muted">This browser session</span></div><span className="pill">{events.length+starter.length} events</span></div><div className="activity-timeline">{[...events,...starter].map((event,index)=><div className="activity-event" key={`${event}-${index}`}><span className="activity-point"><ActivityIcon size={14}/></span><div><p>{event}</p><span className="small muted">{index < events.length ? 'Just now · Local action' : 'Sample event · Demonstration data'}</span></div><span className="mono small muted">{String(index+1).padStart(2,'0')}</span></div>)}</div></section></>;
}

function SettingsPage() {
  const { demo, setDemo, setSession, resetLocalData } = useApp();
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearData = () => { resetLocalData(); setClearConfirm(false); };
  return <><PageHeader title="Settings" subtitle="Environment and privacy information for this browser."/>
    <div className="settings-grid"><section className="card settings-card"><div className="settings-heading"><div className="settings-icon"><Settings size={18}/></div><div><h2>Connection</h2><p>Read-only configuration for the analysis service.</p></div></div><label className="label" htmlFor="api-url">Analysis API base URL</label><input id="api-url" className="field mono" value={API_BASE_URL} readOnly/><span className="small muted">Set VITE_API_BASE_URL in the frontend environment. InkGuard calls POST /analyze only.</span><div className="connection-details"><div><span>Current response state</span><strong>Derived from the last analysis request</strong></div><span className="pill">No health check</span></div><div className="cors-note"><Info size={15}/><span>During local development, configure the FastAPI service to allow this frontend origin through CORS.</span></div></section>
      <section className="card settings-card"><div className="settings-heading"><div className="settings-icon"><Shield size={18}/></div><div><h2>AI and privacy</h2><p>Understand where draft text travels.</p></div></div><div className="privacy-copy"><p>Your draft is sent to the InkGuard backend for AI analysis. Do not paste confidential material you are not authorised to share.</p><p>Review decisions, Brand Kit content, role simulation, and activity are stored only in this browser. There is no account authentication in this prototype.</p><p>Inky uses local, rule-based FAQ answers. It is not an AI assistant and does not send your messages.</p></div></section>
      <section className="card settings-card"><div className="settings-heading"><div className="settings-icon"><Sparkles size={18}/></div><div><h2>Demo mode</h2><p>Explore the workflow with explicitly marked sample analysis.</p></div></div><label className="setting-toggle"><span><strong>Use sample review data</strong><small>Sample content and findings are not sent to the backend.</small></span><input type="checkbox" checked={demo} onChange={(event)=>setDemo(event.target.checked)}/><span className="switch-track"/></label></section>
       <section className="card settings-card danger-settings"><div className="settings-heading"><div className="settings-icon"><Trash2 size={18}/></div><div><h2>Clear local data</h2><p>Remove saved preferences, Brand Kit content, and in-memory review and activity state.</p></div></div>{clearConfirm?<div className="confirm-clear"><p>This removes locally saved preferences and resets browser-only review and activity state. Continue?</p><Button className="btn-danger" onClick={clearData}>Clear local data</Button><Button onClick={()=>setClearConfirm(false)}>Cancel</Button></div>:<Button className="btn-danger" onClick={()=>setClearConfirm(true)}><Trash2 size={15}/>Clear browser data</Button>}</section>
    </div>
  </>;
}

function Router() {
  return <Switch>
    <Route path="/" component={Landing}/>
    <Route path="/app/review">{()=><AppShell><ReviewPage/></AppShell>}</Route>
    <Route path="/app/queue">{()=><AppShell><QueuePage/></AppShell>}</Route>
    <Route path="/app/brand-kit">{()=><AppShell><BrandKitPage/></AppShell>}</Route>
    <Route path="/app/insights">{()=><AppShell><InsightsPage/></AppShell>}</Route>
    <Route path="/app/activity">{()=><AppShell><ActivityPage/></AppShell>}</Route>
    <Route path="/app/settings">{()=><AppShell><SettingsPage/></AppShell>}</Route>
    <Route>{()=><AppShell><NotFound/></AppShell>}</Route>
  </Switch>;
}
function App() {
  const [role, setRole, clearRole] = useStoredState<UserRole>(STORAGE_ROLE,'Creator');
  const [demo, setDemo, clearDemo] = useStoredState<boolean>(STORAGE_DEMO,false);
  const [kit, setKit, clearKit] = useStoredState<BrandKit>(STORAGE_KIT,DEFAULT_KIT);
  const [session, setSession] = useState<ReviewSession>(emptySession);
  const [activity, setActivity] = useState<string[]>([]);
  const [apiState, setApiState] = useState<AppContextValue['apiState']>('unknown');
  const [sessionVersion, setSessionVersion] = useState(0);
  const wrappedSetSession = (next: ReviewSession) => {
    setSession(next);
    if (next.analysisStatus === 'loading') return;
    if (next.analysisStatus === 'success' || next.analysisStatus === 'not-configured') setApiState('connected');
    else if (next.analysisStatus === 'error') {
      const states: Record<AnalyzeErrorKind, AppContextValue['apiState']> = { network: 'offline', server: 'error', 'invalid-json': 'invalid-response', timeout: 'timeout' };
      setApiState(next.errorKind ? states[next.errorKind] : 'error');
    }
  };
  const addActivity = (message: string) => setActivity((current) => [...current, message]);
  const resetLocalData = () => {
    clearKit({ guidelines:[], facts:[], terminology:[], assets:[] });
    clearRole('Creator');
    clearDemo(false);
    setSession(emptySession);
    setActivity([]);
    setApiState('unknown');
    setSessionVersion((version) => version + 1);
  };
  const value: AppContextValue = { role, setRole, demo, setDemo, kit, setKit, session, setSession: wrappedSetSession, activity, addActivity, apiState, resetLocalData, sessionVersion };
  return <AppContext.Provider value={value}><Router/></AppContext.Provider>;
}

export default App;
