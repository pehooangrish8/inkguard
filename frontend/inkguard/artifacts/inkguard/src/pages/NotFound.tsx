import { Link } from 'wouter';
import Mascot from '../components/Mascot';

export default function NotFound() {
  return <div className="not-found"><Mascot/><span className="section-kicker">PAGE NOT FOUND</span><h1>That page isn’t in the workspace.</h1><p>The address may have changed, or the link may be out of date.</p><div className="flex gap-3"><Link className="btn btn-primary" href="/">Go to InkGuard home</Link><Link className="btn" href="/app/review">Open review workspace</Link></div></div>;
}
