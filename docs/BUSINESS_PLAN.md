# KudiTrack AI — Business Plan

**Amaya Technologies** · RC 9587896
No 14, Phase 1, Nyanya Check Point, Nyanya, FCT Abuja, Nigeria · support@kudiai.app
Version 1.0 · September 2026 · Confidential: prepared for investors, grant panels, accelerators and banking partners

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. [The Problem](#2-the-problem)
3. [The Solution: KudiTrack AI](#3-the-solution-kuditrack-ai)
4. [Product and Technology](#4-product-and-technology)
5. [Market Opportunity](#5-market-opportunity)
6. [Customers and Personas](#6-customers-and-personas)
7. [Competitive Landscape and Advantage](#7-competitive-landscape-and-advantage)
8. [Business Model and Pricing](#8-business-model-and-pricing)
9. [Go-to-Market Strategy](#9-go-to-market-strategy)
10. [Operations Plan](#10-operations-plan)
11. [Regulation, Risk, Trust and Security](#11-regulation-risk-trust-and-security)
12. [Management and Organisation](#12-management-and-organisation)
13. [Financial Plan](#13-financial-plan)
14. [Funding Requirement and Use of Funds](#14-funding-requirement-and-use-of-funds)
15. [Milestones and Roadmap](#15-milestones-and-roadmap)
16. [Impact](#16-impact)
17. [Appendices](#17-appendices)

---

## 1. Executive Summary

**KudiTrack AI** is a mobile-first financial operating system for Nigerian small businesses, market traders, Ajo/Esusu collectors, cooperatives and the savers who depend on them. It combines four things that a trader currently juggles across a notebook, a POS agent, a bank app and WhatsApp:

1. **Business books.** Sales, expenses, stock, credit ("who owes me"), invoices, receipts and profit, calculated automatically.
2. **Savings management.** Digital Ajo/Esusu for collectors and their clients, with rotation payouts, contributions, commissions, registration fees, approvals and a client self-service portal.
3. **Money movement.** A tiered, BVN/NIN-verified digital wallet with a dedicated virtual account (via Flutterwave), transfers, withdrawals, and airtime, data, electricity and cable TV payments.
4. **AI in the user's language.** Voice entry of transactions, an AI business assistant and AI insights, available in English, Pidgin, Yoruba, Igbo and Hausa.

The product is **built and running in production**: an Android app (Capacitor) and a web app (React on Vercel) backed by Supabase (Postgres with row-level security and edge functions). The codebase has more than 400 database migrations, server-side guards on every money-moving function, reconciliation jobs, and automated tests on fee, tier and payout logic.

**Revenue** comes from five streams already built into the product: SaaS subscriptions (Free / ₦7,000 / ₦15,000 a month), wallet transfer fees, bill-payment and airtime margins, wholesale airtime and data voucher printing, and partner revenue (in-app ad slots, partner offers and loan-referral fees).

**Distribution** relies on a commissioned field **Marketer network** that already has its own portal and commission engine (5% on registrations and 10% on subscriptions and renewals), together with Ajo collectors and cooperatives, who each bring dozens to hundreds of end-users onto the platform.

**The ask.** We are raising **₦450 million (about US$300,000) in seed funding**, or an equivalent blend of grant and equity, for 30 months of runway. The funds pay for field-sales scale-up in five states, compliance and licensing, the iOS launch, customer support and a working-capital buffer for the wallet. On the base-case plan the company reaches **EBITDA break-even in Year 3**, with **about ₦1.3 billion revenue in Year 3** and **₦6.4 billion by Year 5**.

| Snapshot | |
|---|---|
| Stage | Live product (Android and web), revenue features enabled, entering growth phase |
| Sector | Fintech / SME SaaS / Financial inclusion |
| Primary market | Nigeria: about 39 million MSMEs, most of them informal |
| Business model | Freemium SaaS plus transaction revenue plus partner revenue |
| Ask | ₦450M seed (about US$300k) |
| Break-even | Year 3 (base case) |

---

## 2. The Problem

Nigeria's informal economy runs on cash, memory and trust, and each of these fails the trader in a specific way.

| Pain point | What happens today | Consequence |
|---|---|---|
| **No records** | Sales are kept in exercise books or not at all. Profit is guessed. | Owners mix business and personal money and cannot tell whether they are making money. |
| **Customer credit ("gbese")** | Debts are written on paper and remembered. Reminders are awkward. | Unrecovered debt is a leading cause of stock-outs and business failure. |
| **Ajo/Esusu is manual and risky** | Collectors carry cash, keep cards in a notebook and pay out by memory. | Disputes, theft, loss of records and collector fraud. Savers have no proof. |
| **No credit history** | Banks cannot underwrite businesses that have no data. | Traders are locked out of formal loans and pay predatory rates. |
| **Fragmented tools** | A POS agent for transfers, another app for airtime, WhatsApp for invoices, Excel for stock. | Time lost, fees paid many times over, and no single view of the business. |
| **Language and literacy barriers** | Most fintech apps are English-only and assume people are comfortable filling in forms. | The users with the most need are excluded. |

EFInA's Access to Financial Services survey (2023) reported that about **26% of Nigerian adults remain financially excluded**, and a large share of the "included" use only one basic product. Nigeria's MSMEs, about **39.6 million** according to the SMEDAN/NBS 2021 MSME survey, account for close to half of GDP and most of the country's employment. The gap is not access to a bank account. **It is the lack of a daily tool that makes formal finance useful to a trader.**

---

## 3. The Solution: KudiTrack AI

KudiTrack AI turns a trader's phone into a business manager, a savings bank for their customers, and a payments terminal, and the trader can speak to it in their own language.

**Core value proposition**

- **For the trader:** "Know your profit every day, collect your debts, and grow."
- **For the Ajo collector:** "Run your Ajo like a bank. No cash risk, no disputes, and your commission is calculated for you."
- **For the saver or Ajo client:** "See every naira you've saved, get paid on time, and have proof of it."
- **For the cooperative:** "Members, contributions, loans, polls and chat all in one place."
- **For lenders and partners:** "Verified, transaction-level data on a creditworthy informal segment that you cannot see today."

**Why now**

- The CBN cash-scarcity episodes and the naira redesign pushed millions of traders to accept transfers. They now have digital money but no digital books.
- Smartphone penetration and cheap data are expanding the reachable market every year.
- Tier-based KYC (BVN/NIN) and licensed wallet providers make compliant embedded finance possible for a software company.
- Voice AI and large language models now make usable interfaces in Yoruba, Igbo, Hausa and Pidgin affordable.

---

## 4. Product and Technology

### 4.1 Feature map (built)

| Module | Capabilities |
|---|---|
| **Home dashboard** | Daily cash in and out, today's collection, profit summary, sync status, offers and announcements |
| **Transactions** | Sales, expenses and stock purchases. Voice entry through Whisper speech-to-text. Line items, receipts as PDF or image, CSV and PDF export |
| **Profit engine** | Auditable revenue, COGS, gross and net profit, cash view and Ajo liabilities, each derived from the raw ledger (`src/lib/profitEngine.js`) |
| **Credit tracker** | Customer debts, interest (flat or percentage), repayments, due-today reminders, statements |
| **Inventory** | Products, cost price, low-stock daily sweep, staff-scoped stock views |
| **Invoices** | Branded invoices with logo, bank details, sub-items and extra charges; PDF and WhatsApp sharing; payment tracking |
| **Ajo / Esusu** | Personal savings, group rotation (Esusu) with multi-winner support, cycles, a first-period commission model or a percentage commission model, registration fees, withdrawals with approvals, overdue tracking, reconciliation, archives |
| **Ajo Client Portal** | OTP login, PIN, contribution history, payout status, wallet activation, disputes and goals |
| **Peer Esusu circles** | Self-organised savings circles between peers, with a ledger and payout cycles |
| **Cooperatives / Organisations** | Member management, savings programmes, claims, officer roles and verifiable approvals, group chat, polls, events, media hub, voice rooms, leaderboard |
| **Digital wallet** | Flutterwave virtual account, three KYC tiers, transfers (3 free a day), withdrawals, statements, subscription payment from the wallet, wallet-funded Ajo collection and payout |
| **Bills and VAS** | Airtime, data, electricity and cable TV through ClubKonnect and Peyflex, saved beneficiaries, a server-side payment gate, and voucher printing for wholesale (Premium plan) |
| **Loyalty and rewards** | Points, cashback and coupons (percentage or fixed) with anti-abuse rules |
| **Staff and branches** | Staff and manager roles, branch rosters, shifts, commissions, approvals, disbursements, reconciliation, audit logs, first-login OTP |
| **AI** | AI chat assistant, AI business insights, predictions, daily voice brief (text-to-speech) |
| **Loans** | Business loan application flow (Premium plan), feeding a lending-partner pipeline |
| **Marketer platform** | Affiliate portal, referral attribution, commission engine, payouts, milestones and notifications |
| **Admin portal** | Plans and pricing (live-editable), platform config, approvals, broadcasts, email and SMS centre, support tickets, campaign and ad slots, security and audit readouts |
| **Engagement** | Push notifications (FCM and Web Push), email, SMS and WhatsApp, notification preferences, daily profit push, sales milestones |
| **Trust UX** | Transaction PIN, biometric lock, lock screen, consent management, public receipt verification page |

### 4.2 Technology stack

| Layer | Technology |
|---|---|
| Client | React 18, Tailwind CSS, Capacitor 8 (Android now, iOS next), PWA with service worker and offline IndexedDB, live over-the-air updates |
| Backend | Supabase: Postgres with row-level security, `SECURITY DEFINER` RPCs for all money movement, 20+ Deno edge functions, `pg_cron` jobs |
| Serverless | Vercel API routes (email pipeline, campaigns, captcha verification) |
| Payments and wallet | Flutterwave (virtual accounts, transfers, bills), Paystack (subscriptions and checkout) |
| VAS | ClubKonnect, Peyflex |
| Identity / KYC | BVN/NIN verification through licensed KYC providers (Smile ID, Prembly/Dojah integrations) |
| AI | Google Gemini, OpenAI (including Whisper for voice) |
| Messaging | Firebase Cloud Messaging, SMTP email, SMS and WhatsApp channels |

### 4.3 Engineering quality as a moat

- **Money is moved only by server-side functions.** Client-callable paths were locked down, payment gates check bill purchases on the server, and every fee and commission is idempotent and reconciled.
- **Auditability.** Every profit figure can be traced to the transaction IDs behind it, and daily reconciliation jobs compare wallet and Ajo ledgers.
- **Offline-first.** Records are captured without data and synced later, which matters in markets with poor connectivity.
- **Configurable without a release.** Plans, prices, wallet limits and fees live in the database (`subscription_plans` and `platform_config`), so the business can change pricing the same day.

---

## 5. Market Opportunity

> Figures below are drawn from public sources (SMEDAN/NBS, EFInA, NCC) and rounded. They should be refreshed with the latest releases before external submission.

| Layer | Definition | Size (estimate) |
|---|---|---|
| **TAM** | Nigerian MSMEs (about 39.6M), plus Ajo/Esusu participants and cooperative members | About 40M businesses and tens of millions of savers |
| **SAM** | Smartphone-using micro and small businesses in urban and peri-urban markets that already take transfers | About 10–12M businesses |
| **SOM (5 years)** | Businesses we can reach through marketers, collectors and cooperatives in our target states | **350,000 registered businesses and about 1.2M active wallet users** (about 3% of SAM) |

**Value of the SOM (Year 5, base case):** about ₦6.4 billion a year in revenue (see §13).

**Expansion markets after Year 3:** Ghana (Susu), and other West African markets with rotating savings cultures (Tontine in Francophone Africa), using the same Ajo engine.

---

## 6. Customers and Personas

| Persona | Profile | Jobs to be done | Plan fit |
|---|---|---|---|
| **Mama Nkechi: market trader** | Sells provisions in Nyanya market. Uses a phone mainly for WhatsApp and transfers. Speaks Igbo and Pidgin. | Record sales by voice, see daily profit, chase debtors | Free → Standard |
| **Alhaji Musa: Ajo collector** | Collects daily from 150 traders. Carries cash. Keeps paper cards. | Collect without cash, pay out rotations, earn commission with no disputes | Standard / Premium |
| **Tunde: retail shop owner** | Two shops, four staff | Staff sales, stock control, branches, invoices | Standard / Premium |
| **Mrs Bello: cooperative secretary** | Staff cooperative with 300 members | Contributions, loans, member communication, transparent approvals | Premium (Organisation) |
| **Ajo client or saver** | Artisan, student or trader who saves daily | See balance, receive payout, pay bills | Free (client portal and wallet) |
| **Marketer** | Young graduate or agent earning commission | Onboard businesses and earn recurring commission | Marketer portal |

The **collector and cooperative personas are the growth engine.** Each one brings dozens or hundreds of end-users who then use the wallet, transfers and bill payments.

---

## 7. Competitive Landscape and Advantage

| Category | Examples | What they do well | Gap KudiTrack fills |
|---|---|---|---|
| Agency banking and POS | Moniepoint, OPay, PalmPay | Payments, cash-out, huge agent networks | No bookkeeping, inventory, Ajo management or AI |
| SME commerce tools | Bumpa and other inventory/storefront apps | Online selling, inventory | Not built for Ajo, cooperatives or the informal credit tracker; limited local-language support |
| Personal savings apps | PiggyVest, Cowrywise | Individual savings | Do not digitise the *collector*-led Ajo model or group rotations |
| Bookkeeping apps | Earlier SME ledgers (several have pivoted or shut down) | Simple ledgers | Standalone ledgers struggled to monetise. KudiTrack monetises through wallet, VAS and SaaS together |
| Status quo | Notebook, Excel, WhatsApp, a trusted collector | Free and familiar | No proof, no profit visibility, fraud and loss risk |

**Our sustainable advantages**

1. **An all-in-one product for the informal economy.** Books, Ajo, cooperative, wallet, bills and AI in one app, so a user has fewer reasons to leave.
2. **Collector-led network effects.** One collector brings a whole market, and the clients' wallets bring in transaction revenue.
3. **Local languages and voice.** English, Pidgin, Yoruba, Igbo and Hausa, with voice entry and text-to-speech.
4. **Trust architecture.** Server-enforced money rules, PIN and biometrics, verifiable receipts, approvals and reconciliation, which are the things that make a collector trust a digital Ajo.
5. **Data moat.** Verified transaction history on informal businesses lets us act as an underwriting partner for lenders.
6. **Low cost to serve.** A serverless stack, an offline-first client and live-configurable pricing.

---

## 8. Business Model and Pricing

### 8.1 Subscription plans (live, configurable in admin)

| Plan | Monthly | Yearly | Who it's for | Key inclusions |
|---|---|---|---|---|
| **Kobo (Free)** | ₦0 | ₦0 | New and micro traders | Dashboard, credit tracker, 50 transactions a month, 1 organisation, 5 team members |
| **Naira (Standard)** | ₦7,000 | ₦75,600 (10% off) | Growing businesses and collectors | Unlimited transactions, Ajo (10 groups), PDF reports, staff (10), inventory (500), loyalty, AI insights and chatbot, branches (3), invoices |
| **Oga (Premium)** | ₦15,000 | ₦171,000 (5% off) | Multi-branch businesses, large collectors, cooperatives | Everything in Standard with no limits, plus Organisation/Coop, business loan access, wholesale airtime and data printing, API access, priority support |

Subscriptions can be paid through Paystack or directly from the in-app wallet. Coupons and marketer referral links support promotions.

### 8.2 Transaction and partner revenue

| Stream | Mechanism (as implemented) | Planning assumption |
|---|---|---|
| **Wallet transfer fees** | 3 free transfers a day, then ₦10 per transfer under ₦10,000 and ₦50 at ₦10,000 and above | About ₦12 net per chargeable transfer after provider cost |
| **Bills and airtime** | Margin between provider wholesale price and retail price on airtime, data, electricity and TV. Enterprise bill fee configurable (default 1%) | 2.5% blended net margin |
| **Voucher printing (wholesale)** | Premium users buy airtime and data PINs in bulk to resell | Included in the bills margin |
| **Ajo service revenue** | Businesses earn registration fees and commissions from their clients. The platform earns on the wallet flows these create (collection, payout and withdrawal transfers) | Counted in the wallet and bills lines |
| **Partner and ad revenue** | Admin-managed ad slots (banners, feed cards, popups, tab cards) and partner offers | ₦3M in Year 1 rising to ₦150M in Year 5 |
| **Loan referrals** | Loan applications from Premium users routed to licensed lenders and microfinance banks for a referral or origination fee | Included in partner revenue |

### 8.3 Unit economics (base case, steady state)

| Metric | Value |
|---|---|
| Blended paid ARPU | ≈ ₦9,000 a month (70% Standard / 30% Premium, net of annual discounts) |
| Transaction ARPU per active wallet user | ≈ ₦170–250 a month (transfers plus bills margin) |
| Marketer acquisition cost | 5% of registration value plus 10% of subscription and renewal revenue, with milestone bonuses (fully variable, paid only on revenue) |
| Blended CAC (paid business) | Target ≤ ₦25,000, including field-sales overhead and promotions |
| Gross margin | ≈ 80% on SaaS; 40–60% on transaction revenue |
| Payback | < 4 months on a paid business |
| LTV (paid business, 30-month life, 75% contribution margin) | ≈ ₦200,000, before wallet revenue from that business's clients |
| **LTV : CAC** | **≈ 8:1** |

---

## 9. Go-to-Market Strategy

### 9.1 Beachhead

We start in **FCT Abuja and neighbouring Nasarawa** (our home base, including the Nyanya, Mararaba and Karu markets), then move to **Lagos, Kano, Onitsha/Anambra and Port Harcourt**, which covers the major Yoruba, Hausa, Igbo and Pidgin-speaking trading hubs.

### 9.2 Channels

1. **Marketer network (primary).** Commissioned field agents onboard businesses in person, with the marketer portal tracking attribution, milestones and payouts. Target: 50 active marketers in Year 1, rising to 600 by Year 5.
2. **Ajo collectors and cooperatives (multiplier).** Collectors get free onboarding and training plus a revenue-share incentive for each client who activates a wallet. Each collector brings 50–300 end-users.
3. **Market associations and trade unions.** Group deals and "Market Day" activations with association leaders.
4. **Referral programme.** In-app referral cards with rewards in points and cashback.
5. **Digital and community.** WhatsApp broadcast, TikTok and Instagram short videos in local languages, radio jingles in Pidgin, Hausa and Yoruba.
6. **Partnerships.** Microfinance banks and lenders (loan referrals), FMCG distributors (retailer onboarding), NGOs and development programmes (financial inclusion).

### 9.3 Conversion funnel (targets)

| Step | Target |
|---|---|
| Install → registered business | 60% |
| Registered → active weekly | 45% |
| Free → paid (Year-end) | 6% in Year 1, rising to 12% in Year 5 |
| Paid monthly churn | < 4% |
| Ajo client → wallet activated | 10% in Year 1, rising to 30% in Year 5 |

Built-in drivers of conversion include feature-gated upgrade prompts, the transaction cap on the free plan, AI insights as a hook, and payment from the wallet in a few taps.

---

## 10. Operations Plan

| Function | How it runs |
|---|---|
| **Customer support** | In-app support tickets with awaiting-response tracking, WhatsApp line, priority queue for Premium, AI assistant as first line |
| **Onboarding and KYC** | Self-service in the app, with BVN/NIN verification by tier (Tier 1 Basic, Tier 2 Verified, Tier 3 Fully Verified) |
| **Field operations** | Marketer recruitment, training and weekly performance reviews, with monthly commission payouts through the platform |
| **Finance operations** | Daily wallet and Ajo reconciliation, settlement-account monitoring, provider float management (ClubKonnect and Peyflex balances) |
| **Engineering** | Continuous delivery through Vercel and over-the-air app updates; migrations tracked in version control; read-only diagnostic "readouts" before any production change |
| **Compliance** | Consent records, versioned legal documents, audit logs, data-protection processes aligned with the Nigeria Data Protection Act 2023 |

**Key suppliers:** Flutterwave, Paystack, Supabase, Vercel, ClubKonnect, Peyflex, Google (Gemini, Firebase), OpenAI and KYC providers. Payment and VAS suppliers are integrated through adapters, and a second provider is already wired in for bills, so a switch is possible if a supplier's terms change.

---

## 11. Regulation, Risk, Trust and Security

### 11.1 Regulatory posture

- **Wallet and payments:** accounts are issued and held by a CBN-licensed partner (Flutterwave). KudiTrack operates as a technology provider. Tiered KYC limits mirror CBN tiered-KYC principles (Tier 1: ₦300k maximum balance and ₦100k daily; Tier 2: ₦500k and ₦200k daily; Tier 3: no balance cap and ₦5M daily). All limits can be configured centrally.
- **Data protection:** privacy policy and consent flows are live, and data practices follow the NDPA 2023 and NDPC regulations.
- **Ajo and cooperatives:** the platform records and moves funds on behalf of businesses and cooperatives. It does not pool customer funds on its own balance sheet.
- **Future licensing (Years 2–3):** evaluate a CBN PSSP licence or a partnership with a microfinance bank (MFB) for direct lending and higher margins.

### 11.2 Security and trust controls (implemented)

Row-level security on all tables · money movement only through server functions · transaction PIN (hashed) with lockout · biometric lock · reCAPTCHA · rate limiting · OAuth deep-link guards · HTML sanitisation · storage policy hardening · approval workflows for withdrawals, archives and reactivations · daily reconciliation · audit logs · public receipt verification.

### 11.3 Key risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Low willingness to pay among micro-traders | High | Medium | Generous free tier; monetise through transactions rather than subscriptions alone; pay subscriptions from the wallet |
| Provider dependency or pricing change (wallet, VAS) | Medium | High | Multi-provider adapters (Flutterwave and Paystack; ClubKonnect and Peyflex), live-configurable fees |
| Regulatory change (CBN, NDPC) | Medium | High | Licensed partners, compliance budget, legal counsel, licensing roadmap |
| Fraud (collector, account takeover, bill abuse) | Medium | High | PIN, biometrics, device security, server-side payment gate, approvals, anomaly monitoring |
| Trust barrier to digital Ajo | High | Medium | Verifiable receipts, client portal transparency, collector training, local-language support |
| Competition from large POS networks | Medium | Medium | Focus on the Ajo and cooperative workflow and on bookkeeping depth, which POS players do not serve; partner rather than compete |
| FX-priced AI and cloud costs | Medium | Low | Usage caps by plan, model choice, caching, AI features limited to paid plans |
| Connectivity | High | Low | Offline-first capture and sync |

---

## 12. Management and Organisation

**Company:** Amaya Technologies (RC 9587896), Abuja.

**Current team:** founder-led product and engineering, supported by AI-assisted development and an operating field-marketer programme.

> *Insert founder and key-team bios here: name, role, relevant experience (tech, finance, market or cooperative operations), and prior achievements. Judges weight this section heavily.*

**Hiring plan (funded by the seed round)**

| Role | When | Headcount by Year 2 |
|---|---|---|
| Head of Growth / Field Sales | Month 1 | 1 |
| Regional field leads (Abuja, Lagos, Kano, Onitsha) | Months 1–9 | 4 |
| Customer success and support (multilingual) | Months 1–12 | 5 |
| Backend / mobile engineers (incl. iOS) | Months 2–6 | 3 |
| Compliance and risk officer | Month 3 | 1 |
| Finance and operations lead | Month 4 | 1 |
| Partnerships (lenders, MFBs, FMCG) | Month 6 | 1 |

**Advisory board (target):** a fintech compliance specialist, a microfinance or cooperative-sector leader, and a growth-stage fintech operator.

---

## 13. Financial Plan

> All figures are in Nigerian naira and represent a **base-case illustrative model**. Assumptions are stated explicitly so they can be stress-tested. Update with actual traction data before submission.

### 13.1 Key assumptions

| Assumption | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---|---|---|---|---|
| Registered businesses (year-end) | 15,000 | 50,000 | 120,000 | 220,000 | 350,000 |
| Paid conversion (year-end) | 6% | 8% | 10% | 11% | 12% |
| Blended paid ARPU (₦/month) | 9,000 | 9,000 | 9,000 | 9,000 | 9,000 |
| Business wallets active (% of registered) | 25% | 35% | 45% | 50% | 55% |
| Ajo clients per business (avg) | 4 | 6 | 8 | 9 | 10 |
| Ajo clients with active wallet | 10% | 15% | 20% | 25% | 30% |
| Chargeable transfers per wallet per month | 6 | 6 | 6 | 6 | 6 |
| Net ₦ per chargeable transfer | 12 | 12 | 12 | 12 | 12 |
| Bills spend per wallet user per month (₦) | 4,000 | 5,000 | 6,000 | 6,500 | 7,000 |
| Net bills margin | 2.5% | 2.5% | 2.5% | 2.5% | 2.5% |

Revenue uses the average of opening and closing user counts for each year.

### 13.2 Revenue projection (₦ millions)

| | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---:|---:|---:|---:|---:|
| Paying businesses (year-end) | 900 | 4,000 | 12,000 | 24,200 | 42,000 |
| Active wallet users (year-end) | 9,750 | 62,500 | 246,000 | 605,000 | 1,242,500 |
| Subscriptions | 48.6 | 264.6 | 864.0 | 1,954.8 | 3,574.8 |
| Wallet transfer fees | 4.2 | 31.2 | 133.3 | 367.6 | 798.1 |
| Bills, airtime and vouchers | 5.8 | 54.2 | 277.6 | 829.7 | 1,939.9 |
| Partner, ads and loan referrals | 3.0 | 15.0 | 45.0 | 90.0 | 150.0 |
| **Total revenue** | **61.7** | **365.0** | **1,319.9** | **3,242.2** | **6,462.8** |

### 13.3 Operating costs and EBITDA (₦ millions)

| | Y1 | Y2 | Y3 | Y4 | Y5 |
|---|---:|---:|---:|---:|---:|
| Staff and salaries | 72 | 170 | 380 | 700 | 1,150 |
| Marketer commissions and field sales | 30 | 95 | 260 | 560 | 1,050 |
| Marketing and promotions | 25 | 70 | 180 | 360 | 620 |
| Infrastructure, AI, SMS, KYC and provider costs | 25 | 60 | 160 | 330 | 610 |
| Compliance, legal and licensing | 15 | 30 | 70 | 120 | 200 |
| G&A (office, travel, insurance, misc.) | 13 | 25 | 50 | 130 | 270 |
| **Total opex** | **180** | **450** | **1,100** | **2,200** | **3,900** |
| **EBITDA** | **(118.3)** | **(85.0)** | **219.9** | **1,042.2** | **2,562.8** |
| EBITDA margin | n/m | (23%) | 17% | 32% | 40% |

**Break-even:** monthly EBITDA break-even at about month 28 (mid-Year 3). **Cumulative funding need** to reach break-even is about ₦205M in operating losses, plus a buffer for capex, licensing and wallet working capital. This sets the ₦450M ask.

### 13.4 Scenarios (Year 3 revenue)

| Scenario | Driver changes | Y3 revenue | Break-even |
|---|---|---:|---|
| Conservative | Registrations −40%, conversion 7% | ≈ ₦0.6B | Year 4 |
| **Base** | As above | **≈ ₦1.3B** | **Year 3** |
| Upside | Cooperative and bank partnerships add 2× wallets | ≈ ₦2.0B | Late Year 2 |

---

## 14. Funding Requirement and Use of Funds

**Raising: ₦450,000,000 (≈ US$300,000)**, as seed equity, a SAFE, grant or a blended structure.

| Use | % | ₦M | What it buys |
|---|---:|---:|---|
| Field sales and marketer network | 35% | 157.5 | Regional leads, marketer onboarding and training, market activations in five states |
| Product and engineering | 20% | 90.0 | iOS launch, lending integrations, API for partners, AI in local languages |
| Customer success (multilingual) | 12% | 54.0 | Support team, collector training programmes |
| Compliance, licensing and security | 13% | 58.5 | Legal counsel, NDPA audit, penetration testing, licensing groundwork |
| Wallet and VAS working capital | 10% | 45.0 | Provider float and settlement buffer |
| Contingency and G&A | 10% | 45.0 | 30-month runway protection |

**Investor return thesis:** at 40% EBITDA margins and about ₦6.4B revenue in Year 5, comparable African fintech/SaaS revenue multiples imply significant upside on a seed entry. Credible exit paths include acquisition by a payments company, bank or MFB seeking SME distribution, or a strategic merger in the West African SME-finance market.

---

## 15. Milestones and Roadmap

| Timeline | Milestone |
|---|---|
| **Done** | Android and web apps live; books, credit, inventory, invoices, Ajo/Esusu, cooperatives, wallet (Flutterwave), bills, loyalty, staff and branches, AI assistant, marketer and admin portals; security hardening completed; public privacy and terms pages for Google Play |
| **Q4 2026** | Google Play growth push; Abuja/Nasarawa field launch with 50 marketers; 5,000 registered businesses |
| **Q1 2027** | Seed close; Lagos and Kano launch; first lender partnership for loan referrals |
| **Q2 2027** | iOS app; partner API; collector revenue-share programme |
| **Q4 2027** | 15,000 registered businesses; 900 paying; about 10,000 active wallets |
| **2028** | Onitsha and Port Harcourt; credit scoring from transaction data; cooperative bulk contracts; 50,000 businesses |
| **2029** | EBITDA break-even; licensing decision (PSSP or MFB partnership); Ghana pilot (Susu) |
| **2030–31** | 350,000 businesses and about 1.2M wallet users; embedded lending at scale |

**KPIs tracked monthly:** registrations, weekly active businesses, paid conversion, MRR, churn, wallet activations, transfer and bill volume (GMV), Ajo funds managed, CAC by channel, LTV:CAC, support response time, and fraud-loss rate.

---

## 16. Impact

KudiTrack AI supports **financial inclusion, women's economic empowerment and SME growth**, and aligns with UN SDGs 1 (No Poverty), 5 (Gender Equality), 8 (Decent Work and Economic Growth) and 10 (Reduced Inequalities).

| Impact metric | 5-year target |
|---|---|
| Businesses with digital financial records | 350,000 |
| First-time digital wallet users (Ajo clients and savers) | 800,000+ |
| Share of users who are women | ≥ 55% (market traders and Ajo savers are predominantly women) |
| Users served in a Nigerian language other than English | ≥ 40% |
| Businesses referred to formal credit | 20,000 |
| Field income created (marketers) | 600 active earners |

---

## 17. Appendices

### A. Wallet tier limits (configurable)

| Tier | Requirements | Max balance | Daily limit | Per transfer |
|---|---|---|---|---|
| 1 Basic | Email, phone, BVN or NIN | ₦300,000 | ₦100,000 | ₦50,000 |
| 2 Verified | Full name, address, BVN and NIN | ₦500,000 | ₦200,000 | ₦200,000 |
| 3 Fully Verified | Valid ID, utility bill, passport photo | Unlimited | ₦5,000,000 | ₦5,000,000 |

### B. Marketer commission schedule (configurable)

| Event | Commission |
|---|---|
| Business registration | 5% |
| Subscription (first payment) | 10% |
| Renewal / upgrade (incl. enterprise) | 10% |
| Milestone bonuses | Admin-defined |

### C. Fee schedule

| Item | Fee |
|---|---|
| Wallet deposit | Free |
| Wallet transfer (first 3 each day) | Free |
| Wallet transfer (below ₦10,000) | ₦10 |
| Wallet transfer (₦10,000 and above) | ₦50 |
| Ajo registration fee / commission | Set by each business (taken once from the first deposit; first-period or percentage commission) |

### D. Product evidence

- Source repository: `leonweb48/kudiai-track` (React/Capacitor client, Supabase migrations and edge functions, Vercel API).
- Legal: `legal/terms-and-conditions.md`, `legal/privacy-policy.md`.
- Pricing source of truth: the `subscription_plans` table, with fallbacks in `src/utils/plans.js`.
- Wallet tiers: `src/utils/walletTier.js`. Profit engine: `src/lib/profitEngine.js`.

### E. Before external submission

- [ ] Add founder and team bios, photos and LinkedIn profiles (§12)
- [ ] Replace illustrative projections with actual traction (users, MRR, GMV) to date
- [ ] Refresh market statistics with the latest SMEDAN/NBS, EFInA and NCC releases
- [ ] Attach app screenshots and short demo video links
- [ ] Add letters of intent from cooperatives, market associations or lenders
- [ ] Confirm the website URL in company information
- [ ] Tailor §14 to the specific competition or investor (grant versus equity)
