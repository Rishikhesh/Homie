# Homi — PRD

## Original problem
Build the mobile app described in rentwise-fresh-plan.md: an AI agent ("Homi") stands in for small US landlords (1–10 homes). It onboards tenants, answers lease and state-law questions, tracks rent and coordinates repairs on its own. The landlord only taps to approve money. The user chose to **build the full plan in one go**, with sample data so features can be tried in a demo account.

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
  - Home: Needs you approvals, Agent at work feed, stats including "Fixed without you", Ask Homi chat
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
- P1: more unit tests (fake clock, privacy, money)
- P1: stage accounts (`DEMO_*_EMAIL` settings)
- P2: Stripe payments (B1), Plaid bank feed (B2), real e-sign (B3)
- P2: rolling thread summaries and automatic fact extraction after conversations
- P2: split `server.py` into routers

## Upload existing signed lease (2026-06)
- Property detail → "Upload signed lease" (`/lease/upload?unit=`): pick PDF → `/api/upload` → `POST /api/leases/extract` (pypdf text + Opus JSON terms, chunks) → landlord reviews/edits → `POST /api/leases/upload` saves status `signed`, `source: upload`, `file_id`; voids older leases, updates unit rent/due day, marks onboarding lease step, posts lease card to tenant; `search_lease` uses its chunks; `/leases/{id}/pdf` returns the original. Scanned (no-text) PDFs get a clear error.

## Fixes + eval suite (2026-06)
- **Eval suite** `backend/evals` (`python -m evals.run [--only 0,7] [--no-tone]`): the 21 scenarios from section 4.9 (demo script #0 plus #1–20) run over HTTP against the real models with the demo logins. The sample home is reset between cases. Each run checks tool calls (logged to `db.tool_calls`) and the database state, then a Haiku tone judge (needs an average of 4 or more). Results go to `evals/results/*.json`. Last run: 21/21 scenarios, tone 4.49.
- Found by the evals: the off-topic filter refused tenant answers to relayed questions. It now also sees the agent's previous message.
- Rent and deposit pay locks now expire after 2 minutes, are taken over if stale, and are released when a payment fails.
- Login tokens are no longer accepted in URLs. Images and PDFs use a read-only `media` token from `/auth/me` (`get_media_user`).
- The report label now reads "Security deposits received this year".
- The demo `/money/bank/connect` endpoint and the demo bank picker are removed. Plaid is the only way to connect a bank.
- Uploaded leases: unit rent is no longer changed. There's a "deposit already paid" option (`terms.deposit_paid`), and missing terms stay empty.

## Move-in / move-out inspection (headline workflow, 2026-06) — plan: move-in-out-prompt.md
- Backend `inspections.py` (own router):
  - **Capture:** video upload (mp4/mov, ≤45 s, ≤100 MB). Frames are extracted with imageio-ffmpeg (1 every 2 s, max 15, phash dedupe < 6, 1024 px). Photos are the fallback.
  - **Move-in:** move-in check → Sonnet writes area notes → tenant taps "Looks right" → record locked with `report_hash`; any write after that returns 409.
  - **Move-out:** started by the landlord, or by the agent's `suggest_move_out` one-tap approval. `due_by` uses the state's `deposit_return_days`. The countdown comes from `GET /move-outs`.
  - **Analysis:** frames are paired by phash. Jev screens each pair (raw HTTP with the `TypeSafe-Danger-Zone-Images` header; retries at 640/512 px on `max_tokens_exceeded`). Routing constants are at the top of the file. Added safety net: a phash distance ≥ 8 never skips Sonnet. Sonnet reviews flagged pairs (max 3 in parallel). Server-side validation and merging follow.
  - **Statement:** draft `deposit_statements` plus a `deposit_statement` approval. `PATCH /statements/{id}` with `version` supports price / remove / undo / category / add, and totals are always recomputed on the server.
  - **Approval** (`flows.apply_approval`): recorded `deposit_refund` payment, chat card, PDF (`/statements/{id}/pdf`), `kept` counted as Schedule E income (`deposit_kept`).
  - **Disputes:** "Question this" goes to the tenant chat; the agent's `suggest_drop_charge` creates a `drop_charge` approval, which refunds the difference.
- Jev's `box` question type is not available through the proxy, so the damage box comes from Sonnet.
- **Frontend:** `/inspection/[id]` (capture, review notes, comparing progress, read-only record with video), `/statement/[id]` (landlord edit and approve; tenant read-only with "Question this"). Also: tenant Home move-in/move-out card, Payments statement card, landlord Home Move-outs countdown, property unit buttons (Move-in record / Start move-out / Deposit statement).
- **Tests and evals:** `tests/test_inspections.py` (18 tests, models faked). `python -m evals.move_out` uses real models and your pairs in `evals/media/<pair>/` (generated pairs until you add some); last run 5/6.

## Voice in chat (June 2026) — DONE, tested (iteration_11 + fixes)
- Read aloud (Emergent TTS, tts-1 "coral", cached) on agent replies; tap-to-talk mic (Emergent STT gpt-4o-mini-transcribe) fills the message box.
- Fixes after testing: audio format detected from file bytes (web webm / phone m4a), unclear audio returns friendly 422, read-aloud permission matches chat read rules, failed playback shows toast, icon-only send button for wider message box.
- Hands-free mode (DONE, iteration_12): switch at top of chat (remembered). When on, spoken messages send automatically and the first Homi reply after them is read aloud.

## Visual language pass ("See it, don't read it") — June 2026 (visual-language-prompt.md)
- Foundation: src/status.ts (statusOf → good/waiting/you/none, shared fixture src/status.fixture.json), theme status colors (amber #B26A00 contrast fix), src/visual.tsx (Status, StripCard, BigNumber, Tracker, PersonChip, TimeChoice, YesNo, Countdown, MoneyCard, PhotoPair, DocTile, IconRow, More, SuccessBurst), /visual-qa screen (DEMO only, Settings link).
- Agent: one-line rule (≤12 words, DETAILS behind More), server split >20 words (cards.shorten) + fit_line, typed live cards (GET /api/cards/{type}/{ref}, cards.py), show_card tool on all seats (403 on others' records), auto repair cards, auto yes_no cards; src/chatcards.tsx renders them.
- Screens: tenant home tiles, Repairs rename (tab testID kept tab-tickets), repair detail tracker/YesNo/TimeChoice, payments, lease icon summary; landlord home banner/money/homes/this-week, MoneyCard approvals, rent grid (GET /api/money/grid), Homes with room strips; handyman offer/number pad/countdown/done; move-in area tiles, move-out summary.
- Tests: tests/test_status_kinds.py, tests/test_visual_cards.py; eval: python -m evals.visual
- Voice kept on for everyone (user choice).
- Follow-up (user feedback): removed all colored left card borders, reduced text/icon sizes app-wide (BigNumber 28/22, status icons 16/20, buttons 50px, tracker 30/22), fixed tracker overflow and iOS number clipping; visit times use the server label in the property's time zone; landlord tab "Homes". Tested in iteration_14.
- Open polish: statement PDF ISO dates, "Handym…" tab label at 360px.

## Handyman calls (voice-calls-prompt.md) — June 2026
- The choice lives only with the handyman: Profile → "How Homi contacts you" (handymen.contact_pref, default message). No landlord setting (removed at the user's request); landlords only see a read-only "Prefers calls/messages" label.
- In-app ringing only (no push; user choice). Emergent STT/TTS (VOICE_PROVIDER=emergent; elevenlabs stub falls back).
- backend/calls.py (calls collection, ring 45s/DEMO 20s, 5-min cap, atomic moves, fallback to text offer, call agent with accept_job/decline_job/end_call → existing handyman_accept/decline), flows.offer_job hook + post_offer, tick: emergency 15-min window, tick_calls.
- Frontend: app/call/[id].tsx (ringing / hold-to-talk / type instead / hang up / landlord transcript), src/call/IncomingCallWatcher (3 s poll in handyman layout), ChoiceCards in welcome, profile, settings; "Prefers calls" label; missed-call label; timeline call rows → transcript.
- Tests: tests/test_calls.py (15 pass). Eval: python -m evals.handyman_calls (5/5 pass).
- Note: some older API tests fail only under parallel xdist (shared demo state); pass with -n0.

## Plaid Transfer rent (sandbox) — June 2026
- backend/transfers.py: /api/bank/connect (sandbox test bank, auth+transfer, tokens server-only), /bank/me, /bank/disconnect, /bank/transfers; charge(): ACH debit tenant → Plaid Ledger, simulate posted/settled/funds_available, ACH credit Ledger → landlord (payout_pending if credit fails).
- /api/rent/pay {method:"bank"} runs the transfer before recording the payment (source plaid_transfer, transfer_id) → ledger, receipts, Money, tax summary.
- Auto-sort deposits: plaid_bank.categorize() → rent/deposit/fee/other on bank_txns; shown in Money bank feed.
- UI: src/bank.tsx BankCard (tenant Payments "Your bank", landlord Money "Payouts"), PayButton pays "from ••mask" when connected.
- Tests: tests/test_transfers.py. User choices: test money only, tenant taps each month, record + auto-sort.
- Fixes (iterations 17-18): shared bank store (Pay buttons update instantly), failed transfers marked failed, one Plaid idempotency key per attempt (retry after decline works), crash-after-debit reuse (no double charge), receipt wording for Plaid payments, disconnect removes the Plaid item, sandbox test user with a $25k balance (set up by the testing agent).

## Auto-OK repair limit — June 2026 (iteration_19 + tests/test_auto_approve.py)
- Landlord Settings → "Auto-OK repairs up to ($)" (users.auto_approve_limit, default 200, 0 = off; tenants/handymen can't set it).
- Handyman price <= limit → no landlord approval card; ticket.quote_status="auto"; tenant's time card shows "Price $X · picking a time agrees to it".
- Tenant picks time → quote approved (auto_approved=True), approvals record status "auto_approved", booked. Limit re-checked at pick; if lowered, falls back to landlord tap.
- Over limit → old flow. Final-price overage + handyman payment still need landlord tap.
- Auto-OK history: GET /api/landlord/auto-approvals (non-cancelled, with total) → Settings list under the limit (src/AutoHistory.tsx), rows open /ticket/[id].

## Sign-in illustration — June 2026
- Login is text-only now (big two-tone headline + ticker + Google button); LoginHero.tsx removed.
Note: app renamed Homi → Homi (June 2026).

## Shared demo admin toggle — June 2026 (tests/test_shared_demo.py)
- ADMIN_EMAILS env (backend/.env: rishiyashvanth@gmail.com, turzobose@gmail.com). /auth/me → is_admin.
- db.app_settings {key:"shared_demo", on}. GET/POST /api/admin/shared-demo (POST admin-only).
- On: other landlords may X-Act-As admins' sample people; /sample/people adds them with shared=true. Off: own sample people only. DEMO_MODE unchanged.
- Settings → "Admin · Shared demo" switch (src/SharedDemoSwitch.tsx), shown only to admins.
