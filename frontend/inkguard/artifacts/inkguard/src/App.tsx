import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { AlertCircle, ArrowDownUp, ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Check, CheckCheck, ChevronDown, Copy, FileCheck2, FileText, Info, Lightbulb, LoaderCircle, Menu, Pencil, Plus, RotateCcw, Save, Search, Send, Settings, Shield, ShieldCheck, Sparkles, Trash2, Undo2, Upload, X, BarChart3, Users, MessageSquare, type LucideIcon } from 'lucide-react';
import { addComment, createReview, createTeamUser, getBrandKit, getComments, getCurrentUser, getInsights, getReview, getReviewHistory, listReviews, listTeamUsers, loginAccount, registerAccount, saveBrandKit, saveDecision, setApiToken, setReviewStatus, API_BASE_URL, type AuthUser, type ReviewComment, type ReviewInsights, type ReviewListItem } from './api/client';
import { faqItems } from './chatbot/faq';
import { emptySession, sampleDraft, sampleFacts, sampleFindings, sampleGuidelines } from './data/sample';
import { runLocalChecks } from './lib/local-review';
import Mascot from './components/Mascot';
import WorkspaceContent from './layouts/WorkspaceContent';
import NotFound from './pages/NotFound';
import { ApiError, type AnalyzeErrorKind, type BrandKit, type Finding, type LocalDecision, type PersistedDecisionAction, type ReviewFinding, type ReviewHistoryItem, type ReviewSession, type Severity } from './types';
import './index.css';

const STORAGE_KIT = 'inkguard-brand-kit';
const STORAGE_DEMO = 'inkguard-demo';
const STORAGE_REVIEW_ID = 'inkguard-active-review-id';
const DEFAULT_KIT: BrandKit = { guidelines: [...sampleGuidelines], facts: [...sampleFacts], terminology: [{ preferred: 'members', avoided: 'users' }], assets: ['Northstar primary logo', 'Editorial voice reference'] };

function readStorage<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function storeActiveReviewId(id: number): void {
  try { localStorage.setItem(STORAGE_REVIEW_ID, String(id)); } catch { /* Browser storage may be unavailable. */ }
}
function clearActiveReviewId(): void {
  try { localStorage.removeItem(STORAGE_REVIEW_ID); } catch { /* Browser storage may be unavailable. */ }
}
function readActiveReviewId(): number | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_REVIEW_ID);
    if (!raw) return undefined;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
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
  demo: boolean; setDemo: (value: boolean) => void;
  kit: BrandKit; setKit: (kit: BrandKit) => void;
  session: ReviewSession; setSession: (session: ReviewSession) => void;
  apiState: 'unknown' | 'connected' | 'offline' | 'error' | 'invalid-response' | 'timeout';
  resetLocalData: () => void;
  sessionVersion: number;
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  signOut: () => void;
};
const AppContext = createContext<AppContextValue | null>(null);
function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('App context is missing');
  return value;
}

const navGroups: { label: string; links: { href: string; text: string; icon: LucideIcon }[] }[] = [
  { label: 'WORKSPACE', links: [{ href: '/app/review', text: 'Review draft', icon: FileCheck2 }] },
  { label: 'ACTIVITY', links: [{ href: '/app/reviews', text: 'Review history', icon: FileText }] },
  { label: 'BRAND', links: [{ href: '/app/brand-kit', text: 'Brand kit', icon: BookOpen }] },
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
    if (query.includes('local check') || query.includes('offline')) return faqItems[8].answer;
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
        clearActiveReviewId();
        setSession({ ...session, reviewId: undefined, analysisStatus: 'loading', findings: [], decisions: {}, errorKind: undefined, errorStatus: undefined });
        try {
          const response = await createReview({ brand_name: session.brand, content: session.content, brand_guidelines: session.guidelines, approved_facts: session.facts });
          if (response.status === 'analysis_not_configured' || response.draft_id === null) {
            clearActiveReviewId();
            setSession({ ...session, reviewId: undefined, analysisStatus: 'not-configured', findings: [], decisions: {}, message: response.message ?? undefined });
          } else {
            storeActiveReviewId(response.draft_id);
            setSession({ ...session, reviewId: response.draft_id, analysisStatus: 'success', findings: normalizeFindings(response.findings), decisions: {}, message: response.message ?? undefined });
          }
          setMessages((currentMessages) => [...currentMessages, { role: 'inky', text: response.status === 'analysis_not_configured' ? response.message || faqItems[3].answer : 'The analysis request finished. Open Review to inspect the returned findings.' }]);
        } catch (error) {
          const issue = error instanceof ApiError ? error : new ApiError('server', 'The review request failed unexpectedly.');
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
  const { demo, setDemo, apiState, session, user, signOut } = useApp();
  const extraLinks = user?.role === 'admin' || user?.role === 'reviewer'
    ? [{ href: '/app/insights', text: 'Insights', icon: BarChart3 }]
    : [];
  const adminLinks = user?.role === 'admin'
    ? [{ href: '/app/team', text: 'Team', icon: Users }]
    : [];
  const availableLinks = [...navGroups.flatMap((group) => group.links), ...extraLinks, ...adminLinks];
  const title = availableLinks.find((link) => link.href === location)?.text ?? 'Workspace';
  const links = (mobile = false) => <div className="nav-scroll">
    {navGroups.map((group) => <div key={group.label} className="nav-group"><div className="nav-group-label">{group.label}</div>{group.links.map(({ href, text, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} onClick={() => mobile && setDrawer(false)}><Icon size={17} strokeWidth={1.8} /><span>{text}</span></Link>)}</div>)}
    {(extraLinks.length > 0 || adminLinks.length > 0) && <div className="nav-group"><div className="nav-group-label">GOVERNANCE</div>{[...extraLinks, ...adminLinks].map(({ href, text, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} onClick={() => mobile && setDrawer(false)}><Icon size={17} strokeWidth={1.8} /><span>{text}</span></Link>)}</div>}
    <div className="nav-group"><div className="nav-group-label">PREFERENCES</div><Link href="/app/settings" className={`nav-link ${location === '/app/settings' ? 'active' : ''}`}><Settings size={17} strokeWidth={1.8} /><span>Settings</span></Link></div>
    {mobile && <Link className="nav-link" href="/" onClick={() => setDrawer(false)}><ArrowLeft size={17} />Back to home</Link>}
  </div>;
  const sidebar = <aside className={`sidebar ${drawer ? 'drawer' : 'desktop'}`} aria-label="Main navigation">
    <Link href="/app/review" className="brand-mark"><span className="logo-drop"><Mascot /></span><span>InkGuard</span></Link>
    <div className="workspace-select"><div className="workspace-icon">{user?.full_name.slice(0, 1).toUpperCase()}</div><div className="min-w-0"><strong>{user?.full_name}</strong><span>{user?.role} · shared workspace</span></div></div>
    {links(drawer)}
    <div className="sidebar-bottom">
      <div className={`connection-status ${apiState}`}><span className="status-dot" /><span>{apiState === 'unknown' ? 'Backend not checked' : apiState === 'connected' ? 'Backend responded' : apiState === 'offline' ? 'Backend unreachable' : apiState === 'invalid-response' ? 'Backend response unreadable' : apiState === 'timeout' ? 'Analysis timed out' : 'Backend returned an error'}</span></div>
      <div className="sidebar-note">Draft analysis uses your configured InkGuard backend.</div>
      <button className="nav-link" onClick={signOut}><ArrowLeft size={15} />Sign out</button>
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
          <Link className="icon-btn" href="/app/settings" aria-label="Settings"><Settings size={18} /></Link>
        </div>
      </header>
      <div className="workspace-disclosure" data-testid="text-workspace-privacy-disclosure"><Shield size={14} /><span>Rule-based review is the default. External AI is optional and only used when enabled by the server operator.</span></div>
      <WorkspaceContent>{children}</WorkspaceContent>
    </main>
    <Inky status={session.analysisStatus} />
  </div>;
}

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}
function PrivacyNotice() { return <div className="privacy-notice" data-testid="text-privacy-disclosure"><Shield size={16} /><span>Rule-based review is the default. The server operator may enable external AI; check the deployment configuration before submitting confidential material.</span></div>; }
function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`btn ${className}`} {...props}>{children}</button>; }

function Landing() {
  const [, setLocation] = useLocation();
  const { setDemo } = useApp();
  const trySample = () => { setDemo(true); setLocation('/app/review'); };
  return <div className="landing">
    <header className="landing-nav"><Link href="/" className="brand-mark"><span className="landing-logo"><Mascot /></span><span>InkGuard</span></Link><nav><a href="#how">How it works</a><a href="#features">Features</a><a href="#trust">Trust & privacy</a><Link href="/app/brand-kit">Brand kit</Link></nav><div className="landing-nav-cta"><Link href="/app/review" className="btn btn-quiet">Open workspace</Link><button className="btn btn-primary" onClick={trySample}>Try a sample draft <ArrowRight size={16} /></button></div></header>
    <section className="hero"><div className="hero-copy"><div className="hero-tag"><ShieldCheck size={15} /> A thoughtful final check for your words</div><h1>Clear copy.<br /><span>Confident publishing.</span></h1><p>Check every draft against your brand rules and approved facts, then make the final call yourself.</p><div className="hero-actions"><Link className="btn btn-primary btn-large" href="/app/review">Open workspace <ArrowRight size={16} /></Link><button className="btn btn-large" onClick={trySample}>Try a sample draft</button></div><div className="hero-footnote"><span className="small muted">Built for people, not autopilot.</span><span className="hero-dot" /> <span className="small muted">You stay in control of every decision.</span></div></div>
      <div className="hero-proof card"><div className="proof-top"><div><span className="small muted">NORTHSTAR STUDIO</span><h2>Draft review</h2></div><span className="pill"><span className="tiny-dot" />4 review points</span></div><div className="proof-body"><div className="proof-doc"><p>Northstar is <mark className="sample-highlight high">the only publishing platform you will ever need</mark>.</p><p>Our <mark className="sample-highlight medium">automatic editorial tools</mark> make every story perfect in seconds.</p><p>Join <mark className="sample-highlight critical">50,000 users</mark> who trust us to grow their audience.</p></div><div className="proof-findings"><div className="proof-finding"><span className="severity-chip critical"><AlertCircle size={13} /> Critical</span><b>Unverified audience figure</b><span className="small muted">Compare claims with approved facts.</span></div><div className="proof-finding"><span className="severity-chip high"><AlertCircle size={13} /> High</span><b>Absolute promise</b><span className="small muted">Ground the product claim.</span></div><div className="proof-footer"><span>Review suggestions</span><span className="mono">01 / 04</span></div></div></div><div className="proof-caption"><span><span className="legend-dot critical" />Critical</span><span><span className="legend-dot high" />High</span><span><span className="legend-dot medium" />Medium</span><span>Human decision required</span></div></div>
      <div className="hero-aside">BRAND REVIEW<br />BEFORE YOU PUBLISH <span>— 01 / 04</span></div>
    </section>
    <section className="how-section" id="how"><div className="section-intro"><span className="section-kicker">A clear path from draft to decision</span><h2>Four steps. Your call at every one.</h2><p>InkGuard helps make brand review a repeatable part of publishing—not a black box.</p></div><div className="steps">{[['01','Bring your draft','Choose a brand, then add the copy you are preparing to publish.'],['02','Set the context','Include the guidelines and approved facts that matter for this draft.'],['03','Review the signals','Read each finding in context. Check the evidence, rule, and proposed wording.'],['04','Decide together','Accept, edit, or reject suggestions. Keep people in the publishing loop.']].map(([number,title,body]) => <article className="step" key={number}><span className="step-number">{number}</span><div><h3>{title}</h3><p>{body}</p></div><ArrowRight size={17} /></article>)}</div></section>
    <section className="features-section" id="features"><div className="section-intro"><span className="section-kicker">Made for careful publishing</span><h2>Guardrails that explain themselves.</h2><p>Specific context, clear evidence, and decisions your team can own.</p></div><div className="feature-grid">{[
      [ShieldCheck,'Your rules, in context','Review against the guidelines and facts you actually supplied.'],
      [FileText,'Evidence beside the draft','See the exact wording behind each review point.'],
      [Lightbulb,'Suggestions, not commands','Consider practical edits without giving up editorial control.'],
      [BookOpen,'A reusable Brand Kit','Keep guidelines and approved facts close to every review.'],
      [CheckCheck,'Decisions you can trace','Finding decisions are recorded with the saved review.'],
      [LockIcon,'Privacy stated plainly','Know when text is sent and what is stored locally.'],
    ].map(([Icon,title,body]) => { const FeatureIcon = Icon as LucideIcon; return <article className="feature-card" key={title as string}><div className="feature-icon"><FeatureIcon size={19} /></div><h3>{title as string}</h3><p>{body as string}</p></article>; })}</div></section>
    <section className="trust-section" id="trust"><div className="trust-copy"><div className="trust-icon"><Shield size={22} /></div><h2>Trust starts with a clear boundary.</h2><p>InkGuard helps authors compare their words with the brand context they provide. A person reviews the evidence and chooses what happens next.</p><p className="trust-strong">Rule-based review is the default. The server operator may enable external AI; check the privacy settings before submitting confidential material.</p><Link href="/app/settings" className="text-link">See privacy and environment settings <ArrowRight size={15} /></Link></div><div className="trust-list"><div><span>01</span><p><strong>No silent edits</strong><br />Suggestions never change a draft on their own.</p></div><div><span>02</span><p><strong>No invented certainty</strong><br />A signal is a prompt to review, not a final verdict.</p></div><div><span>03</span><p><strong>Workspace controls</strong><br />Reviews, decisions, and Brand Kit items are stored by the backend.</p></div></div></section>
    <section className="closing-cta"><div><h2>Make the last read a better read.</h2><p>Bring your brand context into the review—then publish with a human decision.</p></div><Link href="/app/review" className="btn btn-primary btn-large">Start a review <ArrowRight size={16} /></Link></section>
    <footer className="landing-footer"><Link href="/" className="brand-mark"><span className="mini-logo"><Mascot /></span>InkGuard</Link><span>Brand review before you publish.</span><div><Link href="/app/brand-kit">Brand Kit</Link><Link href="/app/settings">Privacy & settings</Link><span>© InkGuard</span></div></footer>
    <Inky />
  </div>;
}
function LockIcon({ size = 19 }: { size?: number }) { return <ShieldCheck size={size} />; }

function severityOf(finding: Finding): Severity { return finding.severity && ['low','medium','high','critical'].includes(finding.severity) ? finding.severity : 'medium'; }
function findingId(finding: Finding, index: number): string { return finding.id ? String(finding.id) : `finding-${index}`; }
function normalizeFindings(items: Array<Finding | ReviewFinding>): Finding[] {
  return items.filter((item) => item && typeof item === 'object' && typeof item.issue === 'string').map((item) => {
    const severity = ['low','medium','high','critical'].includes(String(item.severity)) ? item.severity : undefined;
    const safeString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
    return {
      issue: item.issue,
      id: typeof item.id === 'number' && Number.isSafeInteger(item.id) ? String(item.id) : safeString(item.id),
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
function decisionsFromHistory(findings: ReviewFinding[], history: ReviewHistoryItem[]): Record<string, LocalDecision> {
  const decisions: Record<string, LocalDecision> = {};
  for (const finding of findings) {
    const entries = history
      .filter((entry) => entry.finding_id === finding.id)
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
    const latest = entries.at(-1);
    if (latest?.action === 'request_revision') continue;
    const action = latest?.action ?? (finding.status === 'accepted' ? 'accept' : finding.status === 'edited' ? 'edit' : finding.status === 'rejected' ? 'reject' : undefined);
    if (!action) continue;
    const decision: LocalDecision['decision'] = action === 'accept'
      ? 'accepted'
      : action === 'edit' ? 'edited' : 'rejected';
    decisions[String(finding.id)] = {
      findingId: String(finding.id),
      decision,
      replacement: latest?.edited_text ?? undefined,
      reason: latest?.reason ?? undefined,
      at: latest?.created_at ?? new Date().toISOString(),
    };
  }
  return decisions;
}
function ReviewPage() {
  const { session, setSession, kit, demo, setDemo, user } = useApp();
  const [restoreError, setRestoreError] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
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
  const [decisionError, setDecisionError] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const decisionRequestPending = useRef(false);
  const [flashTarget, setFlashTarget] = useState('');
  const [reviewFile, setReviewFile] = useState<File>();
  const [altText, setAltText] = useState('');
  useEffect(() => {
    if (demo) return;
    const storedId = readActiveReviewId();
    if (!storedId || (session.reviewId === storedId && session.analysisStatus === 'success')) return;
    let active = true;
    setRestoreLoading(true);
    setRestoreError('');
    void Promise.all([getReview(storedId), getReviewHistory(storedId)])
      .then(([review, history]) => {
        if (!active) return;
        storeActiveReviewId(review.id);
        setSession({
          brand: review.brand_name,
          content: review.content,
          reviewId: review.id,
          guidelines: review.brand_guidelines,
          facts: review.approved_facts,
          findings: normalizeFindings(review.findings),
          decisions: decisionsFromHistory(review.findings, history),
          analysisStatus: 'success',
          message: `Restored saved review #${review.id}.`,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof ApiError ? error.message : 'The saved review could not be restored.';
        setRestoreError(message);
      })
      .finally(() => {
        if (active) setRestoreLoading(false);
      });
    return () => { active = false; };
  }, [demo, session.analysisStatus, session.reviewId, setSession]);
  const counts = useMemo(() => session.findings.reduce((acc, finding) => { acc[severityOf(finding)] += 1; return acc; }, { critical: 0, high: 0, medium: 0, low: 0 }), [session.findings]);
  const orderedFindings = useMemo(() => {
    const list = session.findings.map((finding, index) => ({ finding, index, id: findingId(finding, index) })).filter(({ finding }) => filter === 'all' || severityOf(finding) === filter);
    if (sort === 'severity') list.sort((a,b) => ['critical','high','medium','low'].indexOf(severityOf(a.finding)) - ['critical','high','medium','low'].indexOf(severityOf(b.finding)));
    return list;
  }, [session.findings, filter, sort]);
  const pending = session.findings.filter((finding, index) => !session.decisions[findingId(finding,index)]).length;
  const analyzed = session.analysisStatus === 'success' || session.analysisStatus === 'demo' || session.analysisStatus === 'local';
  const update = (patch: Partial<ReviewSession>) => setSession({ ...session, ...patch });
  const parsePasted = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasValidReviewContext = () => {
    if (!session.brand.trim() || (!session.content.trim() && !reviewFile)) { setFormError('Add a brand name and draft text or a supported file before reviewing.'); return false; }
    if (session.content.trim().length > 0 && session.content.trim().length < 20 && !reviewFile) { setFormError('Add a little more draft context before reviewing (at least 20 characters).'); return false; }
    if (!session.guidelines.length && !session.facts.length) { setFormError('Add at least one guideline or approved fact so the review has context.'); return false; }
    return true;
  };
  const addList = (type: 'guidelines' | 'facts', value: string) => {
    const values = parsePasted(value);
    if (!values.length) return;
    update({ [type]: [...session[type], ...values] });
    if (type === 'guidelines') setGuidelineInput(''); else setFactInput('');
  };
  const loadSample = () => { clearActiveReviewId(); setReviewFile(undefined); setAltText(''); setDemo(true); setFormError(''); setDecisionError(''); setSession({ brand: 'Northstar Studio', content: sampleDraft, guidelines: [...sampleGuidelines], facts: [...sampleFacts], findings: [], decisions: {}, analysisStatus: 'idle' }); };
  const clearForm = () => { clearActiveReviewId(); setReviewFile(undefined); setAltText(''); setSession({ ...emptySession, guidelines: [...session.guidelines], facts: [...session.facts] }); setFormError(''); setDecisionError(''); setActiveId(''); };
  const runLocalReview = () => {
    if (reviewFile) { setFormError('Browser-only local checks support pasted text only.'); return; }
    if (!hasValidReviewContext()) return;
    clearActiveReviewId();
    setFormError('');
    setDecisionError('');
    setActiveId('');
    setSession({
      ...session,
      reviewId: undefined,
      analysisStatus: 'local',
      findings: runLocalChecks(session.content, session.guidelines, session.facts),
      decisions: {},
      message: 'Limited rules-based checks ran in this browser. No draft was sent to the backend.',
      errorKind: undefined,
      errorStatus: undefined,
    });
  };
  const submit = async () => {
    if (!hasValidReviewContext()) return;
    clearActiveReviewId();
    setFormError(''); setDecisionError(''); update({ reviewId: undefined, analysisStatus: 'loading', findings: [], decisions: {}, message: undefined, errorKind: undefined, errorStatus: undefined });
    if (demo) {
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      setSession({ ...session, reviewId: undefined, analysisStatus: 'demo', findings: sampleFindings, decisions: {}, message: 'Sample review data. No draft was sent to the backend.' });
      return;
    }
    try {
      const response = await createReview({ brand_name: session.brand, content: session.content, brand_guidelines: session.guidelines, approved_facts: session.facts }, reviewFile, altText);
      if (response.status === 'analysis_not_configured' || response.draft_id === null) {
        clearActiveReviewId();
        setSession({ ...session, reviewId: undefined, analysisStatus: 'not-configured', findings: [], decisions: {}, message: response.message || 'The selected review mode is not configured.', errorKind: undefined, errorStatus: undefined });
      } else {
        storeActiveReviewId(response.draft_id);
        setSession({ ...session, content: response.content ?? session.content, reviewId: response.draft_id, analysisStatus: 'success', findings: normalizeFindings(response.findings), message: response.message ?? undefined, errorKind: undefined, errorStatus: undefined });
      }
    } catch (error) {
      const issue = error instanceof ApiError ? error : new ApiError('server', 'The review request failed unexpectedly.');
      setSession({ ...session, reviewId: undefined, analysisStatus: 'error', findings: [], message: issue.message, errorKind: issue.kind, errorStatus: issue.status });
    }
  };
  const decideLocally = (id: string, decision: LocalDecision['decision'], replacement?: string, reason?: string) => {
    const decisions = { ...session.decisions };
    if ((decision === 'accepted' || decision === 'edited') && replacement) decisions[id] = { findingId: id, decision, replacement, at: new Date().toISOString() };
    else decisions[id] = { findingId: id, decision, reason, at: new Date().toISOString() };
    update({ decisions });
  };
  const persistDecision = async (id: string, action: PersistedDecisionAction, replacement?: string, reason?: string): Promise<boolean> => {
    if (decisionRequestPending.current) return false;
    if (demo || session.analysisStatus === 'local') {
      if (action === 'request_revision') {
        const decisions = { ...session.decisions };
        delete decisions[id];
        update({ decisions });
        return true;
      }
      decideLocally(id, action === 'accept' ? 'accepted' : action === 'edit' ? 'edited' : 'rejected', replacement, reason);
      return true;
    }
    const finding = session.findings.find((item, index) => findingId(item, index) === id);
    const numericFindingId = Number(id);
    if (!session.reviewId || !finding || !Number.isSafeInteger(numericFindingId) || numericFindingId <= 0) {
      setDecisionError('This finding is not linked to a saved review. Run the review again before saving a decision.');
      return false;
    }
    setDecisionError('');
    decisionRequestPending.current = true;
    setSavingIds((current) => new Set(current).add(id));
    try {
      await saveDecision(numericFindingId, {
        action,
        ...(replacement ? { edited_text: replacement } : {}),
        ...(reason ? { reason } : {}),
      });
      if (action === 'request_revision') {
        const decisions = { ...session.decisions };
        delete decisions[id];
        update({ decisions });
      } else {
        decideLocally(id, action === 'accept' ? 'accepted' : action === 'edit' ? 'edited' : 'rejected', replacement, reason);
      }
      return true;
    } catch (error) {
      setDecisionError(error instanceof ApiError ? error.message : 'Could not save this decision.');
      return false;
    } finally {
      decisionRequestPending.current = false;
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  const accept = (finding: Finding, id: string) => void persistDecision(id, 'accept', finding.suggested_correction || undefined);
  const revert = (id: string) => void persistDecision(id, 'request_revision');
  const startEdit = (finding: Finding, id: string) => { setEditId(id); setEditText(session.decisions[id]?.replacement || finding.suggested_correction || ''); };
  const saveEdit = async (id: string) => { if (!editText.trim()) return; if (await persistDecision(id, 'edit', editText.trim())) setEditId(''); };
  const reject = (id: string) => { const reason = window.prompt('Optional reason for rejecting this suggestion:') ?? ''; void persistDecision(id, 'reject', undefined, reason.trim() || undefined); };
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
      if (!activeId || user?.role === 'creator' || !(session.analysisStatus === 'success' || session.analysisStatus === 'demo' || session.analysisStatus === 'local')) return;
      if (['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement).tagName)) return;
      const selected = session.findings.find((finding,index) => findingId(finding,index) === activeId);
      if (!selected) return;
      if (event.key.toLowerCase() === 'a') accept(selected, activeId);
      if (event.key.toLowerCase() === 'e') startEdit(selected, activeId);
      if (event.key.toLowerCase() === 'r') reject(activeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, session, user?.role]);
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
  return <div className="review-page">
    <PageHeader title="Review a draft" subtitle="Check a draft against the brand context before it goes out." action={<span className="pill"><ShieldCheck size={14} /> Human review required</span>} />
    <div className="review-toolbar"><div><span className="step-label">DRAFT CHECK</span><span className="muted"> — Context first, then a careful read.</span></div><div className="toolbar-actions"><Button className="btn-quiet" onClick={loadSample}><Sparkles size={15} />Load sample</Button><Button className="btn-quiet" onClick={clearForm}><RotateCcw size={15} />Clear form</Button></div></div>
    <PrivacyNotice />
    {restoreLoading && <div className="info-box" role="status"><LoaderCircle size={17} className="spin" /><div><strong>Restoring saved review…</strong><p>Loading the latest saved review and its decision history.</p></div></div>}
    {restoreError && <div className="error-box" role="alert"><AlertCircle size={17} /><div><strong>Saved review could not be restored</strong><p className="small">{restoreError}</p><p className="small muted">Check the backend connection, then reload the page to retry.</p></div></div>}
    {(session.analysisStatus === 'idle' || session.analysisStatus === 'loading' || session.analysisStatus === 'error' || session.analysisStatus === 'not-configured') && <section className="card form-card">
      <div className="form-card-heading"><div><h2>Review context</h2><p>Give the review the right brand details. Pasted lines are added separately.</p></div><span className="pill">Required fields marked *</span></div>
      <div className="form-grid">
        <div className="form-left">
          <label className="label" htmlFor="brand-name">Brand name <span className="required">*</span></label><input id="brand-name" className="field" value={session.brand} onChange={(e) => update({ brand: e.target.value })} placeholder="For example, Northstar Studio" disabled={session.analysisStatus === 'loading'} data-testid="input-brand-name" />
          <div className="field-heading"><label className="label" htmlFor="draft-content">Draft content</label><span className="small muted">{session.content.trim() ? session.content.trim().split(/\s+/).filter(Boolean).length : 0} words · {session.content.length.toLocaleString()} characters</span></div>
          <textarea id="draft-content" className="field draft-input" value={session.content} onChange={(e) => update({ content: e.target.value })} placeholder="Paste the copy you want to review…" disabled={session.analysisStatus === 'loading'} data-testid="input-draft-content" />
          <div className="field-help">Keep the original wording intact so findings can link back to the draft.</div>
          <label className="label" htmlFor="review-file">Or upload a file (PDF, DOCX, TXT, Markdown, PNG, JPEG; max 10 MB)</label>
          <input id="review-file" className="field" type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" disabled={session.analysisStatus==='loading'} onChange={(event)=>setReviewFile(event.target.files?.[0])}/>
          {reviewFile && <div className="selected-file"><FileText size={15}/><span>{reviewFile.name}</span><button type="button" className="icon-btn" aria-label="Remove uploaded file" onClick={()=>setReviewFile(undefined)}><X size={14}/></button></div>}
          {reviewFile?.type.startsWith('image/') && <><label className="label" htmlFor="image-alt">Image alt text (optional)</label><input id="image-alt" className="field" value={altText} onChange={(event)=>setAltText(event.target.value)} placeholder="Describe the information or purpose conveyed by the image"/></>}
        </div>
        <div className="form-context">
          <ListEditor title="Brand guidelines" subtitle="Tone, terminology, and claims" values={session.guidelines} placeholder="Add a guideline…" input={guidelineInput} setInput={setGuidelineInput} add={(value) => addList('guidelines',value)} remove={(index) => update({ guidelines: session.guidelines.filter((_,i)=>i!==index) })} disabled={session.analysisStatus === 'loading'} />
          <ListEditor title="Approved facts" subtitle="Facts this draft may rely on" values={session.facts} placeholder="Add an approved fact…" input={factInput} setInput={setFactInput} add={(value) => addList('facts',value)} remove={(index) => update({ facts: session.facts.filter((_,i)=>i!==index) })} disabled={session.analysisStatus === 'loading'} />
        </div>
      </div>
      {(session.guidelines.length === 0 || session.facts.length === 0) && <div className="context-warning"><Info size={15} /><span>{session.guidelines.length === 0 && session.facts.length === 0 ? 'Add at least one guideline or approved fact to give the review useful context.' : session.guidelines.length === 0 ? 'No guidelines added. Brand voice and terminology checks may be limited.' : 'No approved facts added. The review may have less context for fact checking.'}</span></div>}
      {formError && <div className="field-error" role="alert"><AlertCircle size={15} />{formError}</div>}
      {session.analysisStatus === 'loading' && <div className="loading-panel"><div className="skeleton loading-line" /><div className="skeleton loading-line short" /><div><strong>Reviewing your draft…</strong><p className="small muted">The form is locked while the backend responds.</p></div></div>}
      {session.analysisStatus === 'not-configured' && <div className="info-box" role="status"><Info size={18} /><div><strong>Optional AI mode is not configured</strong><p>{session.message || 'Configure the selected external AI provider on the server, or use the default rules-only mode.'} This response is not a clean review.</p></div><Button onClick={submit}>Retry review</Button></div>}
      {session.analysisStatus === 'error' && <div className="error-box" role="alert"><div className="flex items-start gap-3"><AlertCircle size={19} /><div className="flex-1"><strong>{session.errorKind === 'server' ? `The analysis service returned HTTP ${session.errorStatus ?? 'error'}` : session.errorKind === 'invalid-json' ? 'The analysis service response could not be read' : session.errorKind === 'timeout' ? 'The analysis request timed out' : 'The analysis service could not be reached'}</strong><p className="small">{session.message}</p><p className="small muted">{session.errorKind === 'server' ? 'The service responded with an error status. Check its logs and try again.' : session.errorKind === 'invalid-json' ? 'The service responded, but did not return valid analysis JSON.' : session.errorKind === 'timeout' ? 'The service did not finish within 60 seconds. You can retry the request.' : 'Check that the API is running and allows this browser origin through CORS.'}</p></div><Button onClick={submit}><RotateCcw size={15} />Retry</Button></div></div>}
      <div className="form-footer"><span className="small muted"><Shield size={14} /> Saved reviews are processed by the InkGuard backend. External AI is disabled by default; uploaded binaries are not retained.</span><div className="toolbar-actions"><Button onClick={runLocalReview} disabled={session.analysisStatus === 'loading' || Boolean(reviewFile)}><Search size={15} />Run browser-only checks</Button><Button className="btn-primary btn-review" onClick={submit} disabled={session.analysisStatus === 'loading'}>{session.analysisStatus === 'loading' ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}Run review</Button></div></div>
    </section>}
    {analyzed && <section className="results-section">
      <div className={`analysis-banner ${session.analysisStatus !== 'success' ? 'sample-banner' : ''}`} role="status"><div className="analysis-banner-icon">{session.analysisStatus === 'success' ? <BadgeCheck size={19} /> : <Sparkles size={19} />}</div><div><strong>{session.analysisStatus === 'demo' ? 'Sample review — no draft sent' : session.analysisStatus === 'local' ? 'Local checks — limited rules-based review' : 'Analysis complete'}</strong><span>{session.analysisStatus === 'demo' ? 'Explore the review workflow using clearly labeled sample findings.' : session.analysisStatus === 'local' ? session.message : session.message || 'Review the findings and make each decision yourself.'}</span></div><span className="pill">{session.findings.length} {session.findings.length === 1 ? 'finding' : 'findings'}</span></div>
      {session.analysisStatus === 'demo' && <div className="sample-strip"><Info size={15} />Sample data only. These findings are illustrative and are not backend analysis.</div>}
      {session.analysisStatus === 'local' && <div className="sample-strip"><Info size={15} />Runs only simple phrase, terminology, and number checks in this browser. These checks are not AI and may miss issues or flag harmless wording.</div>}
      {session.findings.length === 0 ? <div className="card calm-empty"><div className="empty-icon"><CheckCheck size={22} /></div><h2>No issues found, human review still recommended</h2><p>{session.analysisStatus === 'local' ? 'These limited local checks found no matches. They cannot verify that the draft is correct; keep your editorial review in place.' : session.analysisStatus === 'demo' ? 'The sample review has no findings to show. This does not guarantee the copy is correct; keep your editorial review in place.' : 'The analysis service returned no findings for this draft. This does not guarantee the copy is correct; keep your editorial review in place.'}</p><Button onClick={() => { clearActiveReviewId(); update({ reviewId: undefined, analysisStatus: 'idle' }); }}>Review another draft</Button></div> : <>
        <div className="result-summary card"><div className="result-counts">{(['critical','high','medium','low'] as Severity[]).map((severity) => <button className={`count-item ${filter === severity ? 'selected' : ''}`} key={severity} onClick={() => setFilter(filter === severity ? 'all' : severity)}><span className={`severity-dot ${severity}`} /><span className={`severity-name severity-${severity}`}>{severity[0].toUpperCase()+severity.slice(1)}</span><b>{counts[severity]}</b></button>)}</div><div className="progress-wrap"><div className="progress-text"><span>Reviewed</span><strong>{session.findings.length - pending} of {session.findings.length}</strong></div><div className="progress-track"><div style={{ width: `${session.findings.length ? (session.findings.length-pending)/session.findings.length*100 : 0}%` }} /></div></div></div>
        <div className="results-grid">
          <section className="card draft-result"><div className="section-card-heading"><div><h2>Draft with findings</h2><span className="small muted">Select a highlight to inspect its finding</span></div><button className="icon-btn" aria-label="Copy draft" onClick={() => { void copyDraft(); }}><Copy size={16} /></button></div>
            <div className="draft-review-text">{showDiff ? <DiffView original={session.content} revised={revisedDraft} /> : markedDraft()}</div>
            <div className="draft-actions"><div><Button className={showDiff ? 'btn-primary' : ''} onClick={() => setShowDiff((value) => !value)}><FileText size={15} />{showDiff ? 'Show marked draft' : 'Compare revised draft'}</Button><Button onClick={() => { void copyDraft(); }}><Copy size={15} />{copied ? 'Copied' : 'Copy revised draft'}</Button></div><span className="small muted">{Object.values(session.decisions).filter((d) => d.decision !== 'rejected').length} suggested edit(s) applied</span></div>
          </section>
          <section className="findings-column"><div className="findings-head"><div><h2>Review findings</h2><span className="small muted">{filter === 'all' ? 'All findings' : `${filter[0].toUpperCase()+filter.slice(1)} findings`} · choose a decision</span></div><button className="sort-button" onClick={() => setSort(sort === 'severity' ? 'position' : 'severity')}><ArrowDownUp size={14} />{sort === 'severity' ? 'Severity' : 'Draft order'}</button></div>
            {orderedFindings.length === 0 ? <div className="card no-results">No findings match this filter. <button onClick={() => setFilter('all')}>Show all</button></div> : orderedFindings.map(({ finding,index,id }) => <FindingCard key={id} finding={finding} index={index} id={id} selected={activeId===id} flash={flashTarget===`finding-${id}`} decision={session.decisions[id]} saving={savingIds.has(id)} busy={savingIds.size > 0} editing={editId===id} allowDecision={user?.role !== 'creator'} editText={editText} setEditText={setEditText} onSelect={() => jumpToFinding(id,'mark')} onAccept={() => accept(finding,id)} onEdit={() => startEdit(finding,id)} onSave={() => saveEdit(id)} onCancel={() => setEditId('')} onReject={() => reject(id)} onUndo={() => revert(id)} />)}
          </section>
        </div>
        <div className="refresh-loss-notice"><Info size={15} /><span>{session.analysisStatus === 'demo' ? 'Sample decisions stay in this browser session only.' : session.analysisStatus === 'local' ? 'Local-check decisions stay in this browser session and are not sent to the backend.' : session.reviewId ? `Saved review #${session.reviewId}. Finding decisions are recorded by the backend.` : 'This review is not linked to a saved backend review yet.'}</span></div>
        {decisionError && <div className="error-box" role="alert"><AlertCircle size={17} /><div><strong>Decision was not saved</strong><p className="small">{decisionError}</p></div><button className="icon-btn" aria-label="Dismiss decision error" onClick={() => setDecisionError('')}><X size={15} /></button></div>}
        <div className="decision-footer card"><div><strong>{pending === 0 ? 'Every finding has a decision' : `${pending} ${pending === 1 ? 'finding needs' : 'findings need'} a decision`}</strong><span className="small muted">{session.analysisStatus === 'demo' ? 'Sample decisions stay local.' : session.analysisStatus === 'local' ? 'Local-check decisions are not saved to the backend.' : session.reviewId ? 'Finding decisions are saved to this review.' : 'Finding decisions need a saved backend review.'}</span></div></div>
      </>}
      {session.reviewId && <ReviewCollaboration reviewId={session.reviewId} allowStatus={user?.role === 'admin' || user?.role === 'reviewer'} />}
    </section>}
  </div>;
}

function ListEditor({ title, subtitle, values, placeholder, input, setInput, add, remove, disabled = false }: { title: string; subtitle: string; values: string[]; placeholder: string; input: string; setInput: (value: string) => void; add: (value: string) => void; remove: (index: number) => void; disabled?: boolean }) {
  return <div className="list-editor"><div className="list-title"><div><strong>{title}</strong><span>{subtitle}</span></div><span className="list-count">{values.length}</span></div><div className="context-items">{values.map((value,index) => <div className="context-item" key={`${value}-${index}`}><span>{value}</span><button type="button" aria-label={`Remove ${title} item ${index+1}`} disabled={disabled} onClick={() => remove(index)}><X size={13} /></button></div>)}</div><div className="list-add"><textarea className="field" rows={2} placeholder={placeholder} value={input} onChange={(event) => setInput(event.target.value)} disabled={disabled} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); add(input); } }} /><button className="icon-btn add-icon" type="button" disabled={disabled || !input.trim()} onClick={() => add(input)} aria-label={`Add ${title}`}><Plus size={17} /></button></div><span className="small muted">Press Enter to add a line. Shift+Enter for a new line.</span></div>;
}

function FindingCard({ finding, index, id, selected, flash, decision, saving, busy, editing, allowDecision, editText, setEditText, onSelect, onAccept, onEdit, onSave, onCancel, onReject, onUndo }: { finding: Finding; index: number; id: string; selected: boolean; flash: boolean; decision?: LocalDecision; saving: boolean; busy: boolean; editing: boolean; allowDecision: boolean; editText: string; setEditText: (value: string) => void; onSelect: () => void; onAccept: () => void; onEdit: () => void; onSave: () => void; onCancel: () => void; onReject: () => void; onUndo: () => void }) {
  const severity = severityOf(finding);
  const Icon = severity === 'critical' || severity === 'high' ? AlertCircle : severity === 'medium' ? Info : Check;
  return <article className={`finding-card card ${selected ? 'selected' : ''} ${decision ? 'decided' : ''} ${flash ? 'flash-target' : ''}`} id={`finding-${id}`} tabIndex={0} role="group" aria-label={`Finding ${index+1}: ${finding.issue}`} onClick={onSelect} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } }}>
    <div className="finding-top"><span className={`severity-chip ${severity}`}><Icon size={13} />{severity[0].toUpperCase()+severity.slice(1)}</span><span className="finding-number">Finding {String(index+1).padStart(2,'0')}</span>{decision && <span className={`decision-tag ${decision.decision}`}>{decision.decision}</span>}</div>
    <div className="finding-title-row"><h3>{finding.category || 'Brand review'}</h3>{typeof finding.confidence === 'number' && Number.isFinite(finding.confidence) && <span className="confidence">{Math.round(Math.max(0,Math.min(1,finding.confidence))*100)}% confidence</span>}</div>
    <p className="finding-issue">{finding.issue || 'Potential brand inconsistency'}</p>
    {finding.evidence && <div className="finding-detail"><span className="detail-label">Evidence</span><blockquote>{finding.evidence}</blockquote></div>}
    {finding.brand_rule && <div className="finding-detail"><span className="detail-label">Brand rule</span><p>{finding.brand_rule}</p></div>}
    {finding.explanation && <div className="finding-detail"><span className="detail-label">Why it matters</span><p>{finding.explanation}</p></div>}
    {(finding.suggested_correction || editing) && <div className="suggestion"><div className="suggestion-head"><span className="detail-label">Suggested correction</span><span className="suggestion-label">PROPOSED</span></div>{editing ? <><textarea className="field edit-suggestion" value={editText} onChange={(event) => setEditText(event.target.value)} aria-label="Edit suggested correction" disabled={busy} onClick={(event) => event.stopPropagation()} /><div className="edit-actions"><Button className="btn-primary" disabled={busy} onClick={(event) => { event.stopPropagation(); onSave(); }}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}Save edit</Button><Button disabled={busy} onClick={(event) => { event.stopPropagation(); onCancel(); }}>Cancel</Button></div></> : <p>{finding.suggested_correction || 'No suggested replacement was provided.'}</p>}</div>}
    <div className="finding-actions">{decision ? <><span className="small muted">{decision.decision === 'rejected' ? decision.reason ? `Reason: ${decision.reason}` : 'Suggestion rejected; original wording kept.' : 'Suggestion applied to revised draft.'}</span>{allowDecision && <Button className="btn-quiet" disabled={busy} onClick={(event) => { event.stopPropagation(); onUndo(); }}>{saving ? <LoaderCircle size={14} className="spin" /> : <Undo2 size={14} />}Undo</Button>}</> : allowDecision ? <><Button className="btn-primary compact" disabled={busy} onClick={(event) => { event.stopPropagation(); onAccept(); }}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}Accept <kbd>A</kbd></Button><Button className="compact" disabled={busy} onClick={(event) => { event.stopPropagation(); onEdit(); }}><Pencil size={14} />Edit <kbd>E</kbd></Button><Button className="btn-quiet compact" disabled={busy} onClick={(event) => { event.stopPropagation(); onReject(); }}><X size={14} />Reject <kbd>R</kbd></Button></> : <span className="small muted">Reviewer approval is required to record decisions.</span>}</div>
  </article>;
}
function DiffView({ original, revised }: { original: string; revised: string }) {
  if (original === revised) return <p className="muted">No accepted or edited suggestions have been applied yet.</p>;
  return <div className="diff-view"><div><span className="diff-label removed">Original</span><p>{original}</p></div><div><span className="diff-label added">Revised</span><p>{revised}</p></div></div>;
}

function ReviewCollaboration({ reviewId, allowStatus }: { reviewId: number; allowStatus: boolean }) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [draftComment, setDraftComment] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(() => {
    void getComments(reviewId).then(setComments).catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Could not load review comments.'));
  }, [reviewId]);
  useEffect(refresh, [refresh]);
  const postComment = async () => {
    if (!draftComment.trim()) return;
    setSaving(true);
    setError('');
    try {
      const comment = await addComment(reviewId, draftComment.trim());
      setComments((current) => [...current, comment]);
      setDraftComment('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not add comment.');
    } finally {
      setSaving(false);
    }
  };
  const changeStatus = async (status: 'approved' | 'needs_revision') => {
    setError('');
    try {
      await setReviewStatus(reviewId, status);
      setStatusMessage(`Review marked ${status.replace('_', ' ')}.`);
      refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not update review status.');
    }
  };
  return <section className="card collaboration-card">
    <div className="section-card-heading"><div><h2><MessageSquare size={17}/> Team discussion</h2><span className="small muted">Comments and review decisions are attached to this saved review.</span></div></div>
    {allowStatus && <div className="toolbar-actions"><Button onClick={()=>void changeStatus('needs_revision')}>Request revision</Button><Button className="btn-primary" onClick={()=>void changeStatus('approved')}>Approve review</Button></div>}
    {statusMessage && <p className="success-box" role="status">{statusMessage}</p>}
    <div className="comment-list">{comments.map((comment)=><article className="comment-item" key={comment.id}><strong>{comment.author}</strong><time>{new Date(comment.created_at).toLocaleString()}</time><p>{comment.body}</p></article>)}{comments.length===0&&<p className="muted small">No comments yet.</p>}</div>
    <label className="label" htmlFor="review-comment">Add a comment</label><textarea id="review-comment" className="field" rows={3} value={draftComment} onChange={(event)=>setDraftComment(event.target.value)} maxLength={5000} placeholder="Share review feedback or context…"/>
    {error&&<div className="error-box" role="alert">{error}</div>}<Button className="btn-primary" disabled={saving||!draftComment.trim()} onClick={()=>void postComment()}>{saving?'Saving…':'Post comment'}</Button>
  </section>;
}

function ReviewsPage() {
  const { setSession } = useApp();
  const [, setLocation] = useLocation();
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    void listReviews().then(setReviews).catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Could not load saved reviews.')).finally(()=>setLoading(false));
  }, []);
  useEffect(refresh, [refresh]);
  const openReview = async (id: number) => {
    try {
      const [review, history] = await Promise.all([getReview(id), getReviewHistory(id)]);
      storeActiveReviewId(id);
      setSession({
        brand: review.brand_name, content: review.content, reviewId: id,
        guidelines: review.brand_guidelines, facts: review.approved_facts,
        findings: normalizeFindings(review.findings),
        decisions: decisionsFromHistory(review.findings, history),
        analysisStatus: 'success', message: `Restored saved review #${id}.`,
      });
      setLocation('/app/review');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not open this review.');
    }
  };
  return <><PageHeader title="Review history" subtitle="Saved reviews in this shared workspace." action={<Button className="btn-primary" onClick={()=>setLocation('/app/review')}>Start a review</Button>}/>
    {error&&<div className="error-box" role="alert">{error}</div>}
    {loading?<p className="muted">Loading reviews…</p>:reviews.length===0?<div className="card calm-empty"><h2>No saved reviews yet</h2><p>Run a review to see it in this workspace history.</p></div>:<div className="card table-wrap"><table className="data-table"><thead><tr><th>Brand</th><th>Status</th><th>Format</th><th>Created</th><th/></tr></thead><tbody>{reviews.map((item)=><tr key={item.id}><td>{item.brand_name} <span className="small muted">#{item.id}</span></td><td>{item.status.replace('_',' ')}</td><td>{item.content_type}</td><td>{new Date(item.created_at).toLocaleString()}</td><td><Button onClick={()=>void openReview(item.id)}>Open review</Button></td></tr>)}</tbody></table></div>}
  </>;
}

function InsightsPage() {
  const [insights, setInsights] = useState<ReviewInsights>();
  const [error, setError] = useState('');
  useEffect(() => {
    void getInsights().then(setInsights).catch((cause: unknown)=>setError(cause instanceof ApiError?cause.message:'Could not load insights.'));
  }, []);
  return <><PageHeader title="Governance insights" subtitle="Aggregate findings from saved reviews; use the patterns to clarify guidance and coaching."/>
    {error&&<div className="error-box" role="alert">{error}</div>}
    {!insights&&!error?<p className="muted">Loading saved review data…</p>:insights&&<><div className="insight-stats"><div className="card"><span>Saved reviews</span><strong>{insights.review_count}</strong></div><div className="card"><span>Recorded findings</span><strong>{insights.finding_count}</strong></div></div><div className="insight-columns"><section className="card insight-card"><h2>Repeated issue categories</h2>{Object.entries(insights.by_category).sort((a,b)=>b[1]-a[1]).map(([category,count])=><div className="insight-row" key={category}><span>{category}</span><b>{count}</b><div className="insight-bar"><i style={{width:`${insights.finding_count?count/insights.finding_count*100:0}%`}}/></div></div>)}{Object.keys(insights.by_category).length===0&&<p className="muted small">No findings are recorded yet.</p>}</section><section className="card insight-card"><h2>Findings by severity</h2>{Object.entries(insights.by_severity).sort((a,b)=>b[1]-a[1]).map(([severity,count])=><div className="insight-row" key={severity}><span>{severity}</span><b>{count}</b><div className="insight-bar"><i style={{width:`${insights.finding_count?count/insights.finding_count*100:0}%`}}/></div></div>)}</section></div><p className="small muted">Counts include findings from saved reviews, not browser-only checks or sample/demo data. These summaries help identify patterns; they do not prove a guideline is unclear.</p></>}
  </>;
}

function TeamPage() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AuthUser['role']>('creator');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(()=>void listTeamUsers().then(setUsers).catch((cause:unknown)=>setError(cause instanceof ApiError?cause.message:'Could not load team accounts.')),[]);
  useEffect(refresh,[refresh]);
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    try {
      const user = await createTeamUser({full_name:fullName,email,password,role});
      setUsers((current)=>[...current,user]); setFullName(''); setEmail(''); setPassword('');
      setMessage('Workspace account created. Share its credentials securely with the team member.');
    } catch (cause) {
      setError(cause instanceof ApiError?cause.message:'Could not create this account.');
    }
  };
  return <><PageHeader title="Workspace team" subtitle="Create accounts and assign least-privilege roles for this local shared workspace."/>
    <form className="card team-form" onSubmit={(event)=>void invite(event)}><h2>Add a team account</h2><div className="team-fields"><label className="label">Full name<input className="field" value={fullName} onChange={(event)=>setFullName(event.target.value)} required maxLength={120}/></label><label className="label">Email<input className="field" type="email" value={email} onChange={(event)=>setEmail(event.target.value)} required/></label><label className="label">Temporary password<input className="field" type="password" value={password} onChange={(event)=>setPassword(event.target.value)} required minLength={12}/></label><label className="label">Role<select className="field" value={role} onChange={(event)=>setRole(event.target.value as AuthUser['role'])}><option value="creator">Creator</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></label></div>{error&&<div className="error-box" role="alert">{error}</div>}{message&&<div className="success-box" role="status">{message}</div>}<Button className="btn-primary" type="submit">Create account</Button></form>
    <section className="card team-list"><h2>Workspace accounts</h2>{users.map((item)=><div className="team-user" key={item.id}><span className="workspace-icon">{item.full_name.slice(0,1).toUpperCase()}</span><div><strong>{item.full_name}</strong><span>{item.email}</span></div><span className="pill">{item.role}</span></div>)}</section>
    <p className="small muted">This prototype provides account authentication and role checks for a single shared workspace. It does not yet support multiple organizations, password resets, or external identity providers.</p>
  </>;
}

type KitTab = 'Guidelines' | 'Approved facts' | 'Terminology' | 'Assets';
function BrandKitPage() {
  const [, setLocation] = useLocation();
  const { kit, setKit, session, setSession, user } = useApp();
  const [tab, setTab] = useState<KitTab>('Guidelines');
  const [draft, setDraft] = useState('');
  const [preferred, setPreferred] = useState('');
  const [avoided, setAvoided] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const tabItems: KitTab[] = ['Guidelines','Approved facts','Terminology','Assets'];
  const values = tab === 'Guidelines' ? kit.guidelines : tab === 'Approved facts' ? kit.facts : kit.assets;
  const canManage = user?.role === 'admin' || user?.role === 'reviewer';
  const persist = (next: BrandKit) => {
    setMessage('Saving shared Brand Kit…');
    void saveBrandKit(next).then(() => {
      setKit(next);
      setMessage('Saved to the shared workspace.');
      window.setTimeout(()=>setMessage(''),2200);
    }).catch((error: unknown) => setMessage(error instanceof ApiError ? error.message : 'Could not save the shared Brand Kit.'));
  };
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
  };
  const remove = (index: number) => {
    if (tab === 'Guidelines') persist({ ...kit, guidelines: kit.guidelines.filter((_,i)=>i!==index) });
    if (tab === 'Approved facts') persist({ ...kit, facts: kit.facts.filter((_,i)=>i!==index) });
    if (tab === 'Assets') persist({ ...kit, assets: kit.assets.filter((_,i)=>i!==index) });
    if (tab === 'Terminology') persist({ ...kit, terminology: kit.terminology.filter((_,i)=>i!==index) });
  };
  const saveEdit = (index: number) => {
    if (tab === 'Guidelines') persist({ ...kit, guidelines: kit.guidelines.map((item,i)=>i===index?editValue.trim():item) });
    if (tab === 'Approved facts') persist({ ...kit, facts: kit.facts.map((item,i)=>i===index?editValue.trim():item) });
    if (tab === 'Assets') persist({ ...kit, assets: kit.assets.map((item,i)=>i===index?editValue.trim():item) });
    setEditing(null);
  };
  const useInReview = () => {
    clearActiveReviewId();
    const terminologyRules = kit.terminology.map(({ preferred, avoided }) => `Use "${preferred}" instead of "${avoided}".`);
    const assetContext = kit.assets.map((asset) => `Approved brand asset reference: ${asset}`);
    setSession({ ...session, reviewId: undefined, guidelines: [...kit.guidelines, ...terminologyRules, ...assetContext], facts: [...kit.facts], findings: [], decisions: {}, analysisStatus: 'idle', message: undefined });
    setLocation('/app/review');
  };
  return <><PageHeader title="Brand Kit" subtitle="Keep the context you reuse close to the review." action={<Button className="btn-primary" onClick={useInReview}><FileCheck2 size={15} />Use in review</Button>} />
    <div className="local-storage-banner"><Save size={16} /><div><strong>Shared workspace Brand Kit</strong><span>Guidelines and approved facts are saved on the backend and shared with signed-in workspace accounts. Reviewer or admin access is required to edit.</span></div></div>
    <div className="kit-layout"><nav className="kit-tabs card" aria-label="Brand Kit categories">{tabItems.map((item)=> <button key={item} className={`kit-tab ${tab===item?'active':''}`} onClick={()=>{setTab(item);setEditing(null);}}>{item}<span>{item==='Guidelines'?kit.guidelines.length:item==='Approved facts'?kit.facts.length:item==='Terminology'?kit.terminology.length:kit.assets.length}</span></button>)}</nav>
      <section className="card kit-content"><div className="kit-content-heading"><div><span className="small muted">SHARED WORKSPACE</span><h2>{tab}</h2><p>{tab==='Guidelines'?'Rules for voice, claims, and presentation.':tab==='Approved facts'?'Approved facts to check factual claims against.':tab==='Terminology'?'Preferred words paired with terms to avoid.':'Reference asset descriptions for reviewers.'}</p></div><span className="pill"><Save size={13} />Backend saved</span></div>
        {tab==='Terminology' ? <div className="terminology-list">{kit.terminology.map((item,index)=><div className="term-row" key={`${item.preferred}-${index}`}>{editing===index?<><input className="field" value={preferred} onChange={(e)=>setPreferred(e.target.value)} aria-label="Preferred term" /><input className="field" value={avoided} onChange={(e)=>setAvoided(e.target.value)} aria-label="Avoided term" /><Button onClick={()=>{persist({...kit,terminology:kit.terminology.map((term,i)=>i===index?{preferred,avoided}:term)});setEditing(null);}}>Save</Button></>:<><span className="term-preferred">{item.preferred}</span><ArrowRight size={15}/><span className="term-avoided">{item.avoided}</span>{canManage&&<><button className="icon-btn" aria-label="Edit terminology" onClick={()=>{setEditing(index);setPreferred(item.preferred);setAvoided(item.avoided);}}><Pencil size={14}/></button><button className="icon-btn" aria-label="Remove terminology" onClick={()=>remove(index)}><Trash2 size={14}/></button></>}</>}</div>)}</div> : <div className="kit-items">{values.map((value,index)=><div className="kit-item" key={`${value}-${index}`}><span className="kit-item-number">{String(index+1).padStart(2,'0')}</span>{editing===index?<><input className="field" value={editValue} onChange={(e)=>setEditValue(e.target.value)} aria-label={`Edit ${tab} item`} /><Button onClick={()=>saveEdit(index)}>Save</Button></>:<><span className="kit-item-text">{value}</span>{canManage&&<><button className="icon-btn" aria-label={`Edit ${tab} item`} onClick={()=>{setEditing(index);setEditValue(value);}}><Pencil size={14}/></button><button className="icon-btn" aria-label={`Remove ${tab} item`} onClick={()=>remove(index)}><Trash2 size={14}/></button></>}</>}</div>)}{values.length===0&&<div className="kit-empty"><BookOpen size={22}/><strong>No {tab.toLowerCase()} yet</strong><span>Add a few items to give future reviews useful context.</span></div>}</div>}
        {canManage && <div className="kit-add-area">{tab==='Terminology'?<div className="term-inputs"><label><span className="label">Preferred term</span><input className="field" value={preferred} onChange={(e)=>setPreferred(e.target.value)} placeholder="members"/></label><label><span className="label">Avoid</span><input className="field" value={avoided} onChange={(e)=>setAvoided(e.target.value)} placeholder="users"/></label><Button className="btn-primary" onClick={addRows} disabled={!preferred.trim()||!avoided.trim()}><Plus size={15}/>Add pair</Button></div>:<><label className="label" htmlFor="kit-add">{tab==='Assets'?'Add asset reference':`Add ${tab.toLowerCase()}`}</label><textarea id="kit-add" className="field" rows={3} value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder={tab==='Assets'?'Describe a logo, guide, or asset reference. Add one per line.':'Add one item per line. Paste multiple lines to import them together.'}/><div className="kit-add-footer"><span className="small muted"><Upload size={13}/>Enter-separated paste import</span><Button className="btn-primary" onClick={addRows} disabled={!draft.trim()}><Plus size={15}/>Add items</Button></div></>}</div>}
        {message&&<div className="saved-message" role="status"><Check size={14}/>{message}</div>}
      </section>
    </div>
  </>;
}

function SettingsPage() {
  const { demo, setDemo, setSession, resetLocalData } = useApp();
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearData = () => { resetLocalData(); setClearConfirm(false); };
  return <><PageHeader title="Settings" subtitle="Environment and privacy information for this browser."/>
    <div className="settings-grid"><section className="card settings-card"><div className="settings-heading"><div className="settings-icon"><Settings size={18}/></div><div><h2>Connection</h2><p>Read-only configuration for the review service.</p></div></div><label className="label" htmlFor="api-url">Review API base URL</label><input id="api-url" className="field mono" value={API_BASE_URL} readOnly/><span className="small muted">Set VITE_API_BASE_URL in the frontend environment. InkGuard stores reviews and decisions through FastAPI.</span><div className="connection-details"><div><span>Current response state</span><strong>Derived from the latest API request</strong></div><span className="pill">No health check</span></div><div className="cors-note"><Info size={15}/><span>During local development, configure the FastAPI service to allow this frontend origin through CORS.</span></div></section>
      <section className="card settings-card"><div className="settings-heading"><div className="settings-icon"><Shield size={18}/></div><div><h2>Review modes and privacy</h2><p>Understand where draft text travels.</p></div></div><div className="privacy-copy"><p>Saved review content is sent to the InkGuard backend and stored with findings in its configured database. Deterministic rule checks are the default and do not call an external AI provider. A server operator may enable OpenRouter AI; if enabled, draft text and supported images are sent to that provider. Check the deployment configuration and provider terms before submitting confidential content.</p><p>Accounts use backend password hashes and signed bearer sessions. The demo uses one shared workspace with creator, reviewer, and admin roles; this is not multi-organization isolation, and it has no password reset or identity provider.</p><p>Browser-only checks are limited heuristics. Rule checks cannot verify factual truth or understand context. Sample mode uses illustrative data and does not call an external AI provider.</p></div></section>
      <section className="card settings-card"><div className="settings-heading"><div className="settings-icon"><Sparkles size={18}/></div><div><h2>Demo mode</h2><p>Explore the workflow with explicitly marked sample analysis.</p></div></div><label className="setting-toggle"><span><strong>Use sample review data</strong><small>Sample content and findings are not sent to the backend.</small></span><input type="checkbox" checked={demo} onChange={(event)=>setDemo(event.target.checked)}/><span className="switch-track"/></label></section>
       <section className="card settings-card danger-settings"><div className="settings-heading"><div className="settings-icon"><Trash2 size={18}/></div><div><h2>Reset local session</h2><p>Clear this browser’s active review and demo preference. Shared reviews and the Brand Kit stay on the backend.</p></div></div>{clearConfirm?<div className="confirm-clear"><p>This resets only the active browser session, not shared workspace data. Continue?</p><Button className="btn-danger" onClick={clearData}>Reset local session</Button><Button onClick={()=>setClearConfirm(false)}>Cancel</Button></div>:<Button className="btn-danger" onClick={()=>setClearConfirm(true)}><Trash2 size={15}/>Reset session</Button>}</section>
    </div>
  </>;
}

function Router() {
  return <Switch>
    <Route path="/" component={Landing}/>
    <Route path="/app/review">{()=><AppShell><ReviewPage/></AppShell>}</Route>
    <Route path="/app/brand-kit">{()=><AppShell><BrandKitPage/></AppShell>}</Route>
    <Route path="/app/settings">{()=><AppShell><SettingsPage/></AppShell>}</Route>
    <Route path="/app/reviews">{()=><AppShell><ReviewsPage/></AppShell>}</Route>
    <Route path="/app/insights">{()=><AppShell><InsightsPage/></AppShell>}</Route>
    <Route path="/app/team">{()=><AppShell><TeamPage/></AppShell>}</Route>
    <Route>{()=><AppShell><NotFound/></AppShell>}</Route>
  </Switch>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const { user, setUser } = useApp();
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const token = sessionStorage.getItem('inkguard-session-token');
    if (!token) { setLoading(false); return; }
    setApiToken(token);
    void getCurrentUser()
      .then(setUser)
      .catch((cause: unknown) => {
        sessionStorage.removeItem('inkguard-session-token');
        setApiToken(undefined);
        setError(cause instanceof ApiError ? cause.message : 'Your session could not be restored.');
      })
      .finally(() => setLoading(false));
  }, [setUser]);
  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const response = registering
        ? await registerAccount({ email, full_name: name, password })
        : await loginAccount({ email, password });
      sessionStorage.setItem('inkguard-session-token', response.token);
      setApiToken(response.token);
      setUser(response.user);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in.');
    }
  };
  if (loading) return <div className="auth-page"><div className="card auth-card">Checking your InkGuard session…</div></div>;
  if (user) return <>{children}</>;
  return <main className="auth-page"><form className="card auth-card" onSubmit={(event) => void authenticate(event)}>
    <div className="hero-tag"><ShieldCheck size={15}/> InkGuard shared workspace</div>
    <h1>{registering ? 'Create workspace account' : 'Sign in'}</h1>
    <p className="muted">{registering ? 'Initialize a new workspace. The first account becomes its administrator; the admin creates later accounts.' : 'Use your workspace account to access reviews and brand materials.'}</p>
    {registering && <label className="label">Full name<input className="field" value={name} onChange={(event)=>setName(event.target.value)} required maxLength={120}/></label>}
    <label className="label">Email<input className="field" type="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} required/></label>
    <label className="label">Password<input className="field" type="password" autoComplete={registering?'new-password':'current-password'} value={password} onChange={(event)=>setPassword(event.target.value)} minLength={registering?12:1} required/><span className="small muted">{registering ? 'Use at least 12 characters.' : ''}</span></label>
    {error && <div className="error-box" role="alert">{error}</div>}
    <button className="btn btn-primary" type="submit">{registering?'Create account':'Sign in'}</button>
    <button className="btn btn-quiet" type="button" onClick={()=>{setRegistering((value)=>!value);setError('');}}> {registering?'Already have an account? Sign in':'First setup? Initialize workspace'}</button>
    <p className="small muted">Local demo accounts are stored in the project database. Do not reuse a sensitive password.</p>
  </form></main>;
}

function App() {
  const [demo, setDemo, clearDemo] = useStoredState<boolean>(STORAGE_DEMO,false);
  const [kit, setKit] = useStoredState<BrandKit>(STORAGE_KIT,DEFAULT_KIT);
  const [session, setSession] = useState<ReviewSession>(emptySession);
  const [apiState, setApiState] = useState<AppContextValue['apiState']>('unknown');
  const [sessionVersion, setSessionVersion] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const signOut = useCallback(() => {
    sessionStorage.removeItem('inkguard-session-token');
    setApiToken(undefined);
    clearActiveReviewId();
    setSession(emptySession);
    setUser(null);
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    void getBrandKit()
      .then((serverKit) => {
        if (active) setKit(serverKit);
      })
      .catch((error: unknown) => {
        console.error('Could not load the shared Brand Kit.', error);
      });
    return () => { active = false; };
  }, [user, setKit]);
  const wrappedSetSession = useCallback((next: ReviewSession) => {
    setSession(next);
    if (next.analysisStatus === 'loading') return;
    if (next.analysisStatus === 'success' || next.analysisStatus === 'not-configured') setApiState('connected');
    else if (next.analysisStatus === 'error') {
      const states: Record<AnalyzeErrorKind, AppContextValue['apiState']> = { network: 'offline', server: 'error', 'invalid-json': 'invalid-response', timeout: 'timeout' };
      setApiState(next.errorKind ? states[next.errorKind] : 'error');
    }
  }, []);
  const resetLocalData = () => {
    clearActiveReviewId();
    clearDemo(false);
    setSession(emptySession);
    setApiState('unknown');
    setSessionVersion((version) => version + 1);
  };
  const value: AppContextValue = { demo, setDemo, kit, setKit, session, setSession: wrappedSetSession, apiState, resetLocalData, sessionVersion, user, setUser, signOut };
  return <AppContext.Provider value={value}><AuthGate><Router/></AuthGate></AppContext.Provider>;
}

export default App;
