// Throwaway mock backend for the visual preview only. Serves canned JSON on :3001
// so the screens that fetch on mount (MainScreen, DraftEditor, Tracking) populate.
import { createServer } from 'node:http';

const events = [
  {
    id: 'e1',
    contact: { id: 'c1', full_name: 'Priya Sharma', title: 'Eng Recruiter', persona: 'recruiter', company_domain: 'stripe.com', school_match: false, tier: 'green', status: 'verified' },
    channel: 'email', subject: 'USC student, quick question about the SWE intern role', sent_at: '2026-06-05T10:00:00Z', bounced: false, status: 'replied',
  },
  {
    id: 'e2',
    contact: { id: 'c2', full_name: 'Marcus Lee', title: 'Software Engineer', persona: 'alumni', company_domain: 'figma.com', school_match: true, tier: 'green', status: 'verified' },
    channel: 'email', subject: 'Fellow Trojan reaching out', sent_at: '2026-06-06T10:00:00Z', bounced: false, status: 'sent',
  },
  {
    id: 'e3',
    contact: { id: 'c3', full_name: 'Dana Whitfield', title: 'Hiring Manager, Growth', persona: 'hiring_manager', company_domain: 'notion.so', school_match: false, tier: 'amber', status: 'likely' },
    channel: 'email', subject: 'Interested in the New Grad PM role', sent_at: '2026-06-07T10:00:00Z', bounced: false, status: 'drafted',
  },
];

const draft = {
  /* This draft is photographed by the marketing site's capture script, so it
     has to agree with the job fixture in preview.tsx (Figma, Software
     Engineer) and with the audience decision: Litos is for job seekers, not
     only for interns. It said "SWE intern role" against a fixture that says
     Software Engineer, which is the exact drift the automated capture exists
     to stop. */
  subject: "Fellow Trojan reaching out about the software engineer role",
  body: "Hi Marcus,\n\nI studied CS at USC, and I came across the software engineer opening on your team at Figma. I noticed you made the same jump from USC into engineering, so your path really stood out to me.\n\nI've spent the last year building full-stack projects (most recently a React + FastAPI study tool that reached 400 users), and I'd love to bring that energy to Figma. Would you be open to a quick 15-minute chat about what the team looks for?\n\nThank you for your time,\nAlex",
  word_count: 89,
  warnings: [],
};

const send = (res, code, data) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  });
  res.end(JSON.stringify(data));
};

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = req.url || '';
  if (url.startsWith('/track/events')) return send(res, 200, events);
  if (url.startsWith('/draft')) return send(res, 200, draft);
  if (url.startsWith('/track/event')) return send(res, 200, {});
  // v2 autofill-setup screen: empty bank (so it seeds from the mock profile) and a
  // 404 application profile (so the screen falls back to blank fields, same as a
  // first-time visit) unless the preview wants to demo the pre-filled case.
  // The setup screen reads /onboarding/state for the automation permissions AND, since the
  // earned-consent gate, for standing_consent_eligibility. Without it the harness rendered the
  // auto-submit toggle in its unlocked state, which is the ONE state a new student never sees, so
  // the screen you could eyeball was the screen nobody gets. Ineligible is the honest default here:
  // a preview account has approved nothing.
  if (url.startsWith('/onboarding/state')) {
    return send(res, 200, {
      automatic_submission_enabled: false,
      automatic_verification_enabled: false,
      standing_consent_eligibility: { eligible: false, reviewed_submits: 0, required: 3, remaining: 3 },
    });
  }
  if (url.startsWith('/profile/experience-bank')) return send(res, 200, { entries: [] });
  if (url.startsWith('/profile/application')) {
    // GET simulates a first-time visit (no profile saved yet); PUT (the save step) succeeds.
    return req.method === 'GET' ? send(res, 404, { error: 'not found' }) : send(res, 200, {});
  }
  return send(res, 200, {});
});

/* Port is overridable because the default collides with the real backend, which
   made `npm run preview` unusable while the backend was up. The marketing
   site's capture script sets this so it can bring the harness up unattended. */
const PORT = Number(process.env.PREVIEW_MOCK_PORT || 3001);
server.listen(PORT, () => console.log(`mock backend on :${PORT}`));
