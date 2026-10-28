export const faqItems = [
  { label: 'What does InkGuard do?', answer: 'InkGuard compares a draft with the brand guidelines and approved facts you provide. It highlights review points for a person to decide.' },
  { label: 'How do I review a draft?', answer: 'Choose a brand, add the draft, and include the relevant guidelines and approved facts. Select Run review to apply the configured rules-based checks; an administrator may optionally enable external AI.' },
  { label: 'What do the severity levels mean?', answer: 'Critical flags a potentially material factual or trust issue. High marks a strong conflict. Medium suggests a meaningful change. Low is a consistency note.' },
  { label: 'Why is analysis not configured?', answer: 'This message appears only when the server operator enabled external AI but did not configure its provider credentials and model. The default rules-based review does not require an AI key.' },
  { label: 'What do accept, edit, and reject do?', answer: 'Accept applies the suggested correction, Edit lets you write a replacement, and Reject keeps the draft wording. Decisions for saved backend reviews persist; sample and browser-only check decisions stay in this browser session.' },
  { label: 'Are decisions saved?', answer: 'Decisions for saved backend reviews are persisted. Decisions for sample reviews and browser-only checks stay in this browser session.' },
  { label: 'What is demo mode?', answer: 'Demo mode uses a clearly labeled sample review so you can explore the workflow without sending sample text to the backend.' },
  { label: 'Is my draft private?', answer: 'Saved review drafts are sent to the InkGuard backend and stored in its configured database. External AI is optional and may be enabled by the server operator; check its configuration before submitting confidential material.' },
  { label: 'What are local checks?', answer: 'Local checks run simple phrase, avoided-term, and number checks in this browser without sending the draft to the backend. They are limited heuristics, not AI or fact verification, and may miss issues or flag harmless wording.' },
];
