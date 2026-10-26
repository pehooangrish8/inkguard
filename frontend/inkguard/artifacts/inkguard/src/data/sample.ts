import type { Finding, ReviewSession } from '../types';

export const sampleGuidelines = [
  'Use a warm, clear, practical tone. Avoid exaggerated promises.',
  'Refer to readers as “members,” never “users.”',
  'Do not describe a feature as automatic unless it truly requires no action.',
];
export const sampleFacts = [
  'Northstar helps independent publishers organize their editorial workflow.',
  'The studio launched in 2019.',
  'Plans begin at $12 per month, billed annually.',
];
export const sampleDraft = `Northstar is the only publishing platform you will ever need. Our automatic editorial tools make every story perfect in seconds. Join 50,000 users who trust us to grow their audience.`;
export const sampleFindings: Finding[] = [
  { id: 'sample-1', issue: '“the only publishing platform you will ever need”', severity: 'high', evidence: 'Northstar is the only publishing platform you will ever need.', brand_rule: 'Avoid exaggerated or absolute promises.', explanation: 'This absolute claim is difficult to substantiate and conflicts with the brand’s practical, grounded voice.', suggested_correction: 'A publishing workspace built for independent publishers.', confidence: 0.94, category: 'Overclaim' },
  { id: 'sample-2', issue: '“automatic editorial tools”', severity: 'medium', evidence: 'Our automatic editorial tools make every story perfect in seconds.', brand_rule: 'Do not call a feature automatic unless it requires no action.', explanation: 'The wording implies a hands-free process and guarantees an outcome.', suggested_correction: 'Our editorial tools help your team review each story with care.', confidence: 0.86, category: 'Feature accuracy' },
  { id: 'sample-3', issue: '“50,000 users”', severity: 'critical', evidence: 'Join 50,000 users who trust us to grow their audience.', brand_rule: 'Use only approved, current product facts.', explanation: 'This audience figure is not in the approved facts supplied for this review.', suggested_correction: 'Join independent publishers building a more considered workflow.', confidence: 0.98, category: 'Unverified fact' },
  { id: 'sample-4', issue: '“users”', severity: 'low', evidence: '50,000 users who trust us', brand_rule: 'Refer to readers as “members,” never “users.”', explanation: 'Use the preferred audience term to stay consistent with brand language.', suggested_correction: 'members', confidence: 0.91, category: 'Terminology' },
];

export const emptySession: ReviewSession = {
  brand: '',
  content: '',
  guidelines: [],
  facts: [],
  findings: [],
  decisions: {},
  analysisStatus: 'idle',
};

export const queueSamples = [
  { id: 'IG-2048', title: 'A steadier way to plan your next issue', owner: 'Maya Chen', date: 'Today, 10:42 AM', status: 'In review', note: 'Please check the launch timing claim.' },
  { id: 'IG-2047', title: 'Meet the new editorial calendar', owner: 'Leo Park', date: 'Today, 9:18 AM', status: 'Draft', note: 'Updated the feature description.' },
  { id: 'IG-2043', title: 'A note from our founder', owner: 'Maya Chen', date: 'Yesterday', status: 'Approved', note: 'Approved after copy edits.' },
  { id: 'IG-2039', title: 'Spring studio letter', owner: 'Ari Ellis', date: 'Jun 12', status: 'Changes requested', note: 'Needs a confirmed audience figure.' },
];
