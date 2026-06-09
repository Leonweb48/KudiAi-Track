/* App FAQ and general business knowledge base — multilingual */

export const APP_PAT = [
  { key: "overview",     hits: ["what can the app","app feature","app overview","about the app","app guide","getting started","what does the app","kuditrack feature","wetin app fit","menene app","what kuditrack"] },
  { key: "transactions", hits: ["how to record","how to add transaction","how to add sale","how do i add","add a transaction","record a sale","how to enter","add transaction","yadda ake rikodi","etu esi edekọ","bii a ṣe gba akọọlẹ"] },
  { key: "credit",       hits: ["how to use credit","how does credit tracker","credit tracker how","how to track debt","how credit works","how to add credit customer","yadda ake bibiyar bashi","etu esi eji ịchọpụta"] },
  { key: "ajo",          hits: ["how to use ajo","how does ajo work","ajo tutorial","ajo guide","how to set up ajo","how does esusu work","aso savings guide","yadda ake amfani da aso","etu esi eji aso"] },
  { key: "inventory",    hits: ["how to use inventory","how does inventory work","inventory guide","how to track stock","inventory tutorial","how to add product","yadda ake kayan ajiya","etu esi eji ngwaahịa"] },
  { key: "reports",      hits: ["how to generate report","how to create report","how to make report","how to export","report guide","generate pdf","how to get pdf","yadda ake rahoto","etu esi emepụta akụkọ"] },
  { key: "staff",        hits: ["how to add staff","how to manage staff","staff guide","add a staff","staff management how","yadda ake ma'aikata"] },
  { key: "aiAssist",     hits: ["how to use the ai","how does the ai","ai guide","ai tutorial","how to use ai","ai assistant how"] },
  { key: "premium",      hits: ["how much","subscription price","upgrade to premium","premium plan","pricing plan","plan cost","what does premium","how to upgrade","subscription cost"] },
];

export const BIZ_PAT = [
  { key: "pricing",       hits: ["pricing strategy","how to price","set my price","price my goods","pricing tip","pricing advice","how much to charge","price strategy","price my product"] },
  { key: "cashFlow",      hits: ["cash flow","manage my cash","money management","cash management","improve cash flow","business cash","sarrafa kuɗi"] },
  { key: "profitMargin",  hits: ["profit margin","calculate my profit","gross profit","markup","margin tip","margin advice","what is margin","how to calculate margin","profit calculation"] },
  { key: "growth",        hits: ["how to grow","grow my business","increase my sales","business growth","business tips","grow business","expand business","improve business","entrepreneur tip","business advice"] },
  { key: "bookkeeping",   hits: ["bookkeeping","record keeping","accounting tip","how to keep record","keep my records","financial record","business records","ledger"] },
  { key: "creditMgmt",    hits: ["manage credit customer","manage my debtors","handle debtors","credit management tip","debt collection tip","credit advice","handle credit","manage debt"] },
  { key: "inventoryTips", hits: ["inventory tip","stock tip","stock advice","inventory advice","how to manage my stock","stock management tip","inventory management tip"] },
  { key: "ajoBenefits",   hits: ["why use ajo","ajo benefit","esusu benefit","thrift tip","thrift benefit","ajo advice","why ajo"] },
  { key: "nigeria",       hits: ["business registration","register my business","cac registration","nigeria tax","vat nigeria","vat rate","firs nigeria","tax nigeria","business compliance"] },
];

/* ── App FAQ responses ── */
export const APP_FAQ = {
  en: {
    overview:
`**KudiAI Track** is your complete Nigerian business management app. Here's what you can do:

📊 **Transactions** — Record all sales (Cash In) and expenses (Cash Out) instantly
💳 **Credit Tracker** — Track customers who buy on credit; send WhatsApp payment reminders
🏦 **Ajo Savings** — Manage rotating savings (Ajo/Esusu/Adashi) groups for your clients
📦 **Inventory** — Track stock levels, get low-stock alerts, monitor profit margins per product
🤖 **AI Business Assistant** — Ask about your sales, credit, and stock in English, Pidgin, Hausa, Igbo, or Yoruba
📄 **PDF Reports** — Generate and share professional business reports instantly
👥 **Staff Management** — Add staff with specific roles (cashier, manager); they get their own login
🔔 **Notifications** — Automatic alerts for overdue credit and missed Ajo contributions

Ask me **"how to use [feature]"** for step-by-step guides on any of these!`,

    transactions:
`**How to record a transaction:**

1. Tap **Transactions** in the bottom nav
2. Tap **+ Cash In** for a sale, or **+ Cash Out** for an expense
3. Fill in: item name, amount, customer name (optional)
4. Tap **Save** — done!

💡 **Tips:**
• Add a customer name to track your top buyers automatically
• Set unit price + quantity for automatic total calculation
• If the item exists in your Inventory, stock auto-deducts on each sale
• Use the filter chips (All / Cash In / Cash Out) to review specific entries`,

    credit:
`**How to use Credit Tracker:**

1. Go to the **Credit** tab
2. Tap **+** to add a new credit customer
3. Enter: customer name, amount owed, and due date
4. When they pay, tap their card → **Record Payment** to update the balance

💡 **Features:**
• Accounts are automatically marked overdue after the due date passes
• Daily alerts remind you to follow up on unpaid credit
• WhatsApp reminder button lets you send instant payment messages
• Tap any customer card to see their full payment history`,

    ajo:
`**How to use Ajo Savings:**

1. Go to the **Ajo** tab
2. Tap **+** to add a client to your savings group
3. Set their contribution amount and frequency (daily / weekly / monthly)
4. When they contribute, tap **Collect** to update their balance

**What is Ajo?**
Ajo (also called Esusu, Adashi, or thrift) is a traditional Nigerian rotating savings group where members contribute regularly and each person takes a turn collecting the full pot. KudiAI Track helps you track every contribution and payout automatically.`,

    inventory:
`**How to use Inventory / Stock:**

1. Go to the **Stock** tab
2. Tap **+** to add a product (name, cost price, selling price, quantity)
3. When you record a sale for that item, stock quantity auto-deducts
4. You'll get alerts when any product hits its low-stock threshold

💡 **Features:**
• See total stock value at both cost price and retail price
• Track profit margin per product automatically
• View full movement history — sales, restocks, and adjustments
• Set custom low-stock alert thresholds per product`,

    reports:
`**How to generate reports:**

1. Go to the **Insights** tab → tap **Reports** (top-right button)
2. Choose your period (Today / Week / Month)
3. Tap **Generate** — a professional PDF is created instantly
4. Share via WhatsApp or email, or download to your phone

**Available report types:**
• Sales & revenue summary
• Expense breakdown
• Profit & loss statement
• Credit & receivables summary
• Inventory valuation`,

    staff:
`**How to manage staff:**

1. Go to **Settings** → **Staff Management**
2. Tap **+ Add Staff**, enter their name and contact details
3. They receive an invite to create their own login
4. Set their role and they're ready

**Staff roles:**
• **Cashier** — Can record transactions only
• **Manager** — Can view reports and manage inventory
• **Owner** — Full access to all features (you)

Staff management requires the **Premium plan**.`,

    aiAssist:
`**How to use the AI Business Assistant:**

1. Go to **Insights** tab → tap **Open Chat** on the AI card
2. Ask anything — in your language!

**What you can ask:**
• "How were today's sales?" — revenue & profit
• "Show my outstanding credit" — unpaid debts
• "Who are my top customers?" — ranked buyer list
• "What are my best sellers?" — top items by revenue
• "How can I grow my business?" — general business advice
• "How to use inventory?" — app feature guide

Supports **English, Pidgin, Hausa, Igbo, and Yoruba** — language is detected automatically from how you type. You can also tap the 🎤 mic button to ask by voice!`,

    premium:
`**KudiAI Track Plans:**

🆓 **Starter (Free)**
• Up to 30 transactions/month
• Credit tracking (up to 5 records)
• Ajo savings management
• Basic reports

✨ **Premium — ₦5,000/month**
• Unlimited transactions
• Unlimited credit records
• Advanced AI business insights
• Full inventory management
• PDF report generation
• Staff management (multiple logins)
• Priority support

To upgrade: **Settings** → **Premium** → choose your plan.`,
  },

  pidgin: {
    overview:
`**KudiAI Track** na your complete business app for Nigeria. This na wetin you fit do:

📊 **Transactions** — Record all your sales and expenses quick quick
💳 **Credit Tracker** — Track customers wey dey buy on credit; send WhatsApp reminder
🏦 **Ajo Savings** — Manage your Ajo/Esusu savings group
📦 **Inventory** — Track your stock, know when product dey finish, see profit margin
🤖 **AI Assistant** — Ask about your sales, credit, and stock for any Nigerian language
📄 **PDF Reports** — Generate and share professional business reports
👥 **Staff Management** — Add staff with their own login and roles (Premium)
🔔 **Notifications** — Alert for overdue credit and Ajo payment wey dem miss

Ask me **"how to use [feature]"** for step-by-step guide!`,

    transactions:
`**How to record transaction:**

1. Tap **Transactions** for the bottom nav
2. Tap **+ Cash In** for sale, **+ Cash Out** for expense
3. Put item name, amount, customer name
4. Tap **Save** — e don finish!

💡 **Tips:**
• Add customer name make you track your best buyers
• Put unit price and quantity for automatic calculation
• If item dey your inventory, e go reduce stock automatic when you sell
• Use filter chips — All / Cash In / Cash Out — to check specific entries`,

    credit:
`**How to use Credit Tracker:**

1. Go to **Credit** tab
2. Tap **+** add new credit customer
3. Put customer name, amount dem owe, and due date
4. When dem pay, tap their card → **Record Payment** update the balance

💡 **Features:**
• App go mark accounts overdue after due date pass
• Daily alert go remind you follow up on unpaid credit
• WhatsApp reminder button — send payment message with one tap
• Tap customer card see their full payment history`,

    ajo:
`**How to use Ajo Savings:**

1. Go to **Ajo** tab
2. Tap **+** add client to your savings group
3. Set their contribution amount and frequency
4. When dem contribute, tap **Collect** update their balance

**Wetin be Ajo?**
Ajo (or Esusu, Adashi, thrift) na traditional Nigerian savings system where members dey contribute regular and dem take turns collect the full pot. KudiAI Track help you track every contribution and payout.`,

    inventory:
`**How to use Inventory / Stock:**

1. Go to **Stock** tab
2. Tap **+** add product — name, cost price, selling price, quantity
3. When you sell that item, stock go reduce automatic
4. You go receive alert when product dey finish

💡 **Features:**
• See total stock value (cost price and retail price)
• Track profit margin per product automatic
• View movement history — sales, restock, adjustments
• Set your own low-stock alert level per product`,

    reports:
`**How to generate reports:**

1. Go to **Insights** tab → tap **Reports** (top right)
2. Choose your period — Today / Week / Month
3. Tap **Generate** — e go create professional PDF
4. Share am via WhatsApp or email, or download

**Report types:**
• Sales and revenue summary
• Expense breakdown
• Profit and loss
• Credit summary
• Inventory valuation`,

    staff:
`**How to manage staff:**

1. Go **Settings** → **Staff Management**
2. Tap **+ Add Staff** put their details
3. Dem go receive invite create their own login
4. Set their role — dem don ready

**Staff roles:**
• **Cashier** — fit record transactions
• **Manager** — fit view reports and manage inventory
• **Owner** — you, full access

Staff management na Premium feature.`,

    aiAssist:
`**How to use AI Business Assistant:**

1. Go **Insights** tab → tap **Open Chat** for AI card
2. Ask anything — for your language!

**Wetin you fit ask:**
• "How today sales go?" — revenue and profit
• "Show credit wey dem never pay" — unpaid debt
• "Which customer dey buy pass?" — top buyers
• "Which item dey sell pass?" — best sellers
• "How I fit grow my business?" — business advice
• "How to use inventory?" — app guide

Support **English, Pidgin, Hausa, Igbo, and Yoruba** — e go detect your language automatic. You fit also tap 🎤 mic button ask by voice!`,

    premium:
`**KudiAI Track Plans:**

🆓 **Starter (Free)**
• Up to 30 transactions/month
• Credit tracking (up to 5 records)
• Ajo savings management
• Basic reports

✨ **Premium — ₦5,000/month**
• Unlimited transactions
• Unlimited credit records
• Advanced AI insights
• Full inventory management
• PDF reports
• Staff management
• Priority support

To upgrade: **Settings** → **Premium** → choose plan.`,
  },

  ha: {
    overview:
`**KudiAI Track** shine cikakken app ɗin kasuwanci na Najeriya. Ga abin da zaka iya yi:

📊 **Ma'amaloli** — Rikodin siyarwa da kashe-kashe cikin sauri
💳 **Bibiyar Bashi** — Bibiyar abokan ciniki masu siye da bashi; aika tunatarwa ta WhatsApp
🏦 **Aso** — Gudanar da ƙungiyoyin ajiyar Aso/Esusu/Adashi
📦 **Kayan Ajiya** — Bibiyar kaya, sanarwa kan ƙarancin kaya, riba kowane kaya
🤖 **AI** — Tambaya game da siyarwa, bashi, da kaya cikin harshena
📄 **Rahoto** — Ƙirƙirar rahotoni na ƙwararru a matsayin PDF
👥 **Ma'aikata** — Ƙara ma'aikata masu logins ɗinsu (Premium)
🔔 **Sanarwa** — Faɗakarwa ta atomatik game da bashi da Aso

Tambaya **"yadda ake amfani da [fasali]"** don ƙarin bayani!`,

    transactions:
`**Yadda ake yin rikodin ma'amala:**

1. Taɓa **Ma'amaloli** don nav ɗin ƙasa
2. Taɓa **+ Kuɗin Shiga** don siyarwa, ko **+ Kuɗin Fita** don kashe
3. Rubuta: suna kaya, adadi, sunan abokin ciniki
4. Taɓa **Ajiye** — an gama!

💡 Ƙara sunan abokin ciniki don bibiyar manyan masu sayan ku. Sanya farashin kaya da yawa don ƙididdiga ta atomatik.`,

    credit:
`**Yadda ake amfani da Bibiyar Bashi:**

1. Je zuwa shafin **Bashi**
2. Taɓa **+** ƙara sabbin abokan ciniki masu bashi
3. Saka: sunan abokin ciniki, adadi, kwanan biyan
4. Lokacin da suka biya, taɓa **Rikodin Biyan** sabunta ma'auni

Akwati yana alamar wuce lokaci ta atomatik bayan kwanan biyan ya wuce. Maɓallin WhatsApp yana bawa ku damar aika tunatarwa cikin sauƙi.`,

    ajo:
`**Yadda ake amfani da Ajiyar Aso:**

1. Je zuwa shafin **Aso**
2. Taɓa **+** ƙara abokin ciniki cikin ƙungiyar ajiyar ku
3. Sanya adadin gudummawar su da lokaci (yau / mako / wata)
4. Lokacin da suka ba da gudummawa, taɓa **Tattara** sabunta ma'aunin su

Aso/Esusu/Adashi tsarin ajiyar gargajiya ne inda mambobinsa ke gudummawa akai-akai. KudiAI Track yana bibiyar kowane gudummawa da cirewa.`,

    inventory:
`**Yadda ake amfani da Kayan Ajiya:**

1. Je zuwa shafin **Kaya**
2. Taɓa **+** ƙara kaya — suna, farashin siyan, siyarwa, da yawa
3. Lokacin siyar da kayan, yawa ta ɓata ta atomatik
4. Za ka sami sanarwa lokacin da kayan suka ƙarewa

Ana nuna jimlar ƙimar kaya, riba kowane kaya, da tarihin motsi (siyarwa, sake siya, gyara).`,

    reports:
`**Yadda ake ƙirƙirar rahotoni:**

1. Je zuwa **Bayani** → taɓa **Rahoto** (saman dama)
2. Zaɓi lokaci — Yau / Mako / Wata
3. Taɓa **Ƙirƙira** — an ƙirƙiri PDF na ƙwararru
4. Raba ta WhatsApp ko imel, ko zazzagewa

Nau'in rahotoni: tallace-tallace, kashe-kashe, riba da asara, bashi, ƙimar kayan ajiya.`,

    staff:
`**Yadda ake gudanar da ma'aikata:**

1. Je **Saiti** → **Gudanar Da Ma'aikata**
2. Taɓa **+ Ƙara Ma'aikaci** saka bayanansu
3. Za su sami gayyata don ƙirƙirar login ɗinsu
4. Sanya muƙaminsu — suna shirye

Muƙamai: Ma'aikacin Akwatin (rikodawa kawai), Manaja (rahotoni da kaya), Mai Gida (cikakken damar shiga). Wannan fasalin na Premium ne.`,

    aiAssist:
`**Yadda ake amfani da AI Business Assistant:**

1. Je **Bayani** → taɓa **Buɗe Tattaunawa** a kan AI card
2. Tambaya komai — a cikin harshena!

Misalai: "Yaya tallacen yau?", "Nuna bashin da ya rage", "Wace kaya ta fi siyarwa?", "Yadda ake girma kasuwanci?"

Yana goyan bayan **Turanci, Pidgin, Hausa, Igbo, da Yoruba** — yana gano harshena ta atomatik. Hakanan za ka iya taɓa maɓallin 🎤 don tambaya da murya!`,

    premium:
`**Tsarin KudiAI Track:**

🆓 **Kyauta (Starter)** — har ma'amala 30/wata, bibiyar bashi (har rikodin 5), Aso, rahotoni na yau da kullum

✨ **Premium — ₦5,000/wata** — ma'amala mara iyaka, rikodin bashi mara iyaka, AI mai zurfi, gudanar da kayan ajiya, rahotoni PDF, gudanar da ma'aikata

Don haɓaka: **Saiti** → **Premium** → zaɓi tsari.`,
  },

  ig: {
    overview:
`**KudiAI Track** bụ ngwa azụmaahịa zuru oke gị nke Naịjịrịa. Nke a bụ ihe ị nwere ike ime:

📊 **Azụmaahịa** — Dee ahịa na ihe ejiri ego ozugbo
💳 **Ịchọpụta Ugwọ** — Soro ndị ahịa zụtara n'ugwọ; zipu ọkwa WhatsApp
🏦 **Aso** — Jikwa otu nchekwa Aso/Esusu/Adashi gị
📦 **Ngwaahịa** — Soro ọnụọgụ ngwaahịa, nweta ịdọ aka na ntị, hụ uru kwa ngwaahịa
🤖 **AI** — Jụọ maka ahịa, ugwọ na ngwaahịa n'asụsụ gị
📄 **Akụkọ** — Mepụta akụkọ azụmaahịa nke ọma dị ka PDF
👥 **Ndị Ọrụ** — Tinye ndị ọrụ nwere ọrụ ha na nbanye ha (Premium)
🔔 **Ọkwa** — Ịdọ aka na ntị akọwa maka ugwọ na Aso

Jụọ **"etu esi eji [ihe]"** maka ntuziaka!`,

    transactions:
`**Etu esi edekọ azụmaahịa:**

1. Pịa **Azụmaahịa** na nav ala
2. Pịa **+ Ego Na-abata** maka ire, ma ọ bụ **+ Ego Na-apụ** maka ihe ejiri ego
3. Tinye: aha ihe, ego, aha ndị ahịa
4. Pịa **Chekwaa** — ọ bụ ya!

💡 Tinye aha ndị ahịa iji soro ndị ahịa kacha mma gị. Tọọ ọnụahịa otu na ọnụọgụ maka ọgwụgwọ akọwa. Ọ bụrụ na ihe dị n'ọchịchọ, ọ ga-ebelata ngwaahịa akọwa.`,

    credit:
`**Etu esi eji Ịchọpụta Ugwọ:**

1. Gaa na tab **Ugwọ**
2. Pịa **+** tinye ndị ahịa ugwọ ọhụrụ
3. Tinye: aha, ego ha ji, na ụbọchị ịkwụ
4. Mgbe ha kwụọ, pịa **Dee Ịkwụ Ụgwọ** melite ọnọdụ

Akọọlẹ na-egosi ugwọ agafeela oge akọwa. Ịdọ aka na ntị kwa ụbọchị na-akọwa gị iji soro ugwọ. Bọtịnị WhatsApp na-eme ka ị zipu ọkwa ịkwụ ozugbo.`,

    ajo:
`**Etu esi eji Nchekwa Aso:**

1. Gaa na tab **Aso**
2. Pịa **+** tinye onye ahịa na otu nchekwa gị
3. Tọọ ọnụego ntinye na mgbe ugboro
4. Mgbe ha tinyere, pịa **Nweta** melite ọnọdụ ha

Aso/Esusu/Adashi bụ ihe nchekwa ọmenala Naịjịrịa ebe ndị otu na-etinye ugboro ugboro ma ha na-ewe ego mgbe ọ dị ha. KudiAI Track na-esoro ntinye na iwepụ niile.`,

    inventory:
`**Etu esi eji Ngwaahịa/Stock:**

1. Gaa na tab **Ngwaahịa**
2. Pịa **+** tinye ngwaahịa — aha, ọnụahịa ọnụ, ire, ọnụọgụ
3. Mgbe ị ree ihe ahụ, ọnụọgụ ngwaahịa ga-ebelata akọwa
4. Ị ga-enweta ịdọ aka na ntị mgbe ngwaahịa acha

Nrụpụta na-egosi ọnụ ego ngwaahịa niile, uru kwa ngwaahịa, na akụkọ nke mmegharị ya.`,

    reports:
`**Etu esi emepụta akụkọ:**

1. Gaa **Ihe Ọmụma** → pịa **Akụkọ** (n'aka nri elu)
2. Họọ oge — Taa / Izu / Ọnwa
3. Pịa **Mepụta** — PDF dị mma na-emepụtacha
4. Kesaa na WhatsApp ma ọ bụ email, ma ọ bụ budata

Ụdị akụkọ: nchịkọta ahịa, mbibi ihe ejiri ego, ọganihu na ọghọm, ugwọ, ọnụ ego ngwaahịa.`,

    staff:
`**Etu esi ejikwa ndị ọrụ:**

1. Gaa **Ntọala** → **Njikwa Ndị Ọrụ**
2. Pịa **+ Tinye Onye Ọrụ**, tinye nkọwa ha
3. Ha ga-enweta nkwado iji mepụta nbanye ha
4. Tọọ ọrụ ha — ha dị njikere

Ọrụ: Onye ọzụzụ ego (dee naanị), Onye njikwa (akụkọ na ngwaahịa), Onye nwe (ịnweta niile). Ihe ngwọta ndị ọrụ bụ Premium.`,

    aiAssist:
`**Etu esi eji AI Business Assistant:**

1. Gaa **Ihe Ọmụma** → pịa **Mepee Mkparịta** n'AI card
2. Jụọ ihe ọ bụla — n'asụsụ gị!

Ihe atụ: "Ahịa taa dị ka ọ dị?", "Gosi ugwọ e ji", "Gịnị bụ ihe ire kachasị mma?", "Etu esi etolite azụmaahịa?"

Na-akwado **Bekee, Pidgin, Hausa, Igbo, na Yoruba** — asụsụ na-achọpụta akọwa. Ị nwere ike pịa bọtịnị 🎤 olu iji jụọ n'olu!`,

    premium:
`**Atụmatụ KudiAI Track:**

🆓 **N'efu (Starter)** — ruo azụmaahịa 30/ọnwa, ịchọpụta ugwọ (ruo 5), Aso, akụkọ oge

✨ **Premium — ₦5,000/ọnwa** — azụmaahịa enweghị ọnụọgụ, ndekọ ugwọ enweghị ọnụọgụ, AI zuru oke, njikwa ngwaahịa, akụkọ PDF, njikwa ndị ọrụ

Iji gaa elu: **Ntọala** → **Premium** → họọ atụmatụ.`,
  },

  yo: {
    overview:
`**KudiAI Track** ni app isowo pipe rẹ fun Nàìjíríà. Eyi ni ohun ti o le ṣe:

📊 **Ìdúnàádúrà** — Gba akọọlẹ tita ati inawo lẹsẹkẹsẹ
💳 **Itọpasẹ Gbese** — Tọpasẹ awọn onibara ti o ra lori gbese; firanṣẹ ìkìlọ̀ WhatsApp
🏦 **Aso** — Ṣàkóso ẹgbẹ ifowopamọ Aso/Esusu/Adashi rẹ
📦 **Ile-oja** — Tọpasẹ ọja, gba ìkìlọ̀ nigbati ọja fẹrẹ pari, wo ere fun ọja kọọkan
🤖 **AI** — Beere nipa tita, gbese ati ọja ninu ede rẹ
📄 **Akọọlẹ** — Ṣẹda awọn akọọlẹ isowo alamọja bi PDF
👥 **Oṣiṣẹ** — Fi oṣiṣẹ kun pẹlu awọn ipa wọn ati wiwọle tiwọn (Premium)
🔔 **Ìwífún** — Ìkìlọ̀ akọwa fun gbese ati Aso

Beere **"bii a ṣe lo [ẹya]"** fun itọsọna igbesẹ kan!`,

    transactions:
`**Bii a ṣe n gba akọọlẹ ìdúnàádúrà:**

1. Tẹ **Ìdúnàádúrà** ninu nav isalẹ
2. Tẹ **+ Owo To Wole** fun tita, tabi **+ Owo To Jade** fun inawo
3. Tẹ: orukọ ohun, owo, orukọ onibara
4. Tẹ **Fi pamọ** — ó pé!

💡 Fi orukọ onibara kun lati tọpasẹ awọn olura to dara julo. Tọ idiyele ẹyọkan ati iye fun iṣiro akọwa. Ti ohun ba wa ninu ile-oja rẹ, ó máa ń dinku iye akọwa.`,

    credit:
`**Bii a ṣe n lo Itọpasẹ Gbese:**

1. Lọ si tab **Gbese**
2. Tẹ **+** fi onibara gbese tuntun kun
3. Tẹ: orukọ, iye ti wọn jẹ gẹ, ọjọ isanwo
4. Nigbati wọn ba san, tẹ **Gba Akọọlẹ Isanwo** ṣe imudojuiwọn

Awọn akọọlẹ ni a fi ami si bi agbara lẹhin ọjọ isanwo. Ìkìlọ̀ ojoojumọ máa ń ṣèrànwọ́ lati tẹle. Bọtini WhatsApp jẹ ki o firanṣẹ ìkìlọ̀ isanwo lẹsẹkẹsẹ.`,

    ajo:
`**Bii a ṣe n lo Ifowopamọ Aso:**

1. Lọ si tab **Aso**
2. Tẹ **+** fi onibara kun si ẹgbẹ ifowopamọ rẹ
3. Ṣeto iye ifunni ati igbohunsafẹfẹ (ojoojumọ / ọsẹ / oṣù)
4. Nigbati wọn ba ṣe ifunni, tẹ **Gbà** ṣe imudojuiwọn iye wọn

Aso/Esusu/Adashi jẹ ètò ifowopamọ ibile Nàìjíríà nibiti awọn ọmọ ẹgbẹ n ṣe ifunni nigbagbogbo. KudiAI Track máa ń tọpasẹ gbogbo awọn ifunni ati isanwo.`,

    inventory:
`**Bii a ṣe n lo Ile-oja / Stock:**

1. Lọ si tab **Ile-oja**
2. Tẹ **+** fi ọja kun — orukọ, idiyele gbigba, tita, iye
3. Nigbati o ba ta ohun naa, iye ọja máa ń dinku akọwa
4. Iwọ yoo gba ìkìlọ̀ nigbati ọja fẹrẹ pari

Iboju fihan lapapọ iye ọja, ere fun ọja kọọkan, ati itan gbogbo awọn ayipada (tita, atunra, ìtúnṣe).`,

    reports:
`**Bii a ṣe n ṣẹda awọn akọọlẹ:**

1. Lọ si **Imọ** → tẹ **Akọọlẹ** (ọtun oke)
2. Yan akoko — Oni / Ọsẹ / Oṣù
3. Tẹ **Ṣẹda** — PDF alamọja ni a ṣẹda lẹsẹkẹsẹ
4. Pin nipasẹ WhatsApp tabi imeeli, tabi gba silẹ

Awọn iru akọọlẹ: akopọ tita, itupalẹ inawo, ere ati adanu, gbese, idiyele ile-oja.`,

    staff:
`**Bii a ṣe n ṣàkóso oṣiṣẹ:**

1. Lọ si **Eto** → **Ìṣàkóso Oṣiṣẹ**
2. Tẹ **+ Fi Oṣiṣẹ Kun**, tẹ alaye wọn sii
3. Wọn yoo gba ìpè lati ṣẹda wiwọle tiwọn
4. Ṣeto ipa wọn — wọn ti ṣetan

Awọn ipa: Kasiya (gba akọọlẹ nikan), Oluṣakoso (awọn akọọlẹ ati ile-oja), Oniwun (iwọle ni kikun). Ìṣàkóso oṣiṣẹ jẹ ẹya Premium.`,

    aiAssist:
`**Bii a ṣe n lo AI Business Assistant:**

1. Lọ si **Imọ** → tẹ **Ṣii Ibaraẹnisọrọ** lori kaadi AI
2. Beere nkankan — ninu ede rẹ!

Awọn apẹẹrẹ: "Bawo ni titẹ oni?", "Fi gbese to wa han", "Ọja wo lo n tita julo?", "Bii a ṣe n dagba isowo mi?"

N ṣe atilẹyin fun **Gẹ̀ẹ́sì, Pidgin, Hausa, Igbo, ati Yoruba** — ede n ṣe iwari akọwa. O tún le tẹ bọtini 🎤 lati beere nipasẹ ohun!`,

    premium:
`**Awọn Ètò KudiAI Track:**

🆓 **Ọfẹ (Starter)** — titi di ìdúnàádúrà 30/osù, itọpasẹ gbese (titi 5), Aso, awọn akọọlẹ ipilẹ

✨ **Premium — ₦5,000/osù** — ìdúnàádúrà ailopin, igbasile gbese ailopin, AI ti o jinlẹ, ìṣàkóso ile-oja, awọn akọọlẹ PDF, ìṣàkóso oṣiṣẹ

Lati goke: **Eto** → **Premium** → yan ètò rẹ.`,
  },
};

/* ── General business knowledge ── */
export const BIZ_KB = {
  en: {
    pricing:
`**Pricing Strategy for Nigerian Businesses:**

1. **Cost-Plus Pricing** — Calculate all your costs (buying price + transport + storage + overhead), then add your profit margin (typically 20–50%)
2. **Competitive Pricing** — Check what competitors charge and price similarly or slightly below
3. **Value-Based Pricing** — Charge based on the customer's perceived value, not just cost

💡 **Practical tips:**
• Track buying vs selling price in your Inventory tab — KudiAI shows margin per product automatically
• Aim for at least 30% gross margin on goods; 50%+ for cosmetics and fashion
• Review prices every 3 months as naira cost fluctuates
• Never undercut to the point where you're making less than 10% — you're working for free`,

    cashFlow:
`**Managing Cash Flow in Your Business:**

Cash flow = money flowing in and out of your business. Profit on paper means nothing if you have no cash to operate.

✅ **Inflows** — Sales, credit repayments, savings withdrawals
❌ **Outflows** — Restocking, rent, transport, salaries, taxes

**Tips to stay cash-positive:**
• Record every single transaction — use KudiAI Track daily
• Follow up on overdue credit immediately — every day you wait is a day that money is unavailable
• Keep 1–2 months of operating expenses as a buffer (Ajo is great for this)
• Don't tie up too much cash in excess stock — only buy what you can sell in 60 days
• Separate your personal and business money`,

    profitMargin:
`**Understanding Profit Margins:**

**Formula:** (Selling Price − Cost Price) ÷ Selling Price × 100

Example: Buy at ₦1,000, sell at ₦1,500 → Margin = 33%

**Typical Nigerian market margins:**
• Food & groceries: 10–20%
• Clothing & fashion: 40–60%
• Electronics & phones: 10–25%
• Cosmetics & skincare: 50–70%
• Building materials: 15–30%

💡 In KudiAI Track's Inventory screen, every product shows its margin automatically. Aim to stock more of the high-margin items.`,

    growth:
`**How to Grow Your Nigerian Business:**

1. **Know your numbers** — Use KudiAI Track: identify your best-selling items, peak days, and most valuable customers
2. **Retain your best customers** — Track top buyers, remember their names, offer loyal pricing
3. **Bulk buying = better margins** — Use Ajo savings to build capital for wholesale purchases
4. **Cut waste first** — Review expenses monthly; stop spending on things that don't generate sales
5. **Expand carefully** — Don't grow faster than your cash flow allows; use profit for expansion, not loans
6. **Use technology** — Apps like KudiAI Track give small businesses the same analysis capabilities as large companies
7. **Follow up on credit** — Recovering owed money is as good as making a new sale`,

    bookkeeping:
`**Simple Bookkeeping for Small Businesses:**

You don't need an accountant to keep good records. Here's what matters:

📌 **Daily:**
• Record every sale (Cash In) — item, amount, customer
• Record every expense (Cash Out) — category, amount

📌 **Weekly:**
• Review total profit vs expenses
• Follow up on overdue credit customers

📌 **Monthly:**
• Generate a PDF report from KudiAI Track
• Check your best-selling items and top customers
• Review stock levels — restock before you run out

💡 KudiAI Track automates all of this. Your dashboard shows daily profit, and the Reports feature gives you monthly summaries in seconds.`,

    creditMgmt:
`**Managing Credit Customers Effectively:**

Selling on credit can grow your sales — but you must manage it carefully:

✅ **Best practices:**
• Always set a clear due date when giving credit — no "just pay later"
• Keep a written record of every credit transaction (KudiAI does this for you)
• Send reminders 3 days before the due date and on the due date itself
• Follow up the day after it's overdue — don't wait weeks
• Set a personal credit limit per customer based on their payment history

❌ **Common mistakes:**
• Giving credit without documentation
• Allowing the total credit to exceed what you can afford to lose
• Being too friendly to collect (business is business)

💡 KudiAI Track's Credit tab tracks all outstanding balances, marks overdue accounts, and sends daily alerts.`,

    inventoryTips:
`**Smart Inventory Management:**

1. **FIFO (First In, First Out)** — Sell older stock first to avoid expiry losses, especially for food and cosmetics
2. **Set minimum stock levels** — Use KudiAI's low-stock threshold so you restock before you run out
3. **Track slow movers** — If an item hasn't sold in 60+ days, consider discounting or returning it
4. **Monitor your margins** — Use the Inventory screen to see which products earn the most profit per naira
5. **Do weekly physical counts** — Compare to your app records to catch theft or recording errors
6. **Don't overstock** — Excess stock ties up cash that could be earning elsewhere`,

    ajoBenefits:
`**Why Ajo/Esusu is Good for Your Business:**

Ajo (also called Esusu, Adashi, or thrift) is a traditional Nigerian rotating savings system where a group contributes money regularly and members take turns collecting the full pot.

**Benefits for business owners:**
• **Forced savings** — Money in the Ajo pot cannot be casually spent
• **Interest-free lump sum** — No bank loan interest; use the collected amount for restocking or expansion
• **Financial discipline** — Builds the habit of regular saving
• **Community trust** — Strengthens business relationships and social capital

**As the Ajo organizer, KudiAI Track helps you:**
• Record each client's contributions
• Track who has paid and who is behind
• Record payouts and withdrawals
• Send alerts for missed contributions`,

    nigeria:
`**Running a Business in Nigeria — Key Facts:**

📋 **Registration (CAC):**
• Register your business name at the Corporate Affairs Commission (CAC)
• Sole proprietorship: register a business name (₦10,000–₦20,000)
• Limited company: register as an LLC (more complex, for larger operations)

💰 **Taxes:**
• **VAT**: 7.5% on goods and services — you must register if annual revenue exceeds ₦25 million
• **Personal Income Tax**: applies to sole proprietors; paid to your state IRS
• **Company Tax**: 30% of profits for incorporated companies
• Pay taxes through FIRS (Federal Inland Revenue Service) at firs.gov.ng

📊 **Compliance tips:**
• Keep proper records (KudiAI Track helps significantly)
• Issue receipts to customers for all transactions
• Separate business and personal bank accounts
• File tax returns annually even if you had a loss`,
  },

  pidgin: {
    pricing:
`**Pricing Strategy for Nigerian Business:**

1. **Cost-Plus Pricing** — Calculate all your cost (buying price + transport + overhead), then add your profit (usually 20–50%)
2. **Competitive Pricing** — Check wetin your competitors dey charge, price like them or small below
3. **Value-Based Pricing** — Charge based on wetin your customer think the product worth

💡 **Practical tips:**
• Track your buying vs selling price for Inventory — KudiAI show margin per product automatic
• Try reach at least 30% margin on goods; 50%+ for cosmetics and fashion
• Review prices every 3 months as naira dey change
• No undercut so much wey you dey work for free — keep at least 10% margin`,

    cashFlow:
`**How to Manage Cash Flow for your Business:**

Cash flow na the money wey dey enter and leave your business. Profit on paper no mean anything if you no get cash to operate.

✅ **Money Enter** — Sales, credit payment, savings withdrawal
❌ **Money Comot** — Restock, rent, transport, salary, tax

**Tips to stay cash-positive:**
• Record every transaction every day — use KudiAI Track
• Follow up on overdue credit ASAP — every day you wait na day that money no available
• Keep 1–2 months operating expenses as buffer (Ajo good for this)
• No put too much cash for excess stock — buy only wetin you fit sell in 60 days
• Separate your personal and business money`,

    profitMargin:
`**Understanding Profit Margin:**

**Formula:** (Selling Price − Cost Price) ÷ Selling Price × 100

Example: Buy at ₦1,000, sell at ₦1,500 → Margin = 33%

**Typical margin by sector:**
• Food and grocery: 10–20%
• Clothing and fashion: 40–60%
• Electronics and phones: 10–25%
• Cosmetics and skincare: 50–70%
• Building materials: 15–30%

💡 For KudiAI Track Inventory screen, every product show margin automatic. Buy more of the high-margin items.`,

    growth:
`**How to Grow Your Nigerian Business:**

1. **Know your numbers** — Use KudiAI Track: know your best-selling items, peak days, and best customers
2. **Keep your best customers** — Track top buyers, remember their names, give them loyal pricing
3. **Bulk buying = better margin** — Use Ajo savings build capital for wholesale purchase
4. **Cut waste first** — Check expenses every month; stop spending on things wey no dey generate sales
5. **Grow carefully** — No grow faster than your cash flow; use profit for expansion, not loan
6. **Follow up on credit** — Recovering money wey dem owe you na same as making new sale`,

    bookkeeping:
`**Simple Record Keeping for Small Business:**

📌 **Every Day:**
• Record every sale (Cash In) — item, amount, customer
• Record every expense (Cash Out) — category, amount

📌 **Every Week:**
• Review total profit vs expenses
• Follow up on overdue credit customers

📌 **Every Month:**
• Generate PDF report from KudiAI Track
• Check your best-selling items and top customers
• Check stock levels — restock before you run out

💡 KudiAI Track do all this automatic. Dashboard show daily profit, Reports give monthly summary in seconds.`,

    creditMgmt:
`**How to Manage Credit Customers Well:**

Selling on credit fit grow your sales — but manage am carefully:

✅ **Best practices:**
• Always set clear due date when you give credit — no "just pay later"
• Keep record of every credit transaction (KudiAI do this for you)
• Send reminder 3 days before due date and on due date itself
• Follow up the day after e overdue — no wait weeks
• Set credit limit per customer based on their payment history

❌ **Common mistakes:**
• Give credit without any document
• Allow total credit pass wetin you fit afford to lose
• Too friendly to collect (business na business)

💡 KudiAI Track Credit tab track all outstanding balances, mark overdue accounts, send daily alerts.`,

    inventoryTips:
`**Smart Inventory Management:**

1. **FIFO (First In, First Out)** — Sell old stock first avoid expiry, especially for food and cosmetics
2. **Set minimum stock level** — Use KudiAI low-stock threshold so you restock before you run out
3. **Track slow items** — If item never sell in 60+ days, consider discount am or return am
4. **Monitor margins** — See which product dey earn most profit per naira
5. **Count stock every week** — Compare with app records catch theft or recording error
6. **No overstock** — Excess stock dey tie up cash wey fit earn elsewhere`,

    ajoBenefits:
`**Why Ajo/Esusu Good for Your Business:**

Ajo (or Esusu, Adashi, thrift) na traditional Nigerian savings system where group dey contribute money regular and members dey collect the full pot by turn.

**Benefits for business owners:**
• **Forced savings** — Money for Ajo pot no fit casually spend
• **Interest-free lump sum** — No bank loan interest; use am for restock or expansion
• **Financial discipline** — Build habit of regular saving
• **Community trust** — Strengthen business relationships

**As Ajo organizer, KudiAI Track help you:**
• Record each client contribution
• Track who pay and who dey behind
• Record payouts and withdrawals
• Send alert for missed contributions`,

    nigeria:
`**Running Business in Nigeria — Key Facts:**

📋 **Registration (CAC):**
• Register your business name with Corporate Affairs Commission (CAC)
• Sole proprietorship: register business name (₦10,000–₦20,000)
• Limited company: register as LLC (for bigger operations)

💰 **Tax:**
• **VAT**: 7.5% on goods and services — register if annual revenue pass ₦25 million
• **Personal Income Tax**: applies to sole proprietors; pay to your state IRS
• Pay taxes through FIRS (firs.gov.ng)

📊 **Compliance tips:**
• Keep proper records (KudiAI Track help with this)
• Give receipt to customers for every transaction
• Separate business and personal bank account
• File tax return every year even if you make loss`,
  },

  ha: {
    pricing:
`**Dabarar Farashin Kasuwanci na Najeriya:**

1. **Tsara Farashi da Farashi** — Kirga duk farashin (siyan + jigilar kaya + overhead), sannan ƙara riba (yawanci 20–50%)
2. **Tsara Farashi da Masu Hamayya** — Duba farashin masu hamayya, ka yi kama ko ɗan ƙasa
3. **Tsara Farashi da Ƙima** — Ka yi farashi bisa ƙimar abokan ciniki ke gani

💡 Bibiya farashin siyan vs siyarwa a Kayan Ajiya. Yi niyya akalla 30% riba. Duba farashi kowane kwata yayin da naira ke canzawa.`,

    cashFlow:
`**Sarrafa Kuɗin Kasuwanci:**

✅ **Kuɗin Shiga** — Tallace-tallace, biyan bashi, janye ajiya
❌ **Kuɗin Fita** — Sake siyan kaya, haya, jigilar kaya, albashi, haraji

**Shawarwari:**
• Rikodin kowane ma'amala kowace rana — yi amfani da KudiAI Track
• Bi sawun bashi mai wuce lokaci da gaggawa
• Ajiye kuɗin aiki na watanni 1–2 a matsayin ajiya (Aso yana da kyau don wannan)
• Kar ka ajiye kuɗi da yawa a cikin kaya da yawa — siya kawai abin da za ka iya sayar da shi cikin kwana 60`,

    profitMargin:
`**Fahimtar Riba a Kasuwanci:**

**Dabarar:** (Farashin Siyarwa − Farashin Siyanya) ÷ Farashin Siyarwa × 100

Misali: Siya da ₦1,000, sayar da ₦1,500 → Riba = 33%

**Ribar da aka yi niyya:**
• Abinci/kayan marmari: 10–20%
• Tufafi/zane: 40–60%
• Lantarki/wayoyi: 10–25%
• Kwalliya/fata: 50–70%

💡 Shafin Kayan Ajiya na KudiAI Track yana nuna riba kowane kaya ta atomatik.`,

    growth:
`**Yadda ake Girma Kasuwanci na Najeriya:**

1. **San lambobin ku** — Yi amfani da KudiAI Track: kayayyakin siyarwa mafi yawa, manyan kwanakin, da mafi kyawun abokan ciniki
2. **Riƙe mafi kyawun abokan ciniki** — Bibiya manyan masu siya, tuna sunayensu
3. **Saye cikin yawa = riba mafi yawa** — Yi amfani da Aso/Ajiya gina jari don saya cikin yawa
4. **Rage ɓarnar farko** — Duba kashe-kashe kowane wata; tsaya daga kashe kuɗi kan abubuwan da ba sa kawo siyarwa
5. **Girma da hankali** — Kar ka yi girma da sauri fiye da cash flow; yi amfani da riba don faɗaɗawa, ba rance ba`,

    bookkeeping:
`**Sauƙin Ajiye Bayanan Kasuwanci:**

📌 **Kowace Rana:** Rikodin kowane tallace da kashe
📌 **Kowane Mako:** Duba riba vs kashe-kashe; bi sawun bashi
📌 **Kowane Wata:** Ƙirƙiri rahoto na PDF; duba kayan ajiya; sake siya kafin ka ƙarewa

💡 KudiAI Track yana yi duk wannan ta atomatik. Dashboard yana nuna ribar yau, rahotoni suna ba da taƙaitaccen bayani na wata a cikin daƙiƙa.`,

    creditMgmt:
`**Sarrafa Abokan Ciniki Masu Bashi:**

✅ **Mafi kyawun ayyukan:** Koyaushe sanya ranar biyan; rikodin kowane ma'amala na bashi; aika tunatarwa kwana 3 kafin ranar biyan; bi sawu washegari bayan ya wuce lokaci

❌ **Kurakurai gama gari:** Bayar da bashi ba tare da takarda ba; ba da bashi fiye da abin da za ka iya yin asara; zama maƙusa wajen tattarawa

💡 Shafin Bashi na KudiAI Track yana bibiyar duk daidaiton da ba a biya ba, yana alamar wuce lokaci, yana aika faɗakarwa kowace rana.`,

    inventoryTips:
`**Sarrafa Kayan Ajiya da Hankali:**

1. **FIFO** — Sayar da tsohuwar kaya farko don gujewa lalacewa
2. **Sanya matakin ƙarancin kaya** — Yi amfani da ƙimar KudiAI don sake siya kafin ka ƙarewa
3. **Bibiya kayan da ba su siyarwa** — Idan kaya ba ta siyarwa cikin kwana 60+, yi la'akari da ragi
4. **Kiyaye ribarka** — Duba wace kaya ke kawo mafi riba
5. **Ƙididdige kaya kowane mako** — Kwatanta da rikodin app don gano satar kaya`,

    ajoBenefits:
`**Me Yasa Aso/Esusu Ke Amfana Kasuwanci:**

Aso (ko Esusu, Adashi, ko thrift) tsarin ajiyar gargajiya ne inda membobinsa ke gudummawa akai-akai kuma kowa yana ɗaukar cikakken tukwici a lokacin sa.

**Amfanin ga masu kasuwanci:**
• Ajiya ta tilas — ba za ka iya kashe kuɗin da ke cikin tukwicin Aso ba
• Jimlar kuɗi ba tare da riba ba — ba bukata kudin bashi; yi amfani don sake siya ko faɗaɗawa
• Tsarin kudi mai kyau
• Amincewar al'umma

**Kamar mai shirya Aso, KudiAI Track yana taimaka muku:** Rikodin gudummawa, bibiyar wanda ya biya, rahoton cirewa.`,

    nigeria:
`**Gudanar da Kasuwanci a Najeriya — Muhimman Abubuwa:**

📋 **Rajista (CAC):** Sanya sunan kasuwanci a Hukumar Harkokin Korporeshon (CAC). Mallakar daya: rajista sunan kasuwanci (₦10,000–₦20,000).

💰 **Harajin:** VAT ta 7.5% akan kaya da ayyuka (idan kudaden shiga na shekara ya wuce ₦25 miliyan, dole ne ka yi rajista don VAT). Biya haraji ta FIRS (firs.gov.ng).

📊 **Shawarwarin bin doka:** Kiyaye rikodin da ya dace (KudiAI Track yana taimaka sosai). Ba da kiredit ga abokan ciniki don kowane ma'amala. Raba asusun kasuwanci da na kai tsaye.`,
  },

  ig: {
    pricing:
`**Atọmmaatọ Ọnụahịa maka Azụmaahịa Naịjịrịa:**

1. **Cost-Plus Pricing** — Gbakọọ ọnụ niile (ọnụahịa ịzụta + ụgbọ + overhead), wee tinye uru (n'ozuzu 20–50%)
2. **Competitive Pricing** — Lelee ihe ndị asọmpi na-aba, ọ bụ n'otu ahịa ma ọ bụ ntakịrị ala
3. **Value-Based Pricing** — Tọọ ọnụahịa dabere na uru ndị ahịa hụrụ

💡 Soro ọnụahịa ịzụta vs ire n'Inventory. Chefuo uru ruo 30%. Nyochaa ọnụahịa kwa ọnwa atọ ka naira na-agbanwe.`,

    cashFlow:
`**Ịjikwa Ego n'Azụmaahịa:**

✅ **Ego Na-abata** — Ahịa, ịkwụ ugwọ, iwepụ nchekwa
❌ **Ego Na-apụ** — Ịzụta ngwaahịa ọzọ, mgbazinye ụlọ, ụgbọ, ụgwọ ndị ọrụ, ụtụ

**Ndụmọdụ:**
• Dee azụmaahịa niile kwa ụbọchị — jiri KudiAI Track
• Soro ugwọ agafeela oge ozugbo — ụbọchị ọ bụla i chere bụ ụbọchị ego ahụ anaghị dị
• Chekwaa ego ọrụ ọnwa 1–2 dị ka nchekwa (Aso dị mma maka nke a)
• Ọ bụghị ka ị kwụọ ego ọtụtụ n'ngwaahịa ọtụtụ — zụọ naanị ihe ị nwere ike ire n'ụbọchị 60`,

    profitMargin:
`**Ịghọta Uru n'Azụmaahịa:**

**Usoro:** (Ọnụahịa Ire − Ọnụahịa Ọnụ) ÷ Ọnụahịa Ire × 100

Ihe atụ: Zụọ ₦1,000, ree ₦1,500 → Uru = 33%

**Oge uru n'ọrụ ọ bụla:**
• Nri/ahịa: 10–20%
• Akwa/ọsọ: 40–60%
• Igwe eletrọnikị: 10–25%
• Ihe ịcha: 50–70%

💡 N'ọchịchọ Inventory KudiAI Track, ngwaahịa ọ bụla na-egosi uru ya akọwa.`,

    growth:
`**Etu esi etolite Azụmaahịa Naịjịrịa:**

1. **Mara nomba gị** — Jiri KudiAI Track: ihe ire kachasị mma, ụbọchị ọcha, na ndị ahịa kacha bara uru
2. **Chekwaa ndị ahịa kacha mma** — Soro ndị ahịa kacha mma, cheta aha ha
3. **Ịzụta ọtụtụ = uru karị** — Jiri Aso wuo ego maka ịzụta ọtụtụ
4. **Belata ọnọdụ izizi** — Nyochaa ihe ejiri ego kwa ọnwa; kwụsịa na ihe ndị na-abụghị maka ire
5. **Tolite nwayọọ** — Ọ bụghị ka ọ sọ iyi ọ pụta n'ego na-abata; jiri uru maka ọganihu, ọ bụghị mbọ`,

    bookkeeping:
`**Ndekọ Ọdekọ Dị Mfe maka Azụmaahịa:**

📌 **Kwa Ụbọchị:** Dee ahịa niile (Ego Na-abata) — ihe, ego, onye ahịa; dee ihe ejiri ego niile (Ego Na-apụ)
📌 **Kwa Izu:** Nyochaa uru n'ụzọ vs ihe ejiri ego; soro ndị ahịa ugwọ agafeela oge
📌 **Kwa Ọnwa:** Mepụta akụkọ PDF; nyochaa ọnụọgụ ngwaahịa; zụọ ngwaahịa ọzọ tupu ị mechaa

💡 KudiAI Track na-emejuputa nke a niile akọwa. Dashboard na-egosi uru ụbọchị; akụkọ na-enye nchịkọta ọnwa n'oge dị obere.`,

    creditMgmt:
`**Ịjikwa Ndị Ahịa Ugwọ Nke Ọma:**

✅ **Omume kacha mma:** Tọọ mgbe ịkwụ ụgwọ mgbe ị na-enye ugwọ; chekwaa ndekọ azụmaahịa ugwọ niile; zipu ọkwa ụbọchị 3 tupu oge ịkwụ; soro ụbọchị abụọ mgbe oge agafeela

❌ **Njehie a na-ahụkarị:** Inye ugwọ na-enweghị akwụkwọ; ikwe ka ugwọ karia ihe ị nwere ike ifu; ịdị nwayọọ maka iṅọgide

💡 Tab Ugwọ KudiAI Track na-esoro ọnọdụ niile, na-egosi ihe agafeela oge, na-eziga ịdọ aka na ntị kwa ụbọchị.`,

    inventoryTips:
`**Njikwa Ngwaahịa Ọhụrụ:**

1. **FIFO** — Ree ngwaahịa ochie izizi iji zere ọnwụ ya
2. **Tọọ ọnụọgụ kacha ala** — Jiri KudiAI iji zụọ ngwaahịa ọzọ tupu ị mechaa
3. **Soro ihe na-erejughị ike** — Ọ bụrụ na ihe ereghị n'ụbọchị 60+, were n'ọchịchọ obere ọnụahịa ya
4. **Nyochaa uru gị** — Hụ ngwaahịa ndị na-enye uru karị
5. **Ọgụgụ ngwaahịa kwa izu** — Tụnyere na ndekọ app iji chọpụta ojiji ma ọ bụ njehie ndekọ`,

    ajoBenefits:
`**Ihe Mere Aso/Esusu Ji Bara Uru maka Azụmaahịa:**

Aso (Esusu, Adashi, thrift) bụ usoro nchekwa ọmenala Naịjịrịa ebe ndị otu na-etinye ugboro ugboro ma ha na-ewere ego ọpụrụiche ha mgbe ya.

**Uru maka ndị nwe azụmaahịa:**
• Nchekwa a na-achụ — ego n'ụzọ Aso enweghị ike ịnwe ya n'ụzọ ndị ọzọ
• Oke ego na-enweghị faeces — ọ bụghị mbọ ụlọ akụ; jiri ya maka ịzụta ngwaahịa ọzọ ma ọ bụ ọganihu
• Nkwado ego
• Ntụkwasị obi ọha

**Dị ka onye nhazi Aso, KudiAI Track na-enyere gị aka:** Dee ntinye nke onye ahịa ọ bụla, soro onye kwụọ na onye ka e ji, dee iwepụ na ịkwụ.`,

    nigeria:
`**Ịme Azụmaahịa na Naịjịrịa — Ihe Dị Mkpa:**

📋 **Ndebanye Aha (CAC):** Debanye aha azụmaahịa gị na Corporate Affairs Commission. Onye nwe naanị: debanye aha azụmaahịa (₦10,000–₦20,000).

💰 **Ụtụ isi:** VAT bụ 7.5% na ngwaahịa na ọrụ (ọ bụrụ na ihe e si n'ahịa pụta kwa afọ karịrị ₦25 nde, ị ga-ede aha gị maka VAT). Kwụọ ụtụ isi na FIRS (firs.gov.ng).

📊 **Ndụmọdụ:** Chekwaa ndekọ nke ọma (KudiAI Track na-enyere aka nke ukwu). Nye ndekọ aka maka azụmaahịa niile. Kewaa akụ azụmaahịa na nke onwe gị.`,
  },

  yo: {
    pricing:
`**Ilana Idiyele fun Isowo Nàìjíríà:**

1. **Cost-Plus Pricing** — Ṣe iṣiro gbogbo awọn iye (idiyele gbigba + gbigbe + overhead), lẹhinna fi ere ti o fẹ (igbagbogbo 20–50%)
2. **Competitive Pricing** — Ṣayẹwo ohun ti awọn ẹlẹgbẹ n gba, diyele fẹẹrẹ bẹẹ
3. **Value-Based Pricing** — Tọ idiyele si lori iye ti awọn onibara rẹ gbagbọ

💡 Tọpasẹ idiyele gbigba vs tita ni Ile-oja. Fojusọna o kere ju 30% ere. Ṣe atunyẹwo awọn idiyele ni ọdọọdún mẹrin.`,

    cashFlow:
`**Bii a ṣe n ṣàkóso Owo Isowo:**

✅ **Owo To Wole** — Tita, isanwo gbese, yiyọ ifowopamọ
❌ **Owo To Jade** — Atunra ọja, iyalo, gbigbe, owo, owo-ori

**Awọn imọ̀ràn:**
• Gba akọọlẹ gbogbo ìdúnàádúrà lojoojumọ — lo KudiAI Track
• Tẹle awọn isanwo gbese ti koja akoko lẹsẹkẹsẹ
• Pa owo iṣẹ oṣù 1–2 mọ gẹgẹ bi ojúṣe (Aso dara fun eyi)
• Máṣe fi owo pupọ sii ni ọja ti o pọju — ra nikan ohun ti o le ta ni ọjọ 60`,

    profitMargin:
`**Agbọye Ere Isowo:**

**Agbekalẹ:** (Idiyele Tita − Idiyele Gbigba) ÷ Idiyele Tita × 100

Apeere: Ra fun ₦1,000, ta fun ₦1,500 → Ere = 33%

**Awọn ere afojusọna nipa apa:**
• Ounje/ohun elo: 10–20%
• Aṣọ/aṣa: 40–60%
• Ẹrọ/awọn foonu: 10–25%
• Awọn ikunra: 50–70%

💡 Ni iboju Ile-oja KudiAI Track, ọja kọọkan fihan ere rẹ akọwa.`,

    growth:
`**Bii a ṣe n dagba Isowo Nàìjíríà:**

1. **Mọ awọn nọmba rẹ** — Lo KudiAI Track: awọn ọja tita to dara julo, awọn ọjọ to pọju, ati awọn onibara to niyelori julo
2. **Ṣetọju awọn onibara to dara julo** — Tọpasẹ awọn olura to ga, ranti awọn orukọ wọn
3. **Rira pupọ = ere ti o pọ sii** — Lo Aso lati kọ olu fun rira gbogbo
4. **Din inawo kọkọ** — Ṣe atunyẹwo inawo ni oṣù kọọkan; dawọ lo owo lori awọn nkan ti kò n ṣẹda tita
5. **Dagba ni iṣọra** — Máṣe dagba yara ju bi cash flow rẹ ṣe le gba lọ; lo ere fun imugboroosi, kii ṣe gbese`,

    bookkeeping:
`**Ìtọjú Igbasile Ti O Rọrun fun Isowo Kekere:**

📌 **Lojoojumọ:** Gba akọọlẹ tita kọọkan (Owo To Wole) — ohun, owo, onibara; gba akọọlẹ inawo kọọkan
📌 **Ọsẹ Kọọkan:** Ṣe atunyẹwo lapapọ ere vs inawo; tẹle awọn onibara gbese ti agbara
📌 **Oṣù Kọọkan:** Ṣẹda akọọlẹ PDF; ṣayẹwo iye ọja; tun ra ọja ṣaaju ki o to pari

💡 KudiAI Track máa ń ṣe gbogbo rẹ akọwa. Dashboard fihan ere ojoojumọ; Awọn akọọlẹ n fun oṣù ní ìṣirò ní ìṣẹ́jú aaya.`,

    creditMgmt:
`**Ṣàkóso Awọn Onibara Gbese Daradara:**

✅ **Awọn iṣe to dara julo:** Nigbagbogbo tọ ọjọ isanwo to kedere; pa igbasile mọ fun gbogbo ìdúnàádúrà gbese; firanṣẹ ìkìlọ̀ ọjọ mẹta ṣaaju ọjọ isanwo; tẹle ọjọ kan lẹhin ti agbara

❌ **Awọn aṣiṣe to wọpọ:** Fifun gbese laisi iwe-ẹri; jijẹ ki gbese kọja ohun ti o le jẹ adanu; jijẹ ore ju lati gba pada

💡 Tab Gbese KudiAI Track máa ń tọpasẹ gbogbo awọn owo ti ko san, fi ami si awọn akọọlẹ agbara, firanṣẹ ìkìlọ̀ lojoojumọ.`,

    inventoryTips:
`**Ìṣàkóso Ile-oja ti o Ṣe ìlọsíwájú:**

1. **FIFO** — Ta ọja atijọ kọkọ lati yago fun ipadanu ikú, paapaa fun ounje ati ikunra
2. **Tọ iye kekere** — Lo ìloro KudiAI lati tun ra ṣaaju ki o to pari
3. **Tọpasẹ awọn ohun ti n ta laiyara** — Ti ohun kan ko ba ti ta ni 60+ ọjọ, ṣe iyasọtọ ẹdinwo
4. **Ṣayẹwo awọn ere rẹ** — Wo ọja wo lo n jere ere julọ fun naira kọọkan
5. **Ka ọja ni ọsẹ kọọkan** — Fiwe si awọn igbasile app lati rii jíjà tabi aṣiṣe igbasile`,

    ajoBenefits:
`**Idi ti Aso/Esusu Dara fun Isowo Rẹ:**

Aso (tabi Esusu, Adashi, thrift) jẹ ètò ifowopamọ ibile Nàìjíríà nibiti awọn ọmọ ẹgbẹ n ṣe ifunni nigbagbogbo ati pe ọkọọkan máa ń gba ìpín nla.

**Anfaani fun awọn oniwun isowo:**
• **Ifowopamọ ti a fipá mú** — Owo ni ikoko Aso ko le lo ni irandiirand
• **Iye owo lapapọ laisi èrè** — Ko si èrè gbese; lo fun atunra tabi imugboroosi
• **Ìmọ ọgbọn inawo**
• **Igbẹkẹle agbegbe**

**Gẹgẹ bi alájọpín Aso, KudiAI Track ń ṣe iranlọwọ:** Gba akọọlẹ awọn ifunni, tọpasẹ ẹni ti o san ati ẹni ti ò san, gba akọọlẹ awọn isanwo.`,

    nigeria:
`**Ṣiṣe Isowo ni Nàìjíríà — Awọn Otitọ Pataki:**

📋 **Ìforúkọsílẹ̀ (CAC):** Fi orukọ isowo rẹ silẹ ni Corporate Affairs Commission. Oniwun kọọkan: forukọsilẹ orukọ isowo (₦10,000–₦20,000).

💰 **Owo-ori:** VAT jẹ 7.5% lori awọn ọja ati iṣẹ (ṣe iforukọsilẹ ti o ba jẹ pe owo ọdọọdún rẹ ju ₦25 milionu lọ). Sanwo owo-ori nipasẹ FIRS (firs.gov.ng).

📊 **Awọn imọ̀ràn ibamu:** Pa awọn igbasile ti o tọ mọ (KudiAI Track ń ṣe iranlọwọ nla). Fi ẹri si awọn onibara fun gbogbo ìdúnàádúrà. Ya akọọlẹ isowo ati ti ara ẹni sọtọ.`,
  },
};
