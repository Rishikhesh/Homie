"""Static data, lease template, PDFs and the sample home."""
import io, hashlib
from datetime import timedelta
from core import db, NF, uid, iso, now, period_of, prev_period, money, tz_for

STATE_RULES = {
    "CA": {"state": "CA", "name": "California", "deposit_limit": "1 month's rent (most landlords, since July 2024)", "deposit_return_days": 21,
           "entry_notice": "24 hours written notice", "late_fee_rule": "Must be a reasonable estimate of the landlord's actual cost",
           "repair_and_deduct": "Allowed up to 1 month's rent, twice a year, after reasonable notice", "rent_increase_notice": "30 days (90 days if over 10%)",
           "notes": "AB 1482 caps most yearly increases at 5% + inflation (max 10%).", "source_url": "https://www.courts.ca.gov/selfhelp-eviction.htm"},
    "TX": {"state": "TX", "name": "Texas", "deposit_limit": "No legal limit", "deposit_return_days": 30, "entry_notice": "No statute; follow the lease",
           "late_fee_rule": "Allowed after rent is 2 full days late; reasonable (≤12% for small buildings)", "repair_and_deduct": "Allowed in limited cases (Prop. Code 92.0561)",
           "rent_increase_notice": "Per lease; month-to-month needs 1 month", "notes": "Landlord must repair conditions affecting health or safety.", "source_url": "https://texaslawhelp.org"},
    "NY": {"state": "NY", "name": "New York", "deposit_limit": "1 month's rent", "deposit_return_days": 14, "entry_notice": "Reasonable notice (24 hours is customary)",
           "late_fee_rule": "Max $50 or 5% of rent, after 5 days", "repair_and_deduct": "Not by statute; warranty of habitability applies",
           "rent_increase_notice": "30–90 days depending on tenancy length", "notes": "Housing Stability and Tenant Protection Act 2019.", "source_url": "https://ag.ny.gov/tenants-rights"},
    "FL": {"state": "FL", "name": "Florida", "deposit_limit": "No legal limit", "deposit_return_days": 15, "entry_notice": "24 hours for repairs",
           "late_fee_rule": "Per lease; must be reasonable", "repair_and_deduct": "Not allowed; tenant may withhold rent after 7-day notice",
           "rent_increase_notice": "Per lease; month-to-month needs 30 days", "notes": "Deposit return is 15 days with no deductions, 30 days with a claim.", "source_url": "https://www.flsenate.gov/Laws/Statutes/2023/Chapter83"},
    "WA": {"state": "WA", "name": "Washington", "deposit_limit": "No statewide limit (move-in checklist required)", "deposit_return_days": 30,
           "entry_notice": "2 days (1 day to show the unit)", "late_fee_rule": "No fee until rent is 5 days late", "repair_and_deduct": "Allowed with limits after written notice",
           "rent_increase_notice": "90 days", "notes": "RCW 59.18 Residential Landlord-Tenant Act.", "source_url": "https://app.leg.wa.gov/rcw/default.aspx?cite=59.18"},
    "IL": {"state": "IL", "name": "Illinois", "deposit_limit": "No statewide limit", "deposit_return_days": 45, "entry_notice": "Not set by state law (Chicago: 2 days)",
           "late_fee_rule": "$20 or 20% of rent over $1,000 (state cap since 2018 for some)", "repair_and_deduct": "Up to $500 or half a month's rent after 14-day notice",
           "rent_increase_notice": "30 days for month-to-month", "notes": "Chicago RLTO adds more protections.", "source_url": "https://www.ilga.gov"},
}
DEPOSIT_MONTHS = {"CA": 1, "NY": 1}


async def seed_static():
    for s in STATE_RULES.values():
        await db.state_rules.update_one({"state": s["state"]}, {"$set": s}, upsert=True)


def lease_text(terms, prop, unit, landlord_name, tenant_name):
    t = terms
    sec = [
        f"RESIDENTIAL LEASE AGREEMENT. This lease is between {landlord_name} (Landlord) and {tenant_name} (Tenant) for {unit['label']} at {prop['address']}, {prop['city']}, {prop['state']} {prop.get('zip', '')}.",
        f"1. TERM. The lease starts on {t['start']} and ends on {t['end']}. After that it continues month to month unless either side gives {t.get('notice_days', 30)} days written notice.",
        f"2. RENT. Rent is {money(t['rent'])} per month, due on day {t.get('due_day', 1)} of each month, paid through Rentwise.",
        f"3. LATE FEE. If rent is more than 5 days late, a late fee of {money(t.get('late_fee', 0))} applies.",
        f"4. SECURITY DEPOSIT. Tenant pays a deposit of {money(t.get('deposit', 0))}. It is returned within the time required by {prop['state']} law, minus lawful deductions.",
        f"5. PETS. {t.get('pets') or 'No pets without written permission from the Landlord.'}",
        f"6. UTILITIES. {t.get('utilities') or 'Tenant sets up and pays electric, gas and internet in their own name.'}",
        "7. REPAIRS. Tenant reports problems through Rentwise. Landlord arranges repairs in a reasonable time. Tenant must not cause damage beyond normal wear and tear.",
        f"8. ENTRY. Landlord may enter with notice as required by {prop['state']} law, except in emergencies.",
        f"9. HOUSE RULES. {prop.get('house_rules') or 'Be considerate of neighbours.'}",
        "10. INSURANCE. Tenant keeps renters insurance during the lease.",
        "11. SIGNATURES. Both parties agree to this lease by typing their names below.",
    ]
    return "\n\n".join(sec), sec


def pdf_bytes(title, lines, footer=None):
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title=title)
    ss = getSampleStyleSheet()
    els = [Paragraph(title, ss["Title"]), Spacer(1, 12)]
    for ln in lines:
        els += [Paragraph(str(ln).replace("&", "&amp;").replace("<", "&lt;"), ss["BodyText"]), Spacer(1, 6)]
    if footer:
        els += [Spacer(1, 18), Paragraph(footer, ss["Italic"])]
    doc.build(els)
    return buf.getvalue()


def doc_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()


# ---------------- sample home ----------------
SAMPLE_COLLS = ["properties", "units", "tickets", "approvals", "payments", "credits", "bank_txns", "expenses", "activity", "leases", "invites", "inspections", "deposit_statements"]


async def wipe_sample(landlord_id):
    sample_users = [u["id"] async for u in db.users.find({"is_sample": True, "sample_owner_id": landlord_id}, NF)]
    for c in SAMPLE_COLLS:
        await db[c].delete_many({"landlord_id": landlord_id})
    threads = [t["id"] async for t in db.threads.find({"landlord_id": landlord_id}, NF)]
    await db.messages.delete_many({"thread_id": {"$in": threads}})
    await db.threads.delete_many({"landlord_id": landlord_id})
    await db.memory_facts.delete_many({"scope_id": {"$in": sample_users}})
    await db.onboarding.delete_many({"tenant_id": {"$in": sample_users}})
    await db.handymen.delete_many({"user_id": {"$in": sample_users}})
    await db.landlord_handymen.delete_many({"landlord_id": landlord_id})
    await db.sessions.delete_many({"user_id": {"$in": sample_users}, "test": {"$ne": True}})
    await db.users.delete_many({"id": {"$in": sample_users}})


async def _user(landlord_id, name, role, email):
    u = {"id": uid(), "email": email, "name": name, "picture": None, "role": role, "is_sample": True, "sample_owner_id": landlord_id, "created_at": iso()}
    await db.users.insert_one(dict(u))
    return u


async def create_sample_home(landlord_id, real_tenant_id=None, real_handyman_id=None):
    from core import tenant_thread, post
    await wipe_sample(landlord_id)
    landlord = await db.users.find_one({"id": landlord_id}, NF)
    tag = landlord_id[:6]
    tom = await _user(landlord_id, "Tom Chen", "tenant", f"tom.{tag}@sample.rentwise")
    maria = await _user(landlord_id, "Maria Lopez", "tenant", f"maria.{tag}@sample.rentwise")
    hank = await _user(landlord_id, "Hank Miller", "handyman", f"hank.{tag}@sample.rentwise")
    rosa = await _user(landlord_id, "Rosa Diaz", "handyman", f"rosa.{tag}@sample.rentwise")
    sam = await _user(landlord_id, "Sam Patel", "handyman", f"sam.{tag}@sample.rentwise")
    for u, trades, rating, cnt, jobs, zp in [(hank, ["plumbing", "general"], 4.8, 23, 1, "95112"), (rosa, ["electrical", "general"], 4.6, 41, 0, "95126"), (sam, ["plumbing", "hvac"], 4.5, 17, 0, "95050")]:
        await db.handymen.insert_one({"user_id": u["id"], "name": u["name"], "trades": trades, "city": "San Jose", "state": "CA", "zip": zp, "phone": "(408) 555-01" + str(cnt),
                                      "rating_avg": rating, "rating_count": cnt, "jobs_done": jobs, "earnings_total": 150.0 if u is hank else 0.0, "is_sample": True, "sample_owner_id": landlord_id})
    await db.landlord_handymen.insert_one({"landlord_id": landlord_id, "handyman_id": hank["id"]})
    pid = uid()
    start_p = prev_period(period_of(), 6)
    prop = {"id": pid, "landlord_id": landlord_id, "name": "Maple House", "address": "12 Maple Ave", "city": "San Jose", "state": "CA", "zip": "95112",
            "timezone": tz_for("CA"), "rental_type": "rooms", "house_rules": "Quiet hours 10 pm–7 am. No smoking inside. Overnight guests up to 3 nights.",
            "utilities": {"electric": "PG&E", "gas": "PG&E", "internet": "Xfinity"}, "photo": "preset:0", "is_sample": True, "created_at": f"{start_p}-01T00:00:00+00:00"}
    await db.properties.insert_one(dict(prop))
    cur = period_of()
    start_p = prev_period(cur, 6)
    units = []
    for label, rent, tenant in [("Room A", 1200, tom), ("Room B", 1250, maria), ("Room C", 1150, None)]:
        u = {"id": uid(), "property_id": pid, "landlord_id": landlord_id, "label": label, "rent": float(rent), "due_day": 1,
             "tenant_id": tenant["id"] if tenant else None, "active_from": start_p if tenant else None, "access_notes": "Side gate code 4412" if tenant else ""}
        await db.units.insert_one(dict(u))
        units.append(u)
    # leases + onboarding
    for u, tn in [(units[0], tom), (units[1], maria)]:
        terms = {"rent": u["rent"], "deposit": u["rent"], "start": f"{start_p}-01", "end": f"{int(start_p[:4]) + 1}{start_p[4:]}-01", "due_day": 1,
                 "pets": "One cat allowed." if tn is tom else "No pets without written permission.", "late_fee": 50, "notice_days": 30,
                 "utilities": "Electric, gas and internet are split between rooms and paid by tenants."}
        text, chunks = lease_text(terms, prop, u, landlord["name"], tn["name"])
        await db.leases.insert_one({"id": uid(), "unit_id": u["id"], "tenant_id": tn["id"], "landlord_id": landlord_id, "terms": terms, "text": text, "chunks": chunks,
                                    "status": "signed", "signatures": [{"role": "tenant", "typed_name": tn["name"], "signed_at": iso()}, {"role": "landlord", "typed_name": landlord["name"], "signed_at": iso()}],
                                    "doc_hash": doc_hash(text), "created_at": iso()})
        full = tn is maria
        await db.onboarding.insert_one({"tenant_id": tn["id"], "lease_signed": True, "insurance": {"done": full, "provider": "Lemonade" if full else "", "policy_no": "LM-22841" if full else ""},
                                        "utilities": {"electric": full, "gas": full, "internet": full}})
        await db.payments.insert_one({"id": uid(), "unit_id": u["id"], "tenant_id": tn["id"], "landlord_id": landlord_id, "period": start_p, "kind": "deposit",
                                      "amount": u["rent"], "date": f"{start_p}-01T18:00:00+00:00", "source": "manual", "status": "recorded"})
    # 6 months rent history (+ Maria paid this month, Tom due)
    for i in range(6, -1, -1):
        p = prev_period(cur, i)
        for u, tn in [(units[0], tom), (units[1], maria)]:
            if i == 0 and tn is tom:
                continue
            day = "02" if tn is tom else "01"
            txn = uid()
            pay = uid()
            await db.payments.insert_one({"id": pay, "unit_id": u["id"], "tenant_id": tn["id"], "landlord_id": landlord_id, "period": p, "kind": "rent",
                                          "amount": u["rent"], "date": f"{p}-{day}T18:00:00+00:00", "source": "bank_sim", "bank_txn_id": txn, "status": "recorded"})
            await db.bank_txns.insert_one({"id": txn, "landlord_id": landlord_id, "date": f"{p}-{day}T18:00:00+00:00", "amount": u["rent"], "sender_name": tn["name"],
                                           "memo": "Rentwise transfer", "status": "matched", "payment_id": pay})
    await db.bank_txns.insert_one({"id": uid(), "landlord_id": landlord_id, "date": iso(now() - timedelta(days=2)), "amount": 60.0, "sender_name": "M LOPEZ ZELLE",
                                   "memo": "utilities share", "status": "review", "payment_id": None})
    # closed March ticket
    yr = now().year if now().month > 3 else now().year - 1
    mt = {"id": uid(), "unit_id": units[0]["id"], "property_id": pid, "tenant_id": tom["id"], "landlord_id": landlord_id, "title": "Kitchen sink leak",
          "description": "Leak under the kitchen sink cabinet.", "trade": "plumbing", "urgency": "normal", "status": "closed", "quote_status": "approved",
          "photos": [], "handyman_id": hank["id"], "quote": 150.0, "approved_amount": 150.0, "final_amount": 150.0, "paid_amount": 150.0, "slots": [],
          "after_photos": [], "tenant_confirmed": True, "rating": 5, "declined_by": [], "summary": "Mar 12 — kitchen sink leak, fixed by Hank, $150, 5★",
          "timeline": [{"at": f"{yr}-03-12T17:00:00+00:00", "text": "Reported by tenant", "actor": "tenant"}, {"at": f"{yr}-03-14T19:00:00+00:00", "text": "Paid Hank Miller $150 (simulated)", "actor": "landlord"}],
          "landlord_taps": 2, "created_at": f"{yr}-03-12T17:00:00+00:00", "fixed_at": f"{yr}-03-14T18:00:00+00:00", "closed_at": f"{yr}-03-14T19:00:00+00:00"}
    await db.tickets.insert_one(dict(mt))
    await db.expenses.insert_one({"id": uid(), "landlord_id": landlord_id, "property_id": pid, "unit_id": units[0]["id"], "ticket_id": mt["id"], "amount": 150.0,
                                  "date": f"{yr}-03-14T19:00:00+00:00", "category": "Repairs", "description": "Kitchen sink leak — Hank Miller", "receipt_path": None})
    await db.memory_facts.insert_one({"id": uid(), "scope": "tenant", "scope_id": tom["id"], "text": "Tom has a friendly cat", "source": "agent", "created_at": iso()})
    for tn in (tom, maria):
        th = await tenant_thread(tn["id"], landlord_id)
        await post(th["id"], f"Hi {tn['name'].split()[0]}, I'm Rentwise — I look after Maple House for {landlord['name'].split()[0]}. Report a problem, ask about rent or your lease any time.")
    await db.activity.insert_one({"id": uid(), "landlord_id": landlord_id, "ticket_id": None, "text": "Sample home ready: Maple House with Tom, Maria and Hank", "kind": "system", "created_at": iso()})
    return {"property_id": pid, "tom": tom["id"], "maria": maria["id"], "hank": hank["id"]}
