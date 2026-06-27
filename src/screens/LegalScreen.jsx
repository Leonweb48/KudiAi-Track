/* LegalScreen — full-screen Terms & Conditions and Privacy Policy viewer */

const COMPANY = {
  name:    "AMAYA & Co. Technologies",
  cac:     "RC 9587896",
  address: "No 14, Phase 1, Nyanya Check Point, Nyanya, FCT Abuja, Nigeria",
  email:   "support@kudiai.app",
  updated: "1 July 2026",
};

/* ── Reusable section renderer ───────────────────────────────────────── */
function H2({ children }) {
  return (
    <h2 className="text-[13px] font-black text-slate-900 dark:text-white uppercase tracking-wider mt-7 mb-2 border-b border-slate-200 dark:border-slate-700 pb-1.5">
      {children}
    </h2>
  );
}
function H3({ children }) {
  return (
    <h3 className="text-[12px] font-bold text-slate-800 dark:text-slate-100 mt-4 mb-1.5">
      {children}
    </h3>
  );
}
function P({ children }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400 mb-2">
      {children}
    </p>
  );
}
function UL({ items }) {
  return (
    <ul className="mb-3 space-y-1 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400">
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
function OL({ items }) {
  return (
    <ol className="mb-3 space-y-1 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400">
          <span className="font-bold text-brand-600 dark:text-brand-400 flex-shrink-0 min-w-[18px]">{i + 1}.</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}
function InfoBox({ children }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 mb-4">
      <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">{children}</p>
    </div>
  );
}
function TableRow({ label, value }) {
  return (
    <div className="flex gap-2 py-2 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <p className="text-[11.5px] font-semibold text-slate-700 dark:text-slate-300 min-w-[140px] flex-shrink-0">{label}</p>
      <p className="text-[11.5px] text-slate-500 dark:text-slate-400 flex-1">{value}</p>
    </div>
  );
}
function DataTable({ rows }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-4">
      {rows.map(([label, value], i) => (
        <TableRow key={i} label={label} value={value} />
      ))}
    </div>
  );
}

/* ── Terms & Conditions content ─────────────────────────────────────── */
function TermsContent() {
  return (
    <>
      <InfoBox>
        These Terms constitute a legally binding agreement between you and AMAYA & Co. Technologies, the operator of KudiTrack AI. By creating an account or using any part of the platform — including the mobile app, web app, Admin Portal, or Marketer Portal — you agree to be bound by these Terms. If you do not agree, you must immediately stop using the platform.
      </InfoBox>

      <H2>1. Company Information</H2>
      <DataTable rows={[
        ["Company",   COMPANY.name],
        ["CAC No.",   COMPANY.cac],
        ["Address",   COMPANY.address],
        ["Email",     COMPANY.email],
        ["Effective", COMPANY.updated],
      ]} />
      <P>The platform is developed and operated by AMAYA & Co. Technologies, incorporated under the Companies and Allied Matters Act (CAMA) 2020 of the Federal Republic of Nigeria.</P>

      <H2>2. Definitions</H2>
      <UL items={[
        '"Platform" — the KudiTrack AI app (iOS, Android, web), Admin Portal (admin.kudiai.app), and Marketer Portal in all forms.',
        '"Services" — all features including business management, bill payments, Ajo/Esusu, loyalty programmes, marketer affiliate, and AI insights.',
        '"Account" — your registered user profile.',
        '"Business Owner" — the primary account holder of a business entity.',
        '"Staff Member" — a person invited by a Business Owner to use the platform.',
        '"Ajo/Esusu Client" — a participant in a savings cooperative group on the platform.',
        '"Organisation Member" — a member of a cooperative or association on the platform.',
        '"Marketer" — an affiliate partner earning commission through the Marketer Portal.',
        '"Subscription Plan" — your chosen service tier (Kobo, Naira, or Oga).',
        '"Third-Party Service Providers" — external companies whose services are integrated, including Paystack, ClubKonnect, Peyflex, Anthropic, and Supabase.',
      ]} />

      <H2>3. Eligibility & Account Registration</H2>
      <H3>3.1 Age Requirement</H3>
      <P>You must be at least 18 years old to use the platform. By creating an account, you confirm you are 18 or older.</P>
      <H3>3.2 Accurate Information</H3>
      <P>You must provide accurate, current, and complete information during registration. Providing false or misleading information is a material breach that may result in immediate suspension or termination.</P>
      <H3>3.3 One Account Per User</H3>
      <P>You may only maintain one account per email address. Creating multiple accounts to circumvent restrictions or exploit features is strictly prohibited.</P>
      <H3>3.4 Portal-Specific Access</H3>
      <P>Each email address is bound to a single account type. A Business Owner's email cannot access Staff or Marketer portals and vice versa.</P>
      <H3>3.5 Account Security</H3>
      <P>You are solely responsible for maintaining the confidentiality of your login credentials. Notify us immediately at support@kudiai.app if you suspect unauthorised access. We are not liable for losses arising from your failure to maintain security.</P>
      <H3>3.6 Identity Verification</H3>
      <P>We reserve the right to request identity verification (including NIN) as part of KYC obligations. Failure to comply may result in restriction of services.</P>

      <H2>4. Description of Services</H2>
      <H3>4.1 Business Management Tools</H3>
      <P>Tools for Nigerian small businesses and market traders to manage sales, expenses, inventory, credit records, staff activities, and multi-branch operations. Feature availability depends on your active Subscription Plan.</P>
      <H3>4.2 Bill Payment Services</H3>
      <P>Through Third-Party Service Providers (ClubKonnect and Peyflex), the platform facilitates airtime, data bundles, cable TV (DSTV, GOtv, StarTimes, Showmax), electricity bills across all 12 Nigerian DISCOs, betting wallet top-ups, and education fees (WAEC, JAMB). We act solely as an intermediary and do not guarantee the services of underlying utility or telecom providers.</P>
      <H3>4.3 Ajo/Esusu Savings Group Management</H3>
      <P>Tools to create and manage traditional rotating savings cooperatives. We are not a licensed deposit-taking institution. Funds in Ajo groups are not insured by the NDIC or any other body.</P>
      <H3>4.4 Loyalty Programme</H3>
      <P>A points-based and cashback loyalty system. Points and cashback have no cash value outside the platform and cannot be transferred, sold, or redeemed for cash except as expressly stated. We may modify or terminate the loyalty programme at any time with reasonable notice.</P>
      <H3>4.5 Marketer Affiliate Programme</H3>
      <P>Marketers earn commissions on referred customers. Commission structures, tiers, and payout schedules are governed by the Marketer Programme Terms on the Marketer Portal.</P>
      <H3>4.6 AI-Powered Features</H3>
      <P>The platform integrates Anthropic's Claude AI for business insights, chatbot assistance, and analytics summaries. AI-generated outputs are for informational purposes only and do not constitute financial, legal, or professional advice. Do not rely solely on AI outputs for significant business or financial decisions.</P>

      <H2>5. Subscription Plans & Billing</H2>
      <DataTable rows={[
        ["Kobo (Free)",    "₦0/month — 50 transactions/month, 5 staff, 1 Ajo group, basic features"],
        ["Naira",          "₦7,000/month or ₦75,600/year — Unlimited transactions, 10 staff, AI features, 3 branches"],
        ["Oga",            "₦15,000/month or ₦171,000/year — All Naira features + organisations, loan access, wholesale"],
      ]} />
      <H3>5.1 Billing & Renewal</H3>
      <P>Subscription fees are charged in advance for the selected billing period (monthly or yearly) and auto-renew unless cancelled at least 24 hours before renewal. Payments are processed through Paystack.</P>
      <H3>5.2 Refund Policy</H3>
      <P>Subscription fees are non-refundable except where we terminate your account without cause (pro-rated refund for unused period), where a technical error causes duplicate billing, or as required by Nigerian consumer protection law.</P>
      <H3>5.3 Price Changes</H3>
      <P>We will provide at least 30 days' notice before implementing any price increases.</P>
      <H3>5.4 Coupons</H3>
      <P>Discount coupons are subject to conditions stated at issuance (validity period, eligible plans, maximum uses, one-per-user). Coupons have no cash value and cannot be combined unless stated.</P>

      <H2>6. Bill Payment Terms</H2>
      <H3>6.1 Transaction Irreversibility</H3>
      <P>Bill payment transactions are final and irreversible once processed. You are solely responsible for verifying all transaction details (meter number, phone number, customer ID) before confirming. We accept no liability for incorrect information you provide.</P>
      <H3>6.2 Failed Transactions</H3>
      <P>Where a transaction fails after your account is debited, we will initiate a reversal within 5 business days. Contact support@kudiai.app with your transaction reference if unresolved.</P>
      <H3>6.3 Electricity Tokens</H3>
      <P>Tokens are generated by the relevant Distribution Company (DISCO) and delivered electronically. Delivery times depend on DISCO processing. We are not liable for delays caused by DISCO systems.</P>
      <H3>6.4 Betting Wallet Top-ups</H3>
      <P>This is a convenience service only. We do not endorse betting activities. By using this feature, you confirm you are of legal age under Nigerian law and comply with all applicable regulations.</P>

      <H2>7. Ajo/Esusu Savings Groups</H2>
      <P>The Ajo/Esusu management feature is a record-keeping and coordination tool only. KudiTrack AI does not hold, pool, or custodise funds. We are not a savings bank, microfinance bank, or any type of licensed financial institution. Disputes between Business Owners and Ajo members are entirely between those parties. We expressly disclaim liability for losses suffered by Ajo members arising from Business Owner actions, including misappropriation or fraud.</P>

      <H2>8. Marketer Affiliate Programme</H2>
      <P>Participation is by invitation or approved application only. Marketers must not make false representations about the platform, use spam or deceptive marketing, engage in self-referral, or manipulate the commission system. Violations result in immediate termination and forfeiture of unpaid commissions. Commission earnings may be subject to income tax under Nigerian law; you are solely responsible for declaring and paying applicable taxes.</P>

      <H2>9. Staff Accounts</H2>
      <P>Business Owners are fully responsible for the conduct of all Staff Members added to their account. It is the Business Owner's responsibility to configure appropriate access levels and revoke access immediately when a staff relationship ends.</P>

      <H2>10. Acceptable Use Policy</H2>
      <P>You agree NOT to use the platform to:</P>
      <OL items={[
        "Violate any applicable Nigerian or international law or regulation.",
        "Engage in money laundering, terrorist financing, or any other financial crime.",
        "Process payments for illegal goods, services, or activities.",
        "Impersonate any person, business, or entity.",
        "Attempt to gain unauthorised access to any part of the platform, servers, or databases.",
        "Introduce malware, viruses, ransomware, spyware, or any malicious code.",
        "Use bots, scrapers, or automated tools without written authorisation.",
        "Reverse-engineer, decompile, or disassemble any part of the platform.",
        "Abuse, harass, threaten, or harm other users.",
        "Resell, sublicense, or commercialise access without authorisation.",
        "Manipulate the loyalty programme, referral system, or bill payment processes.",
        "Submit fraudulent bill payment transactions or facilitate payment fraud.",
        "Collect other users' personal data without consent.",
        "Use AI features to generate harmful, discriminatory, fraudulent, or illegal content.",
        "Circumvent rate limits, usage caps, or plan feature restrictions.",
      ]} />

      <H2>11. Data Responsibilities for Business Owners</H2>
      <P>When you enter personal data of third parties (customers, staff, Ajo members, debtors) into the platform, you become a data controller for that data under the Nigeria Data Protection Act (NDPA) 2023. You are solely responsible for obtaining valid consent from those individuals, providing them with notice of how their data is used, and responding to their data rights requests. You agree to indemnify and hold Amaya Technologies harmless from any claims arising from your failure to comply with applicable data protection law.</P>

      <H2>12. Limitation of Liability</H2>
      <P>To the maximum extent permitted by Nigerian law, Amaya Technologies shall not be liable for any loss of profit, revenue, business, data, or goodwill, or for indirect, special, incidental, consequential, or punitive damages arising from your use of the platform.</P>
      <P>Our total aggregate liability for any claims shall not exceed the total subscription fees paid by you in the 3 months immediately preceding the event, or ₦50,000, whichever is lower.</P>
      <P>Nothing herein limits your rights under the Federal Competition and Consumer Protection Act (FCCPA) 2018 or other mandatory Nigerian consumer protection legislation.</P>

      <H2>13. Intellectual Property</H2>
      <P>All intellectual property rights in the platform — including software, design, trademarks, logos, content, and features — are owned by Amaya Technologies or its licensors. We grant you a limited, non-exclusive, non-transferable, revocable licence to use the platform solely for your personal or internal business purposes. You may not copy, modify, distribute, sell, sublicense, or reverse-engineer any part of the platform.</P>

      <H2>14. Suspension & Termination</H2>
      <P>You may terminate your account by contacting support@kudiai.app. We may suspend or terminate your account, with or without notice, for breach of these Terms, suspected fraud or illegal activity, requirement of applicable law, non-payment of subscription fees, or prolonged inactivity (12 consecutive months for free accounts). Upon termination, your access ceases immediately and your data is retained per our Privacy Policy before deletion.</P>

      <H2>15. Governing Law & Dispute Resolution</H2>
      <P>These Terms are governed by the laws of the Federal Republic of Nigeria. Before commencing any formal dispute process, you agree to contact us at support@kudiai.app for good-faith informal resolution (10 business day response). If unresolved after 30 days, either party may refer the dispute to mediation at the Lagos Multi-Door Courthouse (LMDC). If mediation fails within 45 days, disputes shall be referred to binding arbitration under the Arbitration and Conciliation Act, with a single arbitrator, seat in Lagos, Nigeria, language English.</P>

      <H2>16. Changes to These Terms</H2>
      <P>We may update these Terms at any time. Material changes will be communicated by email and in-app notification with at least 7 days' notice. Continued use of the platform after the effective date of updated Terms constitutes acceptance.</P>

      <H2>17. Contact</H2>
      <DataTable rows={[
        ["Company",  `${COMPANY.name} (Legal/Compliance)`],
        ["Email",    COMPANY.email],
        ["Subject",  "Terms and Conditions Enquiry"],
        ["Address",  COMPANY.address],
      ]} />
    </>
  );
}

/* ── Privacy Policy content ──────────────────────────────────────────── */
function PrivacyContent() {
  return (
    <>
      <InfoBox>
        This Privacy Policy is issued pursuant to the Nigeria Data Protection Act (NDPA) 2023, the Nigeria Data Protection Regulation (NDPR) 2019, and guidelines issued by the Nigeria Data Protection Commission (NDPC). By using the KudiTrack AI platform, you acknowledge that you have read and understood this Policy.
      </InfoBox>

      <H2>1. Data Controller Details</H2>
      <DataTable rows={[
        ["Company",  COMPANY.name],
        ["CAC No.", COMPANY.cac],
        ["Address", COMPANY.address],
        ["Email",   COMPANY.email],
        ["Updated", COMPANY.updated],
      ]} />
      <P>We are the data controller for personal data you provide as a registered user. Where Business Owners enter data about their customers, staff, or Ajo members, we act as a data processor on their behalf.</P>

      <H2>2. Who This Policy Applies To</H2>
      <UL items={[
        "Business Owners — primary account holders managing businesses.",
        "Staff Members — persons invited by a Business Owner.",
        "Ajo/Esusu Clients — savings group participants.",
        "Organisation Members — cooperative or association members.",
        "Marketers — affiliate partners using the Marketer Portal.",
        "Website Visitors — persons visiting our web properties without an account.",
        "Third parties whose data Business Owners enter (customers, debtors, next of kin, etc.).",
      ]} />

      <H2>3. Personal Data We Collect</H2>
      <H3>3.1 Data You Provide</H3>
      <P>Registration & Identity:</P>
      <UL items={["Full legal name", "Email address", "Phone number", "Date of birth", "Gender", "Profile photograph", "National Identification Number (NIN) — for KYC"]} />
      <P>Address & Location:</P>
      <UL items={["Home address", "State of residence", "Local Government Area (LGA)", "Ward"]} />
      <P>Business Data (Business Owners):</P>
      <UL items={["Business name and type", "CAC certificate, tax certificate, business licence (where voluntarily uploaded)", "Industry category, business size, operating model", "Business address (state, LGA, ward, street)"]} />
      <P>Financial & Transaction Data:</P>
      <UL items={["Subscription plan tier and billing history", "Bill payment transaction records (amounts, providers, meter numbers, phone numbers)", "Cashback and loyalty points balance and history", "Referral code used or generated", "Bank account details (for Marketer payouts)"]} />

      <H3>3.2 Data Collected Automatically</H3>
      <UL items={[
        "Device type, operating system, browser type and version",
        "IP address",
        "Session data: login/logout times, pages accessed, actions performed",
        "IP-based geolocation (city and country) — for security and fraud detection, not precise GPS",
        "Feature usage patterns and error logs",
      ]} />

      <H3>3.3 Data from Third Parties</H3>
      <UL items={[
        "Paystack — payment confirmation and reference data.",
        "ClubKonnect / Peyflex — bill payment fulfilment status and provider responses.",
        "Google reCAPTCHA — bot risk scores during registration and login.",
        "ipapi.co — IP-based geolocation for session security logging.",
      ]} />

      <H2>4. Legal Basis for Processing</H2>
      <DataTable rows={[
        ["Account registration & auth",        "Performance of contract"],
        ["Subscription billing & payments",    "Performance of contract; legal obligation"],
        ["Bill payment facilitation",          "Performance of contract"],
        ["Loyalty programme",                  "Legitimate interests; performance of contract"],
        ["Marketer commissions & payouts",     "Performance of contract; legal obligation"],
        ["AI insights & chatbot",              "Legitimate interests; consent"],
        ["Security monitoring & fraud",        "Legitimate interests; legal obligation"],
        ["Session logging (IP, device, geo)",  "Legitimate interests (platform security)"],
        ["Customer support",                   "Performance of contract; legitimate interests"],
        ["Transactional emails",               "Performance of contract"],
        ["Promotional emails",                 "Consent"],
        ["Financial records retention",        "Legal obligation (FIRS, CAMA)"],
      ]} />

      <H2>5. How We Use Your Data</H2>
      <UL items={[
        "Creating and managing your account.",
        "Processing subscription payments and renewals.",
        "Facilitating bill payments and delivering transaction receipts.",
        "Managing Ajo/Esusu savings group records.",
        "Enabling loyalty points, cashback, and referral tracking.",
        "Providing AI-powered business insights.",
        "Generating PDF reports and activity statements.",
        "Verifying identity for KYC and fraud prevention.",
        "Monitoring platform security and detecting unauthorised access.",
        "Logging sessions to identify suspicious activity.",
        "Sending transactional emails (OTP, receipts, payment notifications, alerts).",
        "Sending promotional communications (with your consent only).",
        "Responding to your support requests.",
        "Tracking Marketer referrals, commissions, and processing payouts.",
        "Analysing aggregated, anonymised usage patterns to improve features.",
        "Complying with Nigerian law and regulatory requests.",
      ]} />

      <H2>6. Data Sharing & Disclosure</H2>
      <P>We do not sell your personal data. We share it only in the following circumstances:</P>
      <H3>6.1 Third-Party Service Providers (Processors)</H3>
      <DataTable rows={[
        ["Supabase",         "Cloud database, authentication, storage, backend — Global (EU/US)"],
        ["Paystack",         "Subscription payment processing — Nigeria"],
        ["ClubKonnect",      "Bill payment fulfilment (airtime, data, utilities) — Nigeria"],
        ["Peyflex",          "Supplementary bill payment services — Nigeria"],
        ["Anthropic (Claude)", "AI chatbot and insights — United States"],
        ["Google (reCAPTCHA)", "Bot detection and security — Global"],
        ["OpenAI (Whisper)", "Speech-to-text transcription (where enabled) — United States"],
        ["ipapi.co",         "IP geolocation for session logs — Global"],
      ]} />
      <H3>6.2 Legal & Regulatory Disclosures</H3>
      <P>We may disclose personal data to government authorities, regulators, courts, or law enforcement where required by applicable Nigerian law, or to protect the rights, property, or safety of Amaya Technologies, our users, or the public.</P>
      <H3>6.3 Business Transfer</H3>
      <P>In the event of a merger, acquisition, or sale, personal data may be transferred to the acquirer or successor. We will notify you of any such transfer.</P>

      <H2>7. International Data Transfers</H2>
      <P>Some Third-Party Service Providers — including Anthropic (US), Supabase (EU/US), and Google (Global) — are located outside Nigeria. When we transfer your personal data outside Nigeria, we ensure adequate safeguards are in place per the NDPA 2023 and NDPC guidelines, including binding contractual data protection obligations.</P>

      <H2>8. Data Retention</H2>
      <DataTable rows={[
        ["Account & identity data",     "Duration of account + 7 years after closure"],
        ["Financial transaction records", "7 years from transaction date (CAMA/FIRS requirement)"],
        ["Bill payment records",        "5 years from transaction date"],
        ["Session logs (IP, device)",   "12 months"],
        ["Support communications",      "3 years from resolution"],
        ["Marketing consents",          "Until withdrawn + 3 years"],
        ["AI interaction logs",         "6 months"],
        ["Deleted account data",        "Anonymised within 30 days; audit trail retained 7 years"],
      ]} />

      <H2>9. Your Data Rights</H2>
      <P>Under the Nigeria Data Protection Act 2023, you have the following rights:</P>
      <UL items={[
        "Right of Access — request a copy of the personal data we hold about you.",
        "Right to Rectification — request correction of inaccurate or incomplete data.",
        "Right to Erasure — request deletion of your data where no longer necessary or where consent is withdrawn.",
        "Right to Restriction — request that we pause processing of your data in certain circumstances.",
        "Right to Data Portability — receive your data in a structured, machine-readable format.",
        "Right to Object — object to processing based on legitimate interests or for direct marketing.",
        "Right to Withdraw Consent — withdraw consent at any time without affecting prior processing.",
      ]} />
      <P>To exercise any right, email support@kudiai.app with subject "Data Rights Request". We will respond within 30 days. You may also escalate complaints to the Nigeria Data Protection Commission (NDPC) at ndpc.gov.ng.</P>

      <H2>10. Data Security</H2>
      <P>Technical measures include TLS/HTTPS encryption in transit, AES-256 encryption at rest via Supabase, Row-Level Security (RLS) policies, JWT authentication with secure cookie storage, two-factor authentication for Admin and Marketer portals, reCAPTCHA v3 bot protection, and automated session logging for anomaly detection.</P>
      <P>In the event of a data breach that poses a risk to your rights, we will notify you and the NDPC within 72 hours of becoming aware.</P>

      <H2>11. Business Owners & Third-Party Data</H2>
      <P>When Business Owners use credit management, Ajo/Esusu, staff management, or loyalty features, they may enter personal data about their customers and members. Amaya Technologies acts as a data processor for this data — storing and processing it only on the Business Owner's instructions to provide the Services. Business Owners are responsible for obtaining valid consent from and providing notice to those data subjects, and for responding to their data rights requests.</P>

      <H2>12. AI & Automated Decision-Making</H2>
      <P>AI services (Anthropic Claude) process your transaction data and usage patterns to generate business insights and chatbot responses. We do not make legally significant automated decisions without human review — AI outputs are advisory only. When you use AI features, relevant contextual data is sent to Anthropic's API. For voice input features (OpenAI Whisper, where enabled), audio is transmitted to OpenAI for transcription; avoid including highly sensitive information such as passwords or bank PINs in voice inputs.</P>

      <H2>13. Children's Privacy</H2>
      <P>The platform is not directed at children under 18 years of age. We do not knowingly collect personal data from anyone under 18. If you believe a child under 18 has created an account, please notify us at support@kudiai.app.</P>

      <H2>14. Marketing Communications</H2>
      <P>We send transactional communications (OTPs, receipts, alerts) without separate consent as necessary to perform our contract with you. Promotional emails and product updates are only sent with your consent. You may opt out at any time by clicking "Unsubscribe" in any marketing email or by updating notification preferences in the platform.</P>

      <H2>15. Changes to This Policy</H2>
      <P>We may update this Privacy Policy at any time. Material changes will be notified by email to your registered address and by in-app notice. Continued use of the platform after the effective date constitutes acceptance. If you do not accept, you must stop using the platform.</P>

      <H2>16. Contact</H2>
      <DataTable rows={[
        ["Company",  `${COMPANY.name} — Data Protection`],
        ["Email",    COMPANY.email],
        ["Subject",  "Privacy/Data Protection Matter"],
        ["Address",  COMPANY.address],
        ["Regulator", "Nigeria Data Protection Commission (NDPC) — ndpc.gov.ng"],
      ]} />
    </>
  );
}

/* ── Shared back-arrow icon ─────────────────────────────────────────── */
function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

/* ── Main exported component ─────────────────────────────────────────── */
export default function LegalScreen({ type, onBack }) {
  const isTerms = type === "terms";
  const title   = isTerms ? "Terms & Conditions" : "Privacy Policy";

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-slate-900 flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700/60 flex items-center gap-3 px-4 py-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95 flex-shrink-0"
          aria-label="Back"
        >
          <BackArrow />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-slate-900 dark:text-white truncate">{title}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">AMAYA & Co. Technologies · Effective {COMPANY.updated}</p>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pb-16 pt-4 max-w-2xl mx-auto">
          {/* Version badge */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] font-bold bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 px-2.5 py-1 rounded-full uppercase tracking-wide">
              {isTerms ? "Terms & Conditions" : "Privacy Policy"} · Version 1.0
            </span>
          </div>

          {isTerms ? <TermsContent /> : <PrivacyContent />}

          {/* Footer */}
          <div className="mt-8 pt-5 border-t border-slate-200 dark:border-slate-700 text-center">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              © 2026 AMAYA & Co. Technologies · RC 9587896{"\n"}
              KudiTrack AI is a product of AMAYA & Co. Technologies
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Questions? Email{" "}
              <span className="text-brand-600 dark:text-brand-400 font-medium">support@kudiai.app</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
