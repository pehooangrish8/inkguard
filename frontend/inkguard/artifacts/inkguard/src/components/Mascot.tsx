export default function Mascot({ state = 'idle' }: { state?: string }) {
  const expression = state.includes('error') || state === 'offline' ? 'worried' : state === 'success' || state === 'demo' ? 'happy' : 'calm';
  return <svg className="mascot mascot-float" viewBox="0 0 64 72" role="img" aria-label={`Inky, ${expression}`}>
    <path className="mascot-tip" d="M31 4C28 16 9 31 9 46c0 12 10 21 23 21s23-9 23-21C55 30 36 16 31 4Z" fill="#fcf1d0" stroke="#22396f" strokeWidth="2.5" />
    <ellipse cx="32" cy="47" rx="16" ry="12" fill="#0d1c42" />
    <g className="mascot-blink"><ellipse cx="26" cy="44" rx="2.1" ry="3" fill="#fcf1d0" /><ellipse cx="38" cy="44" rx="2.1" ry="3" fill="#fcf1d0" /></g>
    {expression === 'happy' ? <path d="M27 51q5 6 10 0" fill="none" stroke="#fcf1d0" strokeWidth="1.7" strokeLinecap="round" /> : expression === 'worried' ? <path d="M28 54q4-4 8 0" fill="none" stroke="#fcf1d0" strokeWidth="1.7" strokeLinecap="round" /> : <path d="M29 52h6" fill="none" stroke="#fcf1d0" strokeWidth="1.7" strokeLinecap="round" />}
  </svg>;
}
