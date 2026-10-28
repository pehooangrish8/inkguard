import type { Finding } from '../types';

const riskyClaimPattern = /\b(?:guarantee(?:s|d|ing)?|always|never|best|perfect|only|risk[- ]free)\b|100\s*%/gi;
const numberPattern = /\b\d[\d,]*(?:\.\d+)?%?/g;
const avoidedTermPatterns = [
  /\b(?:avoid|never\s+(?:use|say|call)|do\s+not\s+(?:use|say|call)|don't\s+(?:use|say|call))\s+(?:(?:the\s+)?(?:term|word)\s+)?["“']([^"”']+)["”']/gi,
  /\bnever\s+refer\s+to\b[^.!?]*?\bas\s+["“']([^"”']+)["”']/gi,
  /\bnever\s+["“']([^"”']+)["”']/gi,
];

function extractAvoidedTerms(guidelines: string[]): Array<{ term: string; guideline: string }> {
  const terms: Array<{ term: string; guideline: string }> = [];
  const seen = new Set<string>();

  for (const guideline of guidelines) {
    for (const pattern of avoidedTermPatterns) {
      pattern.lastIndex = 0;
      for (const match of guideline.matchAll(pattern)) {
        const term = match[1].trim().replace(/[.,;:!?]+$/, '');
        const key = term.toLocaleLowerCase();
        if (term && !seen.has(key)) {
          seen.add(key);
          terms.push({ term, guideline });
        }
      }
    }
  }

  return terms;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeNumber(value: string): string {
  return value.replace(/,/g, '').replace(/%$/, '');
}

export function runLocalChecks(
  content: string,
  guidelines: string[],
  approvedFacts: string[],
): Finding[] {
  const findings: Finding[] = [];
  const riskyPercentNumbers = new Set<string>();
  const addFinding = (finding: Omit<Finding, 'id'>) => {
    findings.push({ ...finding, id: `local-${findings.length + 1}` });
  };

  riskyClaimPattern.lastIndex = 0;
  for (const match of content.matchAll(riskyClaimPattern)) {
    const phrase = match[0];
    if (phrase.includes('%')) riskyPercentNumbers.add(normalizeNumber(phrase));
    addFinding({
      issue: `Review absolute or guarantee wording: "${phrase}"`,
      severity: 'medium',
      evidence: phrase,
      explanation: 'A simple local phrase check found wording that may imply an absolute or guaranteed outcome.',
      suggested_correction: 'Review the claim and soften it or support it with approved evidence.',
      category: 'Local phrase check',
    });
  }

  for (const { term, guideline } of extractAvoidedTerms(guidelines)) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRegExp(term)})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    for (const match of content.matchAll(pattern)) {
      const evidence = match[2];
      addFinding({
        issue: `Avoided term in draft: "${evidence}"`,
        severity: 'low',
        evidence,
        brand_rule: guideline,
        explanation: 'This term appears in a guideline as wording to avoid.',
        suggested_correction: 'Replace it with your brand’s preferred wording.',
        category: 'Local terminology check',
      });
    }
  }

  const approvedNumbers = new Set(
    approvedFacts.flatMap((fact) => [...fact.matchAll(numberPattern)].map((match) => normalizeNumber(match[0]))),
  );
  const sentences = content.match(/[^.!?\r\n]+[.!?]?/g) ?? [];
  for (const sentence of sentences) {
    const text = sentence.trim();
    const unapprovedNumbers = [...text.matchAll(numberPattern)]
      .map((match) => match[0])
      .filter((number) => !approvedNumbers.has(normalizeNumber(number)))
      .filter((number) => !number.endsWith('%') || !riskyPercentNumbers.has(normalizeNumber(number)));

    for (const number of unapprovedNumbers) {
      addFinding({
        issue: `Number needs verification: "${number}"`,
        severity: 'medium',
        evidence: text,
        explanation: 'This number was not found in the approved facts supplied. The local check cannot determine whether the claim is true.',
        suggested_correction: 'Verify the number against an approved fact or remove it.',
        category: 'Local fact check',
      });
    }
  }

  return findings;
}
