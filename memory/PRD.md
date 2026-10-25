# Rentwise — PRD

## Original problem
Build the mobile app described in rentwise-fresh-plan.md: an AI agent ("Rentwise") stands in for small US landlords (1–10 homes). It onboards tenants, answers lease and state-law questions, tracks rent and coordinates repairs on its own. The landlord only taps to approve money. The user chose to **build the full plan in one go**, with sample data so features can be tried in a demo account.

## Architecture
- Expo Router app, using the design system from section 2A (Plus Jakarta Sans, light and dark themes in `src/theme.ts`). Native tabs on iOS 26+, standard tabs elsewhere.
- Backend: FastAPI and MongoDB.
  - `core.py`: auth, storage, messaging, atomic status changes
  - `flows.py`: ticket state machine, matching, approvals, scheduler
  - `agent.py`: three agent seats with Claude tools
  - `money.py`: ledger, simulated payments and bank feed, Schedule E report
  - `data.py`: state rules, lease template, PDFs, `create_sample_home`
  - `server.py`: routes
- AI models:
  - claude-sonnet-5-5: agent conversations and tools, reading photos and receipts
  - claude-haiku-4-5: triage and rewording relays (haiku-5-5 isn't available)
  - claude-opus-5-5: checking the year-end report
- Sign-in uses Emergent Google auth with bearer sessions. Files go to Emergent object storage. PDFs are made with reportlab.
- The scheduler is an asyncio loop guarded by a Mongo lock.
- `DEMO_MODE=1`: follow-ups fire after 120 s and the test tokens are seeded.

## Implemented (2026-06)
- **Sign-in:** Google only, then role choice. Landlords pick a sample home or start empty. Tenants accept an in-app invite or see a no-invite screen. Handymen set up trades, ZIP and phone. Users can switch account.
- **Landlord:**
  - Home: Needs you approvals, Agent at work feed, stats including "Fixed without you", Ask Rentwise chat
  - Tickets: stacked sections, ticket detail with timeline and read-only agent chats
  - Properties: add (whole home or rooms, ZIP lookup, photo), detail with house rules, utilities, state rules, invites and leases
  - Handymen: my list, invite, marketplace with trade filter, handyman detail
  - Money: month by room, simulated bank feed with auto-match and review, cash, expenses, year-end report (PDF/CSV export, AI check)
  - Settings: policies, remembered facts, Try as sample people, reset sample data
- **Tenant:** Home (rent card, Pay rent, onboarding checklist, repairs, lease card), Chat with quick replies and photos, Tickets (pick a time, confirm fixed, rate, self-fix, receipt upload), Payments (ledger, receipt PDFs, credits, deposit), Your rights screen.
- **Handyman:** Jobs (offers, booked, done), accept with quote and times, decline, mark fixed with after photo, job chat with the agent, Profile with earnings.
- **Agent:** triage and off-topic refusal, ticket creation, matching (own handymen first, then marketplace), relays rewritten in the agent's voice with contacts stripped, quote approval running alongside scheduling, emergencies, self-fix flow, receipt reuse blocked, memory facts and policies, lease search, state law, history search.
- **Scheduler:** expires unanswered offers, nudges for time picks, asks the handyman for status, nudges for self-fix receipts.
- **Leases:** template, 3-step form with a deposit warning, simulated e-sign (tenant then landlord), signed PDF with document hash, deposit becomes due.
- **Testing:** iteration 1 passed 27 of 28 backend tests; both high-priority bugs are fixed and now all 28 pass. The frontend flows passed.

## Backlog
- P1: eval suite (`backend/evals`) with the real models; more unit tests (fake clock, privacy, money)
- P1: upload an existing lease PDF and extract terms with Opus
- P1: stage accounts (`DEMO_*_EMAIL` settings)
- P2: Stripe payments (B1), Plaid bank feed (B2), real e-sign (B3)
- P2: rolling thread summaries and automatic fact extraction after conversations
- P2: split `server.py` into routers
