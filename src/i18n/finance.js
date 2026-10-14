// finance — UI text in all five languages. Keys: "finance.<name>": { en, pidgin, ha, ig, yo }. Use {var} for values: t("finance.x", { var }).
const T = {
  /* Month names (on-screen dates only — PDFs keep English) */
  "finance.month1":  { en: "January",   pidgin: "January",   ha: "Janairu",   ig: "Jenụwarị",  yo: "Ṣẹ́rẹ́" },
  "finance.month2":  { en: "February",  pidgin: "February",  ha: "Fabrairu",  ig: "Febụwarị",  yo: "Èrèlè" },
  "finance.month3":  { en: "March",     pidgin: "March",     ha: "Maris",     ig: "Maachị",    yo: "Ẹrẹ̀nà" },
  "finance.month4":  { en: "April",     pidgin: "April",     ha: "Afirilu",   ig: "Eprel",     yo: "Ìgbé" },
  "finance.month5":  { en: "May",       pidgin: "May",       ha: "Mayu",      ig: "Mee",       yo: "Ẹ̀bibi" },
  "finance.month6":  { en: "June",      pidgin: "June",      ha: "Yuni",      ig: "Juun",      yo: "Òkúdu" },
  "finance.month7":  { en: "July",      pidgin: "July",      ha: "Yuli",      ig: "Julaị",     yo: "Agẹmọ" },
  "finance.month8":  { en: "August",    pidgin: "August",    ha: "Agusta",    ig: "Ọgọst",     yo: "Ògún" },
  "finance.month9":  { en: "September", pidgin: "September", ha: "Satumba",   ig: "Septemba",  yo: "Owewe" },
  "finance.month10": { en: "October",   pidgin: "October",   ha: "Oktoba",    ig: "Ọktoba",    yo: "Ọ̀wàrà" },
  "finance.month11": { en: "November",  pidgin: "November",  ha: "Nuwamba",   ig: "Novemba",   yo: "Bélú" },
  "finance.month12": { en: "December",  pidgin: "December",  ha: "Disamba",   ig: "Disemba",   yo: "Ọ̀pẹ̀" },

  /* Shared bits */
  "finance.preparing":    { en: "Preparing…", pidgin: "E dey prepare…", ha: "Ana shiryawa…", ig: "Ọ na-akwado…", yo: "Ó ń pèsè…" },
  "finance.couldntSave":  { en: "Couldn't save that — try again.", pidgin: "We no fit save am — try again.", ha: "Ba a iya ajiye wannan ba — sake gwadawa.", ig: "Enweghị ike ichekwa ya — nwaa ọzọ.", yo: "A kò lè fi pamọ́ — gbìyànjú lẹ́ẹ̀kan sí i." },
  "finance.couldNotPrepare": { en: "Could not prepare the report", pidgin: "We no fit prepare the report", ha: "Ba a iya shirya rahoton ba", ig: "Enweghị ike ịkwado akụkọ ahụ", yo: "A kò lè pèsè ìròyìn náà" },

  /* Wallet statement screen */
  "finance.statement":     { en: "Statement", pidgin: "Statement", ha: "Bayanin asusu", ig: "Nkọwa akaụntụ", yo: "Ìwé àkọọ́lẹ̀" },
  "finance.viewList":      { en: "List", pidgin: "List", ha: "Jeri", ig: "Ndepụta", yo: "Àkójọ" },
  "finance.viewInsights":  { en: "Insights", pidgin: "Insights", ha: "Fahimta", ig: "Nghọta", yo: "Òye" },
  "finance.moneyIn":       { en: "Money in", pidgin: "Money wey enter", ha: "Kuɗin shiga", ig: "Ego batara", yo: "Owó tó wọlé" },
  "finance.moneyOut":      { en: "Money out", pidgin: "Money wey comot", ha: "Kuɗin fita", ig: "Ego pụrụ", yo: "Owó tó jáde" },
  "finance.net":           { en: "Net", pidgin: "Net", ha: "Saura", ig: "Nke fọdụrụ", yo: "Àṣẹ́kù" },
  "finance.whereItWent":   { en: "Where it went", pidgin: "Where e go", ha: "Inda ya tafi", ig: "Ebe ọ gara", yo: "Ibi tí ó lọ" },
  "finance.noSpendingRange": { en: "No spending in this range.", pidgin: "No spending for this time.", ha: "Babu kashe kuɗi a wannan lokaci.", ig: "Enweghị mmefu n'oge a.", yo: "Kò sí ìnáwó ní àkókò yìí." },
  "finance.spend_bills":   { en: "Bills", pidgin: "Bills", ha: "Kuɗin biyan buƙatu", ig: "Ụgwọ ọrụ", yo: "Owó iṣẹ́" },
  "finance.spend_transfers": { en: "Transfers out", pidgin: "Transfer wey comot", ha: "Turawa waje", ig: "Ego ezipụrụ", yo: "Owó tí a fi ránṣẹ́" },
  "finance.spend_ajo":     { en: "Ajo & Esusu", pidgin: "Ajo & Esusu", ha: "Ajo da Esusu", ig: "Ajo na Esusu", yo: "Àjọ àti Èsúsú" },
  "finance.spend_subscription": { en: "Subscription", pidgin: "Subscription", ha: "Biyan kuɗin shiri", ig: "Ndenye aha", yo: "Owó ìforúkọsílẹ̀" },
  "finance.spend_fees":    { en: "Fees & levies", pidgin: "Charges & levy", ha: "Kuɗaɗe da haraji", ig: "Ụgwọ na levi", yo: "Owó àsanpadà àti owó-orí" },
  "finance.spend_other":   { en: "Other", pidgin: "Other", ha: "Wasu", ig: "Ndị ọzọ", yo: "Òmíràn" },
  "finance.searchStatement": { en: "Search narration, type, amount…", pidgin: "Search narration, type, amount…", ha: "Bincika bayani, iri, adadi…", ig: "Chọọ nkọwa, ụdị, ego…", yo: "Wá àlàyé, irú, iye owó…" },
  "finance.noTxRange":     { en: "No transactions in this range.", pidgin: "No transaction for this time.", ha: "Babu ma'amala a wannan lokaci.", ig: "Enweghị azụmahịa n'oge a.", yo: "Kò sí ìdúnàádúrà ní àkókò yìí." },
  "finance.showingRecent": { en: "Showing the most recent {n} transactions.", pidgin: "Na the latest {n} transactions we dey show.", ha: "Ana nuna ma'amaloli {n} na baya-bayan nan.", ig: "Na-egosi azụmahịa {n} kacha ọhụrụ.", yo: "À ń fi ìdúnàádúrà {n} tó ṣẹ̀ṣẹ̀ jùlọ hàn." },

  /* Owner monthly reports */
  "finance.monthlyReports":  { en: "Monthly reports", pidgin: "Monthly reports", ha: "Rahotannin wata-wata", ig: "Akụkọ kwa ọnwa", yo: "Ìròyìn oṣooṣù" },
  "finance.monthlyIntro1":   { en: "On the 1st of every month we send you last month's ", pidgin: "For 1st of every month we go send you last month ", ha: "A ranar 1 ga kowane wata muna aiko maka na watan jiya: ", ig: "N'ụbọchị 1 nke ọnwa ọ bụla, anyị na-ezitere gị nke ọnwa gara aga: ", yo: "Ní ọjọ́ kìíní oṣù kọ̀ọ̀kan a máa ń fi ti oṣù tó kọjá ránṣẹ́ sí ọ: " },
  "finance.businessReportTitle": { en: "Business Report", pidgin: "Business Report", ha: "Rahoton Kasuwanci", ig: "Akụkọ Azụmahịa", yo: "Ìròyìn Iṣẹ́ Òwò" },
  "finance.walletStatementTitle": { en: "Wallet Statement", pidgin: "Wallet Statement", ha: "Bayanin Walat", ig: "Nkọwa Wallet", yo: "Àkọọ́lẹ̀ Àpò-owó" },
  "finance.monthlyIntroAnd": { en: " and ", pidgin: " and ", ha: " da ", ig: " na ", yo: " àti " },
  "finance.monthlyIntro2":   { en: " as PDFs — here in the app", pidgin: " as PDF — here for the app", ha: " a matsayin PDF — a nan cikin manhaja", ig: " dịka PDF — ebe a n'ime ngwa", yo: " gẹ́gẹ́ bí PDF — níbí nínú áàpù" },
  "finance.monthlyIntroTo":  { en: " and to ", pidgin: " and to ", ha: " da kuma zuwa ", ig: " na kwa ", yo: " àti sí " },
  "finance.monthlyIntro3":   { en: ". Each has a QR code anyone can scan to check it's genuine.", pidgin: ". Each one get QR code wey anybody fit scan to check say e real.", ha: ". Kowanne yana da lambar QR da kowa zai iya duba don tabbatar da sahihancinsa.", ig: ". Nke ọ bụla nwere koodu QR onye ọ bụla nwere ike nyochaa ịmata na ọ bụ nke ezi.", yo: ". Ọ̀kọ̀ọ̀kan ní kóòdù QR tí ẹnikẹ́ni lè ṣàyẹ̀wò láti mọ̀ pé òtítọ́ ni." },
  "finance.emailThemToMe":   { en: "Email them to me", pidgin: "Email dem give me", ha: "Aiko min su ta imel", ig: "Zitere m ha na email", yo: "Fi wọ́n ránṣẹ́ sí mi ní ímeèlì" },
  "finance.emailOnNote":     { en: "On — PDFs attached to an email on the 1st", pidgin: "On — PDF go dey inside email for 1st", ha: "A kunne — PDF a haɗe da imel a ranar 1", ig: "Ọ gbanyere — PDF ga-adị n'email n'ụbọchị 1", yo: "Ó wà ní títàn — PDF á wà nínú ímeèlì ní ọjọ́ kìíní" },
  "finance.emailOffNote":    { en: "Off — you'll still get them here in the app", pidgin: "Off — you go still see dem here for the app", ha: "A kashe — za ka ci gaba da samunsu a nan cikin manhaja", ig: "Ọ gbanyụrụ — ị ka ga-enweta ha ebe a n'ime ngwa", yo: "Ó wà ní pípa — o ṣì máa rí wọn níbí nínú áàpù" },
  "finance.soFarThisMonth":  { en: "So far this month", pidgin: "This month so far", ha: "Zuwa yanzu a wannan wata", ig: "Ruo ugbu a n'ọnwa a", yo: "Títí di báyìí lóṣù yìí" },
  "finance.sentOn":          { en: "Sent {date}", pidgin: "We send am {date}", ha: "An aika {date}", ig: "E zigara {date}", yo: "A fi ránṣẹ́ {date}" },
  "finance.businessReport":  { en: "Business report", pidgin: "Business report", ha: "Rahoton kasuwanci", ig: "Akụkọ azụmahịa", yo: "Ìròyìn iṣẹ́ òwò" },
  "finance.walletStatement": { en: "Wallet statement", pidgin: "Wallet statement", ha: "Bayanin walat", ig: "Nkọwa wallet", yo: "Àkọọ́lẹ̀ àpò-owó" },
  "finance.businessAndWallet": { en: "Business report and wallet statement", pidgin: "Business report and wallet statement", ha: "Rahoton kasuwanci da bayanin walat", ig: "Akụkọ azụmahịa na nkọwa wallet", yo: "Ìròyìn iṣẹ́ òwò àti àkọọ́lẹ̀ àpò-owó" },

  /* Business loan application */
  "finance.loanTitle":        { en: "Business Loan Application", pidgin: "Business Loan Application", ha: "Neman Lamunin Kasuwanci", ig: "Arịrịọ Mbinye Ego Azụmahịa", yo: "Ìbéèrè Fún Ẹ̀yáwó Iṣẹ́ Òwò" },
  "finance.loanReviewTime":   { en: "Our lending team reviews within 3–5 business days", pidgin: "Our loan team go check am inside 3–5 working days", ha: "Ƙungiyar lamuninmu na dubawa cikin kwanakin aiki 3–5", ig: "Ndị otu mbinye ego anyị na-enyocha n'ime ụbọchị ọrụ 3–5", yo: "Ẹgbẹ́ ẹ̀yáwó wa ń ṣàyẹ̀wò láàrin ọjọ́ iṣẹ́ 3–5" },
  "finance.loanSubmittedTitle": { en: "Application Submitted!", pidgin: "Application don enter!", ha: "An tura neman!", ig: "E zigala arịrịọ ahụ!", yo: "A ti fi ìbéèrè ránṣẹ́!" },
  "finance.loanSubmittedBody1": { en: "Our lending team will review your application and contact you within ", pidgin: "Our loan team go check your application and call you inside ", ha: "Ƙungiyar lamuninmu za ta duba buƙatarka kuma ta tuntuɓe ka cikin ", ig: "Ndị otu mbinye ego anyị ga-enyocha arịrịọ gị ma kpọtụrụ gị n'ime ", yo: "Ẹgbẹ́ ẹ̀yáwó wa yóò ṣàyẹ̀wò ìbéèrè rẹ, wọn yóò sì kàn sí ọ láàrin " },
  "finance.loanSubmittedDays":  { en: "3–5 business days", pidgin: "3–5 working days", ha: "kwanakin aiki 3–5", ig: "ụbọchị ọrụ 3–5", yo: "ọjọ́ iṣẹ́ 3–5" },
  "finance.loanSubmittedBody2": { en: ".", pidgin: ".", ha: ".", ig: ".", yo: "." },
  "finance.loanFillRequired": { en: "Please fill in all required fields.", pidgin: "Abeg fill all the fields wey you must fill.", ha: "Da fatan za a cike duk filayen da ake buƙata.", ig: "Biko dejupụta ebe niile achọrọ.", yo: "Jọ̀wọ́ kún gbogbo àyè tí ó pọn dandan." },
  "finance.loanSubmitFailed": { en: "Could not submit application. Please try again.", pidgin: "We no fit send the application. Abeg try again.", ha: "Ba a iya tura neman ba. Da fatan a sake gwadawa.", ig: "Enweghị ike izipu arịrịọ ahụ. Biko nwaa ọzọ.", yo: "A kò lè fi ìbéèrè ránṣẹ́. Jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan sí i." },
  "finance.loanFullName":     { en: "Full Name", pidgin: "Full Name", ha: "Cikakken Suna", ig: "Aha Zuru Ezu", yo: "Orúkọ Kíkún" },
  "finance.loanFullNamePh":   { en: "Your full name", pidgin: "Your full name", ha: "Cikakken sunanka", ig: "Aha gị zuru ezu", yo: "Orúkọ rẹ kíkún" },
  "finance.loanBizName":      { en: "Business Name", pidgin: "Business Name", ha: "Sunan Kasuwanci", ig: "Aha Azụmahịa", yo: "Orúkọ Iṣẹ́ Òwò" },
  "finance.loanBizNamePh":    { en: "Your business name", pidgin: "Your business name", ha: "Sunan kasuwancinka", ig: "Aha azụmahịa gị", yo: "Orúkọ iṣẹ́ òwò rẹ" },
  "finance.loanPhone":        { en: "Phone Number *", pidgin: "Phone Number *", ha: "Lambar Waya *", ig: "Nọmba Ekwentị *", yo: "Nọ́ńbà Fóònù *" },
  "finance.loanPhonePh":      { en: "e.g. 08012345678", pidgin: "e.g. 08012345678", ha: "misali 08012345678", ig: "dịka 08012345678", yo: "àpẹẹrẹ 08012345678" },
  "finance.loanBizType":      { en: "Business Type *", pidgin: "Business Type *", ha: "Irin Kasuwanci *", ig: "Ụdị Azụmahịa *", yo: "Irú Iṣẹ́ Òwò *" },
  "finance.loanSelectBizType": { en: "Select business type", pidgin: "Choose business type", ha: "Zaɓi irin kasuwanci", ig: "Họrọ ụdị azụmahịa", yo: "Yan irú iṣẹ́ òwò" },
  "finance.loanType0": { en: "Retail / Trading", pidgin: "Retail / Trading", ha: "Saye da Sayarwa", ig: "Ire Ahịa / Azụmahịa", yo: "Títà / Káràkátà" },
  "finance.loanType1": { en: "Food & Catering", pidgin: "Food & Catering", ha: "Abinci da Girki", ig: "Nri na Isi Nri", yo: "Oúnjẹ àti Ìpèsè Oúnjẹ" },
  "finance.loanType2": { en: "Fashion & Clothing", pidgin: "Fashion & Cloth", ha: "Kayan Ado da Tufafi", ig: "Ejiji na Uwe", yo: "Ìmúra àti Aṣọ" },
  "finance.loanType3": { en: "Logistics & Delivery", pidgin: "Logistics & Delivery", ha: "Sufuri da Isar da Kaya", ig: "Njem na Nnyefe", yo: "Ìrìnnà àti Ìfijíṣẹ́" },
  "finance.loanType4": { en: "Agriculture & Farming", pidgin: "Agriculture & Farming", ha: "Noma da Kiwo", ig: "Ọrụ Ugbo", yo: "Iṣẹ́ Àgbẹ̀" },
  "finance.loanType5": { en: "Technology & Services", pidgin: "Technology & Services", ha: "Fasaha da Ayyuka", ig: "Teknụzụ na Ọrụ", yo: "Ìmọ̀ Ẹ̀rọ àti Iṣẹ́" },
  "finance.loanType6": { en: "Health & Beauty", pidgin: "Health & Beauty", ha: "Lafiya da Kwalliya", ig: "Ahụike na Mma", yo: "Ìlera àti Ẹwà" },
  "finance.loanType7": { en: "Construction & Real Estate", pidgin: "Construction & Real Estate", ha: "Gine-gine da Gidaje", ig: "Iwu Ụlọ na Ala", yo: "Ìkọ́lé àti Ilé-Ilẹ̀" },
  "finance.loanType8": { en: "Education", pidgin: "Education", ha: "Ilimi", ig: "Agụmakwụkwọ", yo: "Ẹ̀kọ́" },
  "finance.loanType9": { en: "Other", pidgin: "Other", ha: "Wani", ig: "Ọzọ", yo: "Òmíràn" },
  "finance.loanYears":        { en: "Years in Business", pidgin: "Years wey you don do business", ha: "Shekaru a Kasuwanci", ig: "Afọ n'Azụmahịa", yo: "Ọdún Nínú Iṣẹ́ Òwò" },
  "finance.loanSelectDuration": { en: "Select duration", pidgin: "Choose how long", ha: "Zaɓi tsawon lokaci", ig: "Họrọ ogologo oge", yo: "Yan iye àkókò" },
  "finance.loanYears0": { en: "Less than 1 year", pidgin: "Less than 1 year", ha: "Ƙasa da shekara 1", ig: "Erughị afọ 1", yo: "Kò tó ọdún 1" },
  "finance.loanYears1": { en: "1–2 years", pidgin: "1–2 years", ha: "Shekara 1–2", ig: "Afọ 1–2", yo: "Ọdún 1–2" },
  "finance.loanYears2": { en: "2–5 years", pidgin: "2–5 years", ha: "Shekara 2–5", ig: "Afọ 2–5", yo: "Ọdún 2–5" },
  "finance.loanYears3": { en: "5–10 years", pidgin: "5–10 years", ha: "Shekara 5–10", ig: "Afọ 5–10", yo: "Ọdún 5–10" },
  "finance.loanYears4": { en: "10+ years", pidgin: "10+ years", ha: "Shekara 10+", ig: "Afọ 10+", yo: "Ọdún 10+" },
  "finance.loanAmount":       { en: "Loan Amount (₦) *", pidgin: "Loan Amount (₦) *", ha: "Adadin Lamuni (₦) *", ig: "Ego Mbinye (₦) *", yo: "Iye Ẹ̀yáwó (₦) *" },
  "finance.loanAmountPh":     { en: "e.g. 500000", pidgin: "e.g. 500000", ha: "misali 500000", ig: "dịka 500000", yo: "àpẹẹrẹ 500000" },
  "finance.loanMonthlyRevenue": { en: "Monthly Revenue (₦)", pidgin: "Monthly Income (₦)", ha: "Kuɗin Shiga na Wata (₦)", ig: "Ego Mbata Kwa Ọnwa (₦)", yo: "Owó Tó Ń Wọlé Lóṣù (₦)" },
  "finance.loanMonthlyRevenuePh": { en: "Approximate monthly income", pidgin: "About how much enter every month", ha: "Kimanin kuɗin shiga na wata", ig: "Ihe dịka ego na-abata kwa ọnwa", yo: "Iye owó tó ń wọlé lóṣù ní ìwọ̀nba" },
  "finance.loanPurpose":      { en: "Loan Purpose *", pidgin: "Wetin the loan be for *", ha: "Dalilin Lamuni *", ig: "Ebumnuche Mbinye *", yo: "Ìdí Ẹ̀yáwó *" },
  "finance.loanPurposePh":    { en: "Briefly describe what the loan will be used for…", pidgin: "Talk small wetin you go use the loan do…", ha: "A taƙaice bayyana abin da za a yi da lamunin…", ig: "Kọwaa nkenke ihe a ga-eji mbinye ego ahụ mee…", yo: "Ṣàlàyé ní ṣókí ohun tí a ó fi ẹ̀yáwó náà ṣe…" },
  "finance.loanSubmitting":   { en: "Submitting…", pidgin: "E dey send…", ha: "Ana turawa…", ig: "Ọ na-ezipu…", yo: "Ó ń fi ránṣẹ́…" },
  "finance.loanSubmit":       { en: "Submit Application", pidgin: "Send Application", ha: "Tura Neman", ig: "Zipu Arịrịọ", yo: "Fi Ìbéèrè Ránṣẹ́" },
  "finance.loanSecureNote":   { en: "Your information is secure and will only be used for loan assessment.", pidgin: "Your information safe, na only to check the loan we go use am.", ha: "Bayananka suna cikin aminci kuma za a yi amfani da su ne kawai don tantance lamuni.", ig: "Ozi gị dị nchebe, a ga-eji ya naanị maka nyocha mbinye ego.", yo: "Àlàyé rẹ wà ní ààbò, a ó sì lò ó fún àyẹ̀wò ẹ̀yáwó nìkan." },

  /* Insights */
  "finance.aiQuickTodaySales":  { en: "Today's Sales", pidgin: "Today Sales", ha: "Tallace-tallacen Yau", ig: "Ahịa Taa", yo: "Títà Òní" },
  "finance.aiQuickTotalProfit": { en: "Total Profit", pidgin: "Total Profit", ha: "Jimillar Riba", ig: "Uru Niile", yo: "Àpapọ̀ Èrè" },
  "finance.aiQuickCredit":      { en: "Outstanding Credit", pidgin: "Credit wey remain", ha: "Bashin da ya rage", ig: "Ụgwọ fọdụrụ", yo: "Gbèsè tó kù" },
  "finance.aiQuickTopCustomers": { en: "Top Customers", pidgin: "Top Customers", ha: "Manyan Abokan Ciniki", ig: "Ndị Ahịa Kacha Mma", yo: "Àwọn Oníbàárà Tó Ga Jù" },
  "finance.aiQuickStock":       { en: "Stock Status", pidgin: "Stock Status", ha: "Halin Kaya", ig: "Ọnọdụ Ngwaahịa", yo: "Ipò Ọjà" },
  "finance.perDayBased28":      { en: "{amount}/day · based on 28-day data", pidgin: "{amount}/day · from 28-day data", ha: "{amount}/rana · bisa bayanan kwana 28", ig: "{amount}/ụbọchị · dabere na data ụbọchị 28", yo: "{amount}/ọjọ́ · láti inú àkọsílẹ̀ ọjọ́ 28" },
  "finance.qtyLeft":            { en: "{n} left", pidgin: "{n} remain", ha: "{n} ya rage", ig: "{n} fọdụrụ", yo: "{n} ló kù" },
  "finance.noFastMoving":       { en: "No fast-moving products yet", pidgin: "No fast-moving product yet", ha: "Babu kayan da ke saurin sayuwa tukuna", ig: "Enweghị ngwaahịa na-ere ngwa ngwa ugbu a", yo: "Kò sí ọjà tó ń tà kíákíá síbẹ̀" },
  "finance.qtyInStock":         { en: "{n} in stock", pidgin: "{n} dey stock", ha: "{n} a cikin kaya", ig: "{n} dị n'ngwaahịa", yo: "{n} wà nínú ọjà" },
  "finance.thresholdUnits":     { en: "Threshold: {n} units", pidgin: "Limit: {n} units", ha: "Iyaka: guda {n}", ig: "Oke: {n} ọnụọgụ", yo: "Òdiwọ̀n: {n} ẹyọ" },
  "finance.unitsLeft":          { en: "units left", pidgin: "units remain", ha: "guda suka rage", ig: "ọnụọgụ fọdụrụ", yo: "ẹyọ ló kù" },
  "finance.aiInsightsFailed":   { en: "Could not generate insights. Please check your connection and try again.", pidgin: "We no fit bring insights. Abeg check your network and try again.", ha: "Ba a iya samar da bayani ba. Da fatan a duba haɗin intanet ɗinka a sake gwadawa.", ig: "Enweghị ike imepụta nghọta. Biko lelee njikọ gị ma nwaa ọzọ.", yo: "A kò lè ṣe àgbéyẹ̀wò. Jọ̀wọ́ ṣàyẹ̀wò ìsopọ̀ rẹ kí o sì gbìyànjú lẹ́ẹ̀kan sí i." },
  "finance.personalStats":      { en: "{name} · personal stats", pidgin: "{name} · your own stats", ha: "{name} · ƙididdigar kai", ig: "{name} · ọnụọgụ nke onwe", yo: "{name} · ìṣirò ti ara ẹni" },
  "finance.insightsSubtitle":   { en: "Smart analytics · AI insights · Reports", pidgin: "Smart analytics · AI insights · Reports", ha: "Nazari mai wayo · Fahimtar AI · Rahotanni", ig: "Nyocha amamihe · Nghọta AI · Akụkọ", yo: "Àgbéyẹ̀wò ọlọ́gbọ́n · Òye AI · Ìròyìn" },
  "finance.aiAssistantName":    { en: "KudiAI Business Assistant", pidgin: "KudiAI Business Assistant", ha: "Mataimakin Kasuwanci na KudiAI", ig: "Onye Enyemaka Azụmahịa KudiAI", yo: "Olùrànlọ́wọ́ Iṣẹ́ Òwò KudiAI" },
  "finance.openChat":           { en: "Open Chat", pidgin: "Open Chat", ha: "Buɗe Hira", ig: "Mepee Mkparịta", yo: "Ṣí Ìjíròrò" },
  "finance.geminiInsight":      { en: "Gemini AI Insight", pidgin: "Gemini AI Insight", ha: "Fahimtar Gemini AI", ig: "Nghọta Gemini AI", yo: "Òye Gemini AI" },
  "finance.listen":             { en: "Listen", pidgin: "Listen", ha: "Saurara", ig: "Gee ntị", yo: "Gbọ́" },
  "finance.aiPlanNote":         { en: "AI-powered business insights are available on the {plan} plan.", pidgin: "AI business insights dey for {plan} plan.", ha: "Fahimtar kasuwanci ta AI tana kan tsarin {plan}.", ig: "Nghọta azụmahịa AI dị na atụmatụ {plan}.", yo: "Òye iṣẹ́ òwò AI wà lórí ètò {plan}." },
  "finance.higherPlan":         { en: "higher", pidgin: "higher", ha: "mafi girma", ig: "dị elu", yo: "tó ga jù" },

  /* Reports — on-screen preview: table / stat labels (the PDF itself stays English) */
  "finance.rl_activeStaff":    { en: "Active Staff", pidgin: "Active Staff", ha: "Ma'aikata Masu Aiki", ig: "Ndị Ọrụ Na-arụ", yo: "Òṣìṣẹ́ Tó Ń Ṣiṣẹ́" },
  "finance.rl_ajo":            { en: "Ajo", pidgin: "Ajo", ha: "Ajo", ig: "Ajo", yo: "Àjọ" },
  "finance.rl_ajoProfit":      { en: "Ajo Profit", pidgin: "Ajo Profit", ha: "Ribar Ajo", ig: "Uru Ajo", yo: "Èrè Àjọ" },
  "finance.rl_amount":         { en: "Amount", pidgin: "Amount", ha: "Adadi", ig: "Ego", yo: "Iye owó" },
  "finance.rl_averageSale":    { en: "Average Sale", pidgin: "Average Sale", ha: "Matsakaicin Siyarwa", ig: "Nkezi Ahịa", yo: "Àròpín Títà" },
  "finance.rl_balance":        { en: "Balance", pidgin: "Balance", ha: "Ragowa", ig: "Ego fọdụrụ", yo: "Ìyókù" },
  "finance.rl_billProfit":     { en: "Bill Profit", pidgin: "Bill Profit", ha: "Ribar Biyan Buƙatu", ig: "Uru Ụgwọ Ọrụ", yo: "Èrè Owó Iṣẹ́" },
  "finance.rl_billsPaid":      { en: "Bills Paid", pidgin: "Bills wey you pay", ha: "Kuɗin da aka biya", ig: "Ụgwọ a kwụrụ", yo: "Owó iṣẹ́ tí a san" },
  "finance.rl_bought":         { en: "Bought", pidgin: "Buy", ha: "An saya", ig: "Zụrụ", yo: "Rà" },
  "finance.rl_cashbackEarned": { en: "Cashback Earned", pidgin: "Cashback wey you get", ha: "Kuɗin dawowa da aka samu", ig: "Ego nlọghachi enwetara", yo: "Owó ìdápadà tí a rí" },
  "finance.rl_category":       { en: "Category", pidgin: "Category", ha: "Rukuni", ig: "Ụdị", yo: "Ẹ̀ka" },
  "finance.rl_client":         { en: "Client", pidgin: "Client", ha: "Abokin ciniki", ig: "Onye ahịa", yo: "Oníbàárà" },
  "finance.rl_clients":        { en: "Clients", pidgin: "Clients", ha: "Abokan ciniki", ig: "Ndị ahịa", yo: "Àwọn oníbàárà" },
  "finance.rl_collections":    { en: "Collections", pidgin: "Collections", ha: "Tara kuɗi", ig: "Nchịkọta", yo: "Owó tí a gbà" },
  "finance.rl_contributions":  { en: "Contributions", pidgin: "Contributions", ha: "Gudummawa", ig: "Ntinye ego", yo: "Owó àdáṣe" },
  "finance.rl_cost":           { en: "Cost", pidgin: "Cost", ha: "Farashi", ig: "Ọnụahịa", yo: "Iye owó rírà" },
  "finance.rl_costOfGoods":    { en: "Cost of Goods", pidgin: "Cost of Goods", ha: "Farashin Kaya", ig: "Ọnụahịa Ngwaahịa", yo: "Iye Owó Ọjà" },
  "finance.rl_count":          { en: "Count", pidgin: "Count", ha: "Adadi", ig: "Ọnụọgụ", yo: "Iye" },
  "finance.rl_creditSales":    { en: "Credit Sales", pidgin: "Credit Sales", ha: "Siyarwa ta Bashi", ig: "Ahịa Mgbazinye", yo: "Títà Àwìn" },
  "finance.rl_credits":        { en: "Credits", pidgin: "Credits", ha: "Basussuka", ig: "Ụgwọ", yo: "Àwìn" },
  "finance.rl_creditsAdded":   { en: "Credits Added", pidgin: "Credits wey dem add", ha: "Basussukan da aka ƙara", ig: "Ụgwọ etinyere", yo: "Àwìn tí a fi kún" },
  "finance.rl_customer":       { en: "Customer", pidgin: "Customer", ha: "Abokin ciniki", ig: "Onye ahịa", yo: "Oníbàárà" },
  "finance.rl_date":           { en: "Date", pidgin: "Date", ha: "Kwanan wata", ig: "Ụbọchị", yo: "Ọjọ́" },
  "finance.rl_daysLate":       { en: "Days late", pidgin: "Days late", ha: "Kwanakin jinkiri", ig: "Ụbọchị ọ gafere", yo: "Ọjọ́ tó ti kọjá" },
  "finance.rl_dueDate":        { en: "Due Date", pidgin: "Due Date", ha: "Ranar Biya", ig: "Ụbọchị Ịkwụ", yo: "Ọjọ́ Ìsanwó" },
  "finance.rl_dueDate2":       { en: "Due date", pidgin: "Due date", ha: "Ranar biya", ig: "Ụbọchị ịkwụ", yo: "Ọjọ́ ìsanwó" },
  "finance.rl_expenses":       { en: "Expenses", pidgin: "Expenses", ha: "Kashe-kashe", ig: "Mmefu", yo: "Ìnáwó" },
  "finance.rl_failed":         { en: "Failed", pidgin: "Fail", ha: "Ya kasa", ig: "Dara", yo: "Kùnà" },
  "finance.rl_grossProfit":    { en: "Gross Profit", pidgin: "Gross Profit", ha: "Babban Riba", ig: "Uru Niile", yo: "Èrè Gbogbo" },
  "finance.rl_income":         { en: "Income", pidgin: "Income", ha: "Kuɗin shiga", ig: "Ego mbata", yo: "Owó wíwọlé" },
  "finance.rl_item":           { en: "Item", pidgin: "Item", ha: "Kaya", ig: "Ngwa", yo: "Ọjà" },
  "finance.rl_itemsSold":      { en: "Items Sold", pidgin: "Items wey sell", ha: "Kayan da aka sayar", ig: "Ngwa erere", yo: "Ọjà tí a tà" },
  "finance.rl_late":           { en: "Late", pidgin: "Late", ha: "Jinkiri", ig: "Ọ gafere", yo: "Ó pẹ́" },
  "finance.rl_lowStock":       { en: "Low Stock", pidgin: "Stock don low", ha: "Ƙarancin Kaya", ig: "Ngwaahịa Dị Ala", yo: "Ọjà Tó Kéré" },
  "finance.rl_manualDep":      { en: "Manual Dep.", pidgin: "Hand Deposit", ha: "Ajiya da hannu", ig: "Ntinye aka", yo: "Ìfowópamọ́ ọwọ́" },
  "finance.rl_margin":         { en: "Margin", pidgin: "Margin", ha: "Ribar kashi", ig: "Oke uru", yo: "Ìpín èrè" },
  "finance.rl_moneyIn":        { en: "Money In", pidgin: "Money Enter", ha: "Kuɗin Shiga", ig: "Ego Batara", yo: "Owó Tó Wọlé" },
  "finance.rl_moneyOut":       { en: "Money Out", pidgin: "Money Comot", ha: "Kuɗin Fita", ig: "Ego Pụrụ", yo: "Owó Tó Jáde" },
  "finance.rl_net":            { en: "Net", pidgin: "Net", ha: "Saura", ig: "Nke fọdụrụ", yo: "Àṣẹ́kù" },
  "finance.rl_netCash":        { en: "Net Cash", pidgin: "Net Cash", ha: "Sauran Kuɗi", ig: "Ego Fọdụrụ", yo: "Owó Àṣẹ́kù" },
  "finance.rl_netProfit":      { en: "Net Profit", pidgin: "Net Profit", ha: "Ribar Ƙarshe", ig: "Uru Ikpeazụ", yo: "Èrè Àṣẹ́kù" },
  "finance.rl_numberPaid":     { en: "Number Paid", pidgin: "How many paid", ha: "Adadin da aka biya", ig: "Ọnụọgụ a kwụrụ", yo: "Iye tí a san" },
  "finance.rl_outstanding":    { en: "Outstanding", pidgin: "Wey remain", ha: "Saura", ig: "Fọdụrụ", yo: "Tó kù" },
  "finance.rl_overdue":        { en: "Overdue", pidgin: "Don pass time", ha: "Ya wuce lokaci", ig: "Gafere oge", yo: "Ti kọjá àkókò" },
  "finance.rl_overdueCustomer": { en: "Overdue customer", pidgin: "Customer wey time don pass", ha: "Abokin ciniki da ya wuce lokaci", ig: "Onye ahịa gafere oge", yo: "Oníbàárà tí àkókò rẹ̀ ti kọjá" },
  "finance.rl_owed":           { en: "Owed", pidgin: "Wey dem owe", ha: "Bashi", ig: "Ụgwọ", yo: "Gbèsè" },
  "finance.rl_paid":           { en: "Paid", pidgin: "Paid", ha: "An biya", ig: "Kwụrụ", yo: "Ti san" },
  "finance.rl_payment":        { en: "Payment", pidgin: "Payment", ha: "Biya", ig: "Ịkwụ ụgwọ", yo: "Ìsanwó" },
  "finance.rl_periodCollections": { en: "Period Collections", pidgin: "Collections for this time", ha: "Tara kuɗin lokacin", ig: "Nchịkọta oge a", yo: "Owó tí a gbà ní àkókò yìí" },
  "finance.rl_periodWithdrawals": { en: "Period Withdrawals", pidgin: "Withdrawals for this time", ha: "Cire kuɗin lokacin", ig: "Mwepụ ego oge a", yo: "Owó tí a gbà jáde ní àkókò yìí" },
  "finance.rl_pinDiscount":    { en: "PIN Discount", pidgin: "PIN Discount", ha: "Rangwamen PIN", ig: "Mbelata PIN", yo: "Ẹ̀dínwó PIN" },
  "finance.rl_profit":         { en: "Profit", pidgin: "Profit", ha: "Riba", ig: "Uru", yo: "Èrè" },
  "finance.rl_profitOnCredit": { en: "Profit on Credit", pidgin: "Profit on Credit", ha: "Riba akan Bashi", ig: "Uru na Mgbazinye", yo: "Èrè Lórí Àwìn" },
  "finance.rl_profitOnSales":  { en: "Profit on Sales", pidgin: "Profit on Sales", ha: "Riba akan Siyarwa", ig: "Uru na Ahịa", yo: "Èrè Lórí Títà" },
  "finance.rl_qty":            { en: "Qty", pidgin: "Qty", ha: "Yawa", ig: "Ọnụọgụ", yo: "Iye" },
  "finance.rl_recovered":      { en: "Recovered", pidgin: "Collected back", ha: "An karɓo", ig: "Nwetaghachiri", yo: "Tí a gbà padà" },
  "finance.rl_repayments":     { en: "Repayments", pidgin: "Payback", ha: "Biyan bashi", ig: "Nkwụghachi", yo: "Ìsanpadà" },
  "finance.rl_restock":        { en: "Restock", pidgin: "Restock", ha: "Sake saya", ig: "Zụtaghachi", yo: "Ìrà-padà" },
  "finance.rl_revenue":        { en: "Revenue", pidgin: "Revenue", ha: "Kuɗin shiga", ig: "Ego mbata", yo: "Owó wíwọlé" },
  "finance.rl_sales":          { en: "Sales", pidgin: "Sales", ha: "Tallace-tallace", ig: "Ahịa", yo: "Títà" },
  "finance.rl_savingsHeld":    { en: "Savings Held", pidgin: "Savings wey dey hand", ha: "Ajiyar da ake riƙe", ig: "Nchekwa ejidere", yo: "Owó ìpamọ́ tó wà lọ́wọ́" },
  "finance.rl_sold":           { en: "Sold", pidgin: "Sold", ha: "An sayar", ig: "Erere", yo: "Tí a tà" },
  "finance.rl_spentOnStock":   { en: "Spent on Stock", pidgin: "Money wey enter stock", ha: "Kashewa akan Kaya", ig: "Ego emefuru na Ngwaahịa", yo: "Owó Tí a Ná Sórí Ọjà" },
  "finance.rl_staff":          { en: "Staff", pidgin: "Staff", ha: "Ma'aikaci", ig: "Onye ọrụ", yo: "Òṣìṣẹ́" },
  "finance.rl_staffMember":    { en: "Staff Member", pidgin: "Staff", ha: "Ma'aikaci", ig: "Onye Ọrụ", yo: "Òṣìṣẹ́" },
  "finance.rl_status":         { en: "Status", pidgin: "Status", ha: "Matsayi", ig: "Ọnọdụ", yo: "Ipò" },
  "finance.rl_stockOnHand":    { en: "Stock on Hand", pidgin: "Stock wey dey", ha: "Kayan da ke hannu", ig: "Ngwaahịa dị n'aka", yo: "Ọjà Tó Wà Lọ́wọ́" },
  "finance.rl_stockProfit":    { en: "Stock Profit", pidgin: "Stock Profit", ha: "Ribar Kaya", ig: "Uru Ngwaahịa", yo: "Èrè Ọjà" },
  "finance.rl_total":          { en: "Total", pidgin: "Total", ha: "Jimilla", ig: "Ngụkọta", yo: "Àpapọ̀" },
  "finance.rl_totalBillsPaid": { en: "Total Bills Paid", pidgin: "Total Bills wey you pay", ha: "Jimillar Kuɗin da aka Biya", ig: "Ngụkọta Ụgwọ A Kwụrụ", yo: "Àpapọ̀ Owó Iṣẹ́ Tí a San" },
  "finance.rl_totalDebt":      { en: "Total Debt", pidgin: "Total Debt", ha: "Jimillar Bashi", ig: "Ngụkọta Ụgwọ", yo: "Àpapọ̀ Gbèsè" },
  "finance.rl_totalPaid":      { en: "Total Paid", pidgin: "Total Paid", ha: "Jimillar Biya", ig: "Ngụkọta A Kwụrụ", yo: "Àpapọ̀ Tí a San" },
  "finance.rl_totalSales":     { en: "Total Sales", pidgin: "Total Sales", ha: "Jimillar Siyarwa", ig: "Ngụkọta Ahịa", yo: "Àpapọ̀ Títà" },
  "finance.rl_totalTxns":      { en: "Total Txns", pidgin: "Total Txns", ha: "Jimillar Ma'amala", ig: "Ngụkọta Azụmahịa", yo: "Àpapọ̀ Ìdúnàádúrà" },
  "finance.rl_txns":           { en: "Txns", pidgin: "Txns", ha: "Ma'amala", ig: "Azụmahịa", yo: "Ìdúnàádúrà" },
  "finance.rl_type":           { en: "Type", pidgin: "Type", ha: "Iri", ig: "Ụdị", yo: "Irú" },
  "finance.rl_withdrawals":    { en: "Withdrawals", pidgin: "Withdrawals", ha: "Cire kuɗi", ig: "Mwepụ ego", yo: "Owó tí a gbà jáde" },
  "finance.rs_atCostNow":      { en: "At cost, now", pidgin: "For cost price, now", ha: "A farashin saye, yanzu", ig: "N'ọnụahịa ịzụ, ugbu a", yo: "Ní iye owó rírà, báyìí" },
  "finance.rs_clientsMoney":   { en: "Clients' money", pidgin: "Clients money", ha: "Kuɗin abokan ciniki", ig: "Ego ndị ahịa", yo: "Owó àwọn oníbàárà" },
  "finance.rs_items":          { en: "Items", pidgin: "Items", ha: "Kayayyaki", ig: "Ngwa", yo: "Ọjà" },
  "finance.rs_now":            { en: "Now", pidgin: "Now", ha: "Yanzu", ig: "Ugbu a", yo: "Báyìí" },
  "finance.rs_ofItemsSold":    { en: "Of items sold", pidgin: "Of items wey sell", ha: "Na kayan da aka sayar", ig: "Nke ngwa erere", yo: "Ti ọjà tí a tà" },
  "finance.rs_refunded":       { en: "Refunded", pidgin: "Dem don refund", ha: "An mayar", ig: "Eweghachiri", yo: "A ti dá padà" },
  "finance.rs_runningCosts":   { en: "Running costs — stock purchases and bills are not expenses", pidgin: "Running costs — stock wey you buy and bills no be expenses", ha: "Kuɗin gudanarwa — sayen kaya da biyan buƙatu ba kashe-kashe ba ne", ig: "Mmefu ọrụ — ịzụ ngwaahịa na ụgwọ ọrụ abụghị mmefu", yo: "Owó ìṣiṣẹ́ — rírà ọjà àti owó iṣẹ́ kì í ṣe ìnáwó" },
  "finance.rs_stockExpenses":  { en: "Stock + expenses", pidgin: "Stock + expenses", ha: "Kaya + kashe-kashe", ig: "Ngwaahịa + mmefu", yo: "Ọjà + ìnáwó" },
  "finance.rs_thisPeriod":     { en: "This period", pidgin: "This time", ha: "Wannan lokaci", ig: "Oge a", yo: "Àkókò yìí" },

  /* Reports — section titles */
  "finance.st_ajoProfitSummary":   { en: "Ajo Profit Summary", pidgin: "Ajo Profit Summary", ha: "Taƙaitaccen Ribar Ajo", ig: "Nchịkọta Uru Ajo", yo: "Àkópọ̀ Èrè Àjọ" },
  "finance.st_ajoSavings":         { en: "Ajo savings", pidgin: "Ajo savings", ha: "Ajiyar Ajo", ig: "Nchekwa Ajo", yo: "Ìfowópamọ́ Àjọ" },
  "finance.st_billTransactions":   { en: "Bill Transactions", pidgin: "Bill Transactions", ha: "Ma'amalolin Biyan Buƙatu", ig: "Azụmahịa Ụgwọ Ọrụ", yo: "Ìdúnàádúrà Owó Iṣẹ́" },
  "finance.st_bills":              { en: "Bills", pidgin: "Bills", ha: "Biyan buƙatu", ig: "Ụgwọ ọrụ", yo: "Owó iṣẹ́" },
  "finance.st_byCategory":         { en: "By Category", pidgin: "By Category", ha: "Ta Rukuni", ig: "Site n'Ụdị", yo: "Ní Ẹ̀ka-ẹ̀ka" },
  "finance.st_categoryBreakdown":  { en: "Category Breakdown", pidgin: "Category Breakdown", ha: "Rarraba ta Rukuni", ig: "Nkewa Ụdị", yo: "Ìpínsísọ̀rí Ẹ̀ka" },
  "finance.st_collectionsByClient": { en: "Collections by Client", pidgin: "Collections by Client", ha: "Tara Kuɗi ta Abokin Ciniki", ig: "Nchịkọta site n'Onye Ahịa", yo: "Owó Tí a Gbà Lọ́wọ́ Oníbàárà" },
  "finance.st_credit":             { en: "Credit", pidgin: "Credit", ha: "Bashi", ig: "Mgbazinye", yo: "Àwìn" },
  "finance.st_debtorRecords":      { en: "Debtor Records", pidgin: "Debtor Records", ha: "Bayanan Masu Bashi", ig: "Ndekọ Ndị Ji Ụgwọ", yo: "Àkọsílẹ̀ Àwọn Onígbèsè" },
  "finance.st_incomeVsExpenses":   { en: "Income vs Expenses", pidgin: "Income vs Expenses", ha: "Kuɗin Shiga da Kashe-kashe", ig: "Ego Mbata na Mmefu", yo: "Owó Wíwọlé àti Ìnáwó" },
  "finance.st_itemPerformance":    { en: "Item Performance", pidgin: "How Items dey perform", ha: "Yadda Kaya ke Tafiya", ig: "Arụmọrụ Ngwa", yo: "Bí Ọjà Ṣe Ń Tà" },
  "finance.st_moneyInOut":         { en: "Money in & out", pidgin: "Money enter & comot", ha: "Kuɗin shiga da fita", ig: "Ego batara na pụrụ", yo: "Owó wọlé àti jáde" },
  "finance.st_overdueSummary":     { en: "Overdue Summary", pidgin: "Overdue Summary", ha: "Taƙaitaccen Basussukan da suka Wuce Lokaci", ig: "Nchịkọta Ndị Gafere Oge", yo: "Àkópọ̀ Àwọn Tó Ti Kọjá Àkókò" },
  "finance.st_paymentStatus":      { en: "Payment Status", pidgin: "Payment Status", ha: "Matsayin Biya", ig: "Ọnọdụ Ịkwụ Ụgwọ", yo: "Ipò Ìsanwó" },
  "finance.st_performanceBreakdown": { en: "Performance Breakdown", pidgin: "Performance Breakdown", ha: "Rarraba Aiki", ig: "Nkewa Arụmọrụ", yo: "Ìpínsísọ̀rí Iṣẹ́" },
  "finance.st_periodActivityByClient": { en: "Period Activity by Client", pidgin: "Wetin each client do this time", ha: "Ayyukan Lokacin ta Abokin Ciniki", ig: "Ihe Mere n'Oge a site n'Onye Ahịa", yo: "Ìgbòkègbodò Àkókò Yìí Ní Ti Oníbàárà" },
  "finance.st_revenueByItem":      { en: "Revenue by Item", pidgin: "Revenue by Item", ha: "Kuɗin Shiga ta Kaya", ig: "Ego Mbata site na Ngwa", yo: "Owó Wíwọlé Ní Ti Ọjà" },
  "finance.st_sales":              { en: "Sales", pidgin: "Sales", ha: "Tallace-tallace", ig: "Ahịa", yo: "Títà" },
  "finance.st_salesPerStaffMember": { en: "Sales per Staff Member", pidgin: "Sales for each Staff", ha: "Siyarwa ta Kowane Ma'aikaci", ig: "Ahịa Onye Ọrụ Ọ Bụla", yo: "Títà Òṣìṣẹ́ Kọ̀ọ̀kan" },
  "finance.st_salesProfit":        { en: "Sales & Profit", pidgin: "Sales & Profit", ha: "Siyarwa da Riba", ig: "Ahịa na Uru", yo: "Títà àti Èrè" },
  "finance.st_staffSales":         { en: "Staff sales", pidgin: "Staff sales", ha: "Siyarwar ma'aikata", ig: "Ahịa ndị ọrụ", yo: "Títà òṣìṣẹ́" },
  "finance.st_stock":              { en: "Stock", pidgin: "Stock", ha: "Kaya", ig: "Ngwaahịa", yo: "Ọjà" },
  "finance.st_transactionLog":     { en: "Transaction Log", pidgin: "Transaction List", ha: "Rajistar Ma'amala", ig: "Ndekọ Azụmahịa", yo: "Àkọsílẹ̀ Ìdúnàádúrà" },
  "finance.st_whereTheProfitCameFrom": { en: "Where the profit came from", pidgin: "Where the profit come from", ha: "Inda ribar ta fito", ig: "Ebe uru si bịa", yo: "Ibi tí èrè ti wá" },

  /* Reports — preview text */
  "finance.payCash":        { en: "Cash", pidgin: "Cash", ha: "Tsabar kuɗi", ig: "Ego aka", yo: "Owó ọwọ́" },
  "finance.payTransfer":    { en: "Transfer", pidgin: "Transfer", ha: "Turawa", ig: "Nnyefe", yo: "Ìfiránṣẹ́" },
  "finance.payPos":         { en: "POS", pidgin: "POS", ha: "POS", ig: "POS", yo: "POS" },
  "finance.payMobileMoney": { en: "Mobile Money", pidgin: "Mobile Money", ha: "Kuɗin Waya", ig: "Ego Ekwentị", yo: "Owó Fóònù" },
  "finance.payBill":        { en: "Bill Payment", pidgin: "Bill Payment", ha: "Biyan Buƙatu", ig: "Ịkwụ Ụgwọ Ọrụ", yo: "Ìsanwó Owó Iṣẹ́" },
  "finance.payWallet":      { en: "Wallet", pidgin: "Wallet", ha: "Walat", ig: "Wallet", yo: "Àpò-owó" },
  "finance.payCredit":      { en: "Credit", pidgin: "Credit", ha: "Bashi", ig: "Mgbazinye", yo: "Àwìn" },
  "finance.rptStatusActive":  { en: "ACTIVE", pidgin: "ACTIVE", ha: "MAI AIKI", ig: "Ọ NA-ARỤ", yo: "Ó Ń LỌ" },
  "finance.rptStatusOverdue": { en: "OVERDUE", pidgin: "TIME DON PASS", ha: "YA WUCE LOKACI", ig: "GAFERE OGE", yo: "TI KỌJÁ ÀKÓKÒ" },
  "finance.rptStatusPaid":    { en: "PAID", pidgin: "PAID", ha: "AN BIYA", ig: "KWỤRỤ", yo: "TI SAN" },
  "finance.rptStatusPartial": { en: "PARTIALLY PAID", pidgin: "PAY SMALL", ha: "AN BIYA WANI SASHI", ig: "KWỤRỤ OBERE", yo: "TI SAN DÍẸ̀" },
  "finance.rptNoDataPeriod":  { en: "No data for this period", pidgin: "No data for this time", ha: "Babu bayani a wannan lokaci", ig: "Enweghị data n'oge a", yo: "Kò sí àkọsílẹ̀ ní àkókò yìí" },
  "finance.rptIncome":        { en: "Income", pidgin: "Income", ha: "Kuɗin shiga", ig: "Ego mbata", yo: "Owó wíwọlé" },
  "finance.rptExpense":       { en: "Expense", pidgin: "Expense", ha: "Kashewa", ig: "Mmefu", yo: "Ìnáwó" },
  "finance.rptNoCostPrice":   { en: "No cost price", pidgin: "No cost price", ha: "Babu farashin saye", ig: "Enweghị ọnụahịa ịzụ", yo: "Kò sí iye owó rírà" },
  "finance.rptNoCost":        { en: "No cost", pidgin: "No cost", ha: "Babu farashi", ig: "Enweghị ọnụahịa", yo: "Kò sí iye owó" },
  "finance.rptFirst50Sales":  { en: "Showing first 50 of {n} sales — the PDF lists them all", pidgin: "Na first 50 of {n} sales we dey show — the PDF get all", ha: "Ana nuna farkon 50 cikin siyarwa {n} — PDF na da su duka", ig: "Na-egosi 50 mbụ n'ime ahịa {n} — PDF nwere ha niile", yo: "À ń fi 50 àkọ́kọ́ hàn nínú títà {n} — PDF ní gbogbo wọn" },
  "finance.rptFirst50Tx":     { en: "Showing first 50 of {n} transactions", pidgin: "Na first 50 of {n} transactions we dey show", ha: "Ana nuna farkon 50 cikin ma'amala {n}", ig: "Na-egosi 50 mbụ n'ime azụmahịa {n}", yo: "À ń fi 50 àkọ́kọ́ hàn nínú ìdúnàádúrà {n}" },
  "finance.rptUncostedSales": { en: "{amount} of sales have no cost price, so their profit isn't counted", pidgin: "{amount} of sales no get cost price, so we no count their profit", ha: "Siyarwa ta {amount} ba ta da farashin saye, don haka ba a ƙidaya ribarta ba", ig: "Ahịa {amount} enweghị ọnụahịa ịzụ, ya mere a gụghị uru ha", yo: "Títà {amount} kò ní iye owó rírà, nítorí náà a kò ka èrè wọn" },
  "finance.rptPartialNote":   { en: " (* = part of the sale has no cost price)", pidgin: " (* = part of the sale no get cost price)", ha: " (* = wani sashi na siyarwar ba shi da farashin saye)", ig: " (* = akụkụ ahịa ahụ enweghị ọnụahịa ịzụ)", yo: " (* = apá kan títà náà kò ní iye owó rírà)" },
  "finance.rptAddCostPrices": { en: ". Add cost prices in Stock to include them.", pidgin: ". Add cost price for Stock make e enter.", ha: ". Ƙara farashin saye a Kaya don a haɗa su.", ig: ". Tinye ọnụahịa ịzụ na Ngwaahịa ka etinye ha.", yo: ". Fi iye owó rírà kún un nínú Ọjà láti kà wọ́n mọ́ ọn." },
  "finance.rptNoOverdue":     { en: "No overdue accounts", pidgin: "No account wey time don pass", ha: "Babu asusun da ya wuce lokaci", ig: "Enweghị akaụntụ gafere oge", yo: "Kò sí àkáǹtì tó ti kọjá àkókò" },
  "finance.rptOverdueAccountsOne":  { en: "{n} overdue account", pidgin: "{n} account wey time don pass", ha: "Asusu {n} da ya wuce lokaci", ig: "Akaụntụ {n} gafere oge", yo: "Àkáǹtì {n} tó ti kọjá àkókò" },
  "finance.rptOverdueAccountsMany": { en: "{n} overdue accounts", pidgin: "{n} accounts wey time don pass", ha: "Asusu {n} da suka wuce lokaci", ig: "Akaụntụ {n} gafere oge", yo: "Àkáǹtì {n} tó ti kọjá àkókò" },
  "finance.rptOverdueOutstanding":  { en: "{amount} outstanding on overdue accounts", pidgin: "{amount} still remain for accounts wey time don pass", ha: "{amount} ya rage a asusun da suka wuce lokaci", ig: "{amount} fọdụrụ n'akaụntụ gafere oge", yo: "{amount} ló kù lórí àkáǹtì tó ti kọjá àkókò" },
  "finance.rptCreditProfitNote": { en: "Profit = profit on the goods sold on credit (each item's cost price saved when the credit was given) + interest {amount} — earned as customers repay.", pidgin: "Profit = profit on goods wey sell on credit (each item cost price wey we save when credit start) + interest {amount} — e dey come as customers dey pay back.", ha: "Riba = ribar kayan da aka sayar a bashi (farashin saye na kowane kaya da aka ajiye lokacin bayar da bashin) + riba {amount} — ana samu yayin da abokan ciniki ke biya.", ig: "Uru = uru na ngwa erere na mgbazinye (ọnụahịa ịzụ nke ngwa ọ bụla echekwara mgbe e nyere mgbazinye) + ọmụrụnwa {amount} — a na-enweta ya ka ndị ahịa na-akwụghachi.", yo: "Èrè = èrè lórí ọjà tí a tà ní àwìn (iye owó rírà ọjà kọ̀ọ̀kan tí a fi pamọ́ nígbà tí a fún ní àwìn) + èlé {amount} — a máa ń rí i bí oníbàárà ṣe ń san padà." },
  "finance.rptCreditUncosted":   { en: " {amount} of credit has no item cost (no items recorded, or credit added later), so its goods profit isn't counted (*).", pidgin: " {amount} of credit no get item cost (no items record, or credit add later), so we no count the goods profit (*).", ha: " Bashi na {amount} ba shi da farashin kaya (ba a rubuta kaya ba, ko an ƙara bashin daga baya), don haka ba a ƙidaya ribar kayan ba (*).", ig: " Mgbazinye {amount} enweghị ọnụahịa ngwa (e deghị ngwa, ma ọ bụ etinyere mgbazinye emechaa), ya mere a gụghị uru ngwa ya (*).", yo: " Àwìn {amount} kò ní iye owó ọjà (a kò kọ ọjà sílẹ̀, tàbí a fi àwìn kún un lẹ́yìn), nítorí náà a kò ka èrè ọjà rẹ̀ (*)." },
  "finance.rptAsoNote":       { en: "Savings Held = client funds held in trust — separate from business profit. Profit = fees + commission earned from each client.", pidgin: "Savings Held = clients money wey you dey keep for them — e no be business profit. Profit = fees + commission wey you get from each client.", ha: "Ajiyar da ake riƙe = kuɗin abokan ciniki da ake riƙewa amana — ba ribar kasuwanci ba. Riba = kuɗaɗe + kwamishan da aka samu daga kowane abokin ciniki.", ig: "Nchekwa ejidere = ego ndị ahịa ejidere n'ntụkwasị obi — ọ dịghị n'uru azụmahịa. Uru = ụgwọ + kọmịshọn enwetara n'aka onye ahịa ọ bụla.", yo: "Owó ìpamọ́ tó wà lọ́wọ́ = owó oníbàárà tí a ń bá wọn tọ́jú — kì í ṣe èrè iṣẹ́ òwò. Èrè = owó àsanpadà + kọmíṣọ̀n tí a rí lọ́wọ́ oníbàárà kọ̀ọ̀kan." },
  "finance.rptRegFees":       { en: "Registration Fees", pidgin: "Registration Fees", ha: "Kuɗin Rajista", ig: "Ụgwọ Ndebanye Aha", yo: "Owó Ìforúkọsílẹ̀" },
  "finance.rptWdFees":        { en: "Withdrawal Fees", pidgin: "Withdrawal Fees", ha: "Kuɗin Cire Kuɗi", ig: "Ụgwọ Mwepụ Ego", yo: "Owó Ìgbàjáde" },
  "finance.rptCommission":    { en: "Commission", pidgin: "Commission", ha: "Kwamishan", ig: "Kọmịshọn", yo: "Kọmíṣọ̀n" },
  "finance.rptTotalAjoProfit": { en: "Total Ajo Profit", pidgin: "Total Ajo Profit", ha: "Jimillar Ribar Ajo", ig: "Ngụkọta Uru Ajo", yo: "Àpapọ̀ Èrè Àjọ" },
  "finance.rptRefundedAmount": { en: "{amount} (refunded)", pidgin: "{amount} (dem don refund)", ha: "{amount} (an mayar)", ig: "{amount} (eweghachiri)", yo: "{amount} (a ti dá padà)" },
  "finance.rptBillsNote":     { en: "Bill profit = the discount on printed airtime PINs and bundles (resold at face value) + 1% cashback on airtime and data. Other bills are costs with no profit.", pidgin: "Bill profit = the discount on printed airtime PINs and bundles (wey you resell for face value) + 1% cashback on airtime and data. Other bills na cost wey no get profit.", ha: "Ribar biyan buƙatu = rangwamen PIN na katin waya da bandul da aka buga (ana sake sayarwa a farashin asali) + 1% kuɗin dawowa akan katin waya da data. Sauran biyan buƙatu kashewa ne ba riba ba.", ig: "Uru ụgwọ ọrụ = mbelata na PIN airtime na ngwugwu e biri ebi (e rere ọzọ n'ọnụahịa ya) + 1% ego nlọghachi na airtime na data. Ụgwọ ọrụ ndị ọzọ bụ mmefu na-enweghị uru.", yo: "Èrè owó iṣẹ́ = ẹ̀dínwó lórí PIN káàdì ìpè àti àpapọ̀ tí a tẹ̀ (tí a tún tà ní iye rẹ̀) + 1% owó ìdápadà lórí káàdì ìpè àti dátà. Àwọn owó iṣẹ́ míràn jẹ́ ìnáwó láìsí èrè." },
  "finance.rptFailedBillsOne":  { en: " {n} failed bill ({amount}, refunded) not counted.", pidgin: " {n} bill wey fail ({amount}, dem don refund) no dey counted.", ha: " Biyan buƙatu {n} da ya kasa ({amount}, an mayar) ba a ƙidaya ba.", ig: " Ụgwọ ọrụ {n} dara ({amount}, eweghachiri) agụghị ya.", yo: " Owó iṣẹ́ {n} tó kùnà ({amount}, a ti dá padà) a kò kà á." },
  "finance.rptFailedBillsMany": { en: " {n} failed bills ({amount}, refunded) not counted.", pidgin: " {n} bills wey fail ({amount}, dem don refund) no dey counted.", ha: " Biyan buƙatu {n} da suka kasa ({amount}, an mayar) ba a ƙidaya ba.", ig: " Ụgwọ ọrụ {n} dara ({amount}, eweghachiri) agụghị ha.", yo: " Owó iṣẹ́ {n} tó kùnà ({amount}, a ti dá padà) a kò kà wọ́n." },
  "finance.rptNoStaffData":   { en: "No staff transaction data found. Staff ID tracking must be enabled and active.", pidgin: "We no see any staff transaction. Staff ID tracking must dey on.", ha: "Ba a sami bayanan ma'amalar ma'aikata ba. Dole ne a kunna bin diddigin ID na ma'aikata.", ig: "Achọtaghị data azụmahịa ndị ọrụ. A ga-agbanyerịrị nsochi ID ndị ọrụ.", yo: "A kò rí àkọsílẹ̀ ìdúnàádúrà òṣìṣẹ́. Ìtọpinpin ID òṣìṣẹ́ gbọ́dọ̀ wà ní títàn." },
  "finance.rptStockNote":     { en: "Profit = revenue − the cost price saved when each item was sold. Restock = what was spent buying the item in this period.", pidgin: "Profit = revenue − the cost price wey we save when each item sell. Restock = wetin you spend buy the item for this time.", ha: "Riba = kuɗin shiga − farashin saye da aka ajiye lokacin da aka sayar da kowane kaya. Sake saya = abin da aka kashe wajen sayen kayan a wannan lokaci.", ig: "Uru = ego mbata − ọnụahịa ịzụ echekwara mgbe e rere ngwa ọ bụla. Zụtaghachi = ihe e mefuru ịzụ ngwa ahụ n'oge a.", yo: "Èrè = owó wíwọlé − iye owó rírà tí a fi pamọ́ nígbà tí a ta ọjà kọ̀ọ̀kan. Ìrà-padà = ohun tí a ná láti ra ọjà náà ní àkókò yìí." },
  "finance.rptStockUncosted": { en: " {amount} of item sales have no cost price, so their profit isn't counted (*).", pidgin: " {amount} of item sales no get cost price, so we no count their profit (*).", ha: " Siyarwar kaya ta {amount} ba ta da farashin saye, don haka ba a ƙidaya ribarta ba (*).", ig: " Ahịa ngwa {amount} enweghị ọnụahịa ịzụ, ya mere a gụghị uru ha (*).", yo: " Títà ọjà {amount} kò ní iye owó rírà, nítorí náà a kò ka èrè wọn (*)." },
  "finance.rptLadderGoods":      { en: "Profit on goods sold", pidgin: "Profit on goods wey sell", ha: "Riba akan kayan da aka sayar", ig: "Uru na ngwa erere", yo: "Èrè lórí ọjà tí a tà" },
  "finance.rptLadderGoodsSub":   { en: "Sales, credit sales and invoices — cost price saved at each sale", pidgin: "Sales, credit sales and invoices — cost price wey we save for each sale", ha: "Siyarwa, siyarwar bashi da takardun kuɗi — farashin saye da aka ajiye a kowace siyarwa", ig: "Ahịa, ahịa mgbazinye na akwụkwọ ụgwọ — ọnụahịa ịzụ echekwara n'ahịa ọ bụla", yo: "Títà, títà àwìn àti ìwé ìdíyelé — iye owó rírà tí a fi pamọ́ ní títà kọ̀ọ̀kan" },
  "finance.rptLadderAjo":        { en: "Ajo fees & commission", pidgin: "Ajo fees & commission", ha: "Kuɗaɗen Ajo da kwamishan", ig: "Ụgwọ Ajo na kọmịshọn", yo: "Owó àsanpadà Àjọ àti kọmíṣọ̀n" },
  "finance.rptLadderAjoSub":     { en: "Registration fees, withdrawal fees and commission", pidgin: "Registration fees, withdrawal fees and commission", ha: "Kuɗin rajista, kuɗin cire kuɗi da kwamishan", ig: "Ụgwọ ndebanye aha, ụgwọ mwepụ ego na kọmịshọn", yo: "Owó ìforúkọsílẹ̀, owó ìgbàjáde àti kọmíṣọ̀n" },
  "finance.rptLadderInterest":   { en: "Interest collected on credit", pidgin: "Interest wey you collect on credit", ha: "Ribar da aka karɓa akan bashi", ig: "Ọmụrụnwa a nakọtara na mgbazinye", yo: "Èlé tí a gbà lórí àwìn" },
  "finance.rptLadderInterestSub": { en: "Counted when customers pay it", pidgin: "We dey count am when customers pay", ha: "Ana ƙidaya shi lokacin da abokan ciniki suka biya", ig: "A na-agụ ya mgbe ndị ahịa kwụrụ ya", yo: "A máa ń kà á nígbà tí oníbàárà bá san án" },
  "finance.rptLadderBills":      { en: "Bills: PIN discount + cashback", pidgin: "Bills: PIN discount + cashback", ha: "Biyan buƙatu: rangwamen PIN + kuɗin dawowa", ig: "Ụgwọ ọrụ: mbelata PIN + ego nlọghachi", yo: "Owó iṣẹ́: ẹ̀dínwó PIN + owó ìdápadà" },
  "finance.rptLadderBillsSub":   { en: "Printed PINs resold at face value, 1% on airtime and data", pidgin: "Printed PINs wey you resell for face value, 1% on airtime and data", ha: "PIN da aka buga ana sake sayarwa a farashin asali, 1% akan katin waya da data", ig: "PIN e biri ebi e rere ọzọ n'ọnụahịa ya, 1% na airtime na data", yo: "PIN tí a tẹ̀ tí a tún tà ní iye rẹ̀, 1% lórí káàdì ìpè àti dátà" },
  "finance.rptGrossProfit":      { en: "Gross profit", pidgin: "Gross profit", ha: "Babban riba", ig: "Uru niile", yo: "Èrè gbogbo" },
  "finance.rptLessExpenses":     { en: "Less: expenses", pidgin: "Minus: expenses", ha: "A cire: kashe-kashe", ig: "Wepụ: mmefu", yo: "Yọ kúrò: ìnáwó" },
  "finance.rptNetProfit":        { en: "Net profit", pidgin: "Net profit", ha: "Ribar ƙarshe", ig: "Uru ikpeazụ", yo: "Èrè àṣẹ́kù" },
  "finance.rptSameAsFinance":    { en: "Same profit as your Finance screen for these dates ({amount})", pidgin: "Na the same profit wey dey your Finance screen for these dates ({amount})", ha: "Riba ɗaya da ta allon Kuɗi na waɗannan kwanaki ({amount})", ig: "Otu uru dị na ihuenyo Ego gị maka ụbọchị ndị a ({amount})", yo: "Èrè kan náà pẹ̀lú ojú-ìwé Ìṣúná rẹ fún àwọn ọjọ́ wọ̀nyí ({amount})" },
  "finance.rptPlusBills":        { en: ", plus {amount} earned on bills", pidgin: ", plus {amount} wey you make on bills", ha: ", da ƙarin {amount} da aka samu akan biyan buƙatu", ig: ", tinyere {amount} enwetara na ụgwọ ọrụ", yo: ", pẹ̀lú {amount} tí a jèrè lórí owó iṣẹ́" },
  "finance.rptUnmeasured":       { en: " {amount} of sales have no cost price, so their profit isn't counted — add cost prices in Stock.", pidgin: " {amount} of sales no get cost price, so we no count their profit — add cost price for Stock.", ha: " Siyarwa ta {amount} ba ta da farashin saye, don haka ba a ƙidaya ribarta ba — ƙara farashin saye a Kaya.", ig: " Ahịa {amount} enweghị ọnụahịa ịzụ, ya mere a gụghị uru ha — tinye ọnụahịa ịzụ na Ngwaahịa.", yo: " Títà {amount} kò ní iye owó rírà, nítorí náà a kò ka èrè wọn — fi iye owó rírà kún un nínú Ọjà." },
  "finance.rptMostProfitable":   { en: "Most profitable items", pidgin: "Items wey get profit pass", ha: "Kayan da suka fi riba", ig: "Ngwa kacha enye uru", yo: "Ọjà tó lérè jù" },
  "finance.rptAccountsOne":      { en: "{n} account", pidgin: "{n} account", ha: "Asusu {n}", ig: "Akaụntụ {n}", yo: "Àkáǹtì {n}" },
  "finance.rptAccountsMany":     { en: "{n} accounts", pidgin: "{n} accounts", ha: "Asusu {n}", ig: "Akaụntụ {n}", yo: "Àkáǹtì {n}" },
  "finance.rptActiveThisPeriod": { en: "{n} active this period", pidgin: "{n} active this time", ha: "{n} masu aiki a wannan lokaci", ig: "{n} na-arụ n'oge a", yo: "{n} ló ń ṣiṣẹ́ ní àkókò yìí" },
  "finance.rptMyBusiness":       { en: "My Business", pidgin: "My Business", ha: "Kasuwancina", ig: "Azụmahịa M", yo: "Iṣẹ́ Òwò Mi" },
  "finance.rptTitleGeneral":     { en: "General Business Report", pidgin: "General Business Report", ha: "Cikakken Rahoton Kasuwanci", ig: "Akụkọ Azụmahịa Izugbe", yo: "Ìròyìn Gbogbogbò Iṣẹ́ Òwò" },
  "finance.rptTitleSales":       { en: "Sales & Revenue Report", pidgin: "Sales & Revenue Report", ha: "Rahoton Siyarwa da Kuɗin Shiga", ig: "Akụkọ Ahịa na Ego Mbata", yo: "Ìròyìn Títà àti Owó Wíwọlé" },
  "finance.rptTitleCredit":      { en: "Credit Management Report", pidgin: "Credit Management Report", ha: "Rahoton Gudanar da Bashi", ig: "Akụkọ Nlekọta Mgbazinye", yo: "Ìròyìn Ìṣàkóso Àwìn" },
  "finance.rptTitleAso":         { en: "Ajo / Aso Savings Report", pidgin: "Ajo / Aso Savings Report", ha: "Rahoton Ajiyar Ajo / Aso", ig: "Akụkọ Nchekwa Ajo / Aso", yo: "Ìròyìn Ìfowópamọ́ Àjọ / Aso" },
  "finance.rptTitleBills":       { en: "Bill Payments Report", pidgin: "Bill Payments Report", ha: "Rahoton Biyan Buƙatu", ig: "Akụkọ Ịkwụ Ụgwọ Ọrụ", yo: "Ìròyìn Ìsanwó Owó Iṣẹ́" },
  "finance.rptTitleStaff":       { en: "Staff Performance Report", pidgin: "Staff Performance Report", ha: "Rahoton Aikin Ma'aikata", ig: "Akụkọ Arụmọrụ Ndị Ọrụ", yo: "Ìròyìn Iṣẹ́ Òṣìṣẹ́" },
  "finance.rptTitleStock":       { en: "Stock & Inventory Report", pidgin: "Stock & Inventory Report", ha: "Rahoton Kaya da Ajiya", ig: "Akụkọ Ngwaahịa na Ndekọ", yo: "Ìròyìn Ọjà àti Àkójọ Ọjà" },
  "finance.rptGenerated":        { en: "Generated", pidgin: "Generated", ha: "An samar", ig: "E mepụtara", yo: "A ṣe é" },
  "finance.rptPeriodLabel":      { en: "Period:", pidgin: "Period:", ha: "Lokaci:", ig: "Oge:", yo: "Àkókò:" },
  "finance.rptGeneratedBy":      { en: "Generated by KudiAI Track · {biz}", pidgin: "KudiAI Track make am · {biz}", ha: "KudiAI Track ne ya samar · {biz}", ig: "KudiAI Track mepụtara ya · {biz}", yo: "KudiAI Track ló ṣe é · {biz}" },
  "finance.rptConfidential":     { en: "CONFIDENTIAL", pidgin: "CONFIDENTIAL", ha: "SIRRI", ig: "NZUZO", yo: "ÀṢÍRÍ" },
  "finance.rptSubGeneral":       { en: "Everything in one: profit, money in & out, sales, credit, Ajo, bills & stock", pidgin: "Everything for one place: profit, money enter & comot, sales, credit, Ajo, bills & stock", ha: "Komai a wuri ɗaya: riba, kuɗin shiga da fita, siyarwa, bashi, Ajo, biyan buƙatu da kaya", ig: "Ihe niile n'otu: uru, ego batara na pụrụ, ahịa, mgbazinye, Ajo, ụgwọ ọrụ na ngwaahịa", yo: "Gbogbo rẹ̀ ní ibì kan: èrè, owó wọlé àti jáde, títà, àwìn, Àjọ, owó iṣẹ́ àti ọjà" },
  "finance.rptSubSales":         { en: "Revenue, expenses, profit & transactions", pidgin: "Revenue, expenses, profit & transactions", ha: "Kuɗin shiga, kashe-kashe, riba da ma'amaloli", ig: "Ego mbata, mmefu, uru na azụmahịa", yo: "Owó wíwọlé, ìnáwó, èrè àti ìdúnàádúrà" },
  "finance.rptSubCredit":        { en: "Debtors, outstanding & overdue accounts", pidgin: "Debtors, wetin remain & accounts wey time don pass", ha: "Masu bashi, saura da asusun da suka wuce lokaci", ig: "Ndị ji ụgwọ, ego fọdụrụ na akaụntụ gafere oge", yo: "Àwọn onígbèsè, owó tó kù àti àkáǹtì tó ti kọjá àkókò" },
  "finance.rptSubAso":           { en: "Savings clients, contributions & balance", pidgin: "Savings clients, contributions & balance", ha: "Abokan ciniki na ajiya, gudummawa da ragowa", ig: "Ndị ahịa nchekwa, ntinye ego na ego fọdụrụ", yo: "Oníbàárà ìfowópamọ́, owó àdáṣe àti ìyókù" },
  "finance.rptSubBills":         { en: "Bill payments by category & provider", pidgin: "Bill payments by category & provider", ha: "Biyan buƙatu ta rukuni da mai bayarwa", ig: "Ịkwụ ụgwọ ọrụ site n'ụdị na onye na-enye", yo: "Ìsanwó owó iṣẹ́ ní ẹ̀ka àti olùpèsè" },
  "finance.rptSubStaff":         { en: "Per-staff transactions & contributions", pidgin: "Each staff transactions & contributions", ha: "Ma'amaloli da gudummawar kowane ma'aikaci", ig: "Azụmahịa na ntinye ego onye ọrụ ọ bụla", yo: "Ìdúnàádúrà àti owó àdáṣe òṣìṣẹ́ kọ̀ọ̀kan" },
  "finance.rptSubStock":         { en: "Items sold, revenue & inventory overview", pidgin: "Items wey sell, revenue & stock overview", ha: "Kayan da aka sayar, kuɗin shiga da bayanin kaya", ig: "Ngwa erere, ego mbata na nchịkọta ngwaahịa", yo: "Ọjà tí a tà, owó wíwọlé àti àkópọ̀ ọjà" },
  "finance.rptExportFailed":     { en: "Export failed — please try again.", pidgin: "Export no work — abeg try again.", ha: "Fitarwa ta kasa — da fatan a sake gwadawa.", ig: "Mbupụ dara — biko nwaa ọzọ.", yo: "Gbígbé jáde kùnà — jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan sí i." },
  "finance.rptCsvFailed":        { en: "CSV export failed — please try again.", pidgin: "CSV export no work — abeg try again.", ha: "Fitar CSV ta kasa — da fatan a sake gwadawa.", ig: "Mbupụ CSV dara — biko nwaa ọzọ.", yo: "Gbígbé CSV jáde kùnà — jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan sí i." },
  "finance.rptWalletSub":        { en: "Every wallet transaction with the balance after it", pidgin: "Every wallet transaction plus the balance after am", ha: "Kowace ma'amalar walat tare da ragowar bayanta", ig: "Azụmahịa wallet ọ bụla na ego fọdụrụ mgbe ya gasịrị", yo: "Gbogbo ìdúnàádúrà àpò-owó pẹ̀lú ìyókù lẹ́yìn rẹ̀" },
  "finance.rptMonthlySub":       { en: "Business Report + Wallet Statement for every month", pidgin: "Business Report + Wallet Statement for every month", ha: "Rahoton Kasuwanci + Bayanin Walat na kowane wata", ig: "Akụkọ Azụmahịa + Nkọwa Wallet maka ọnwa ọ bụla", yo: "Ìròyìn Iṣẹ́ Òwò + Àkọọ́lẹ̀ Àpò-owó fún oṣù kọ̀ọ̀kan" },
  "finance.rptLoadingAjoData":   { en: "Loading Ajo data…", pidgin: "E dey load Ajo data…", ha: "Ana loda bayanan Ajo…", ig: "Ọ na-ebu data Ajo…", yo: "Ó ń gbé àkọsílẹ̀ Àjọ…" },
  "finance.rptStatementsMonthly": { en: "Statements & monthly reports", pidgin: "Statements & monthly reports", ha: "Bayanan asusu da rahotannin wata-wata", ig: "Nkọwa akaụntụ na akụkọ kwa ọnwa", yo: "Àkọọ́lẹ̀ àti ìròyìn oṣooṣù" },
  "finance.rptMonthlyCard":      { en: "Business Report for every month · emailed on the 1st", pidgin: "Business Report for every month · we go email am for 1st", ha: "Rahoton Kasuwanci na kowane wata · ana aikawa ta imel a ranar 1", ig: "Akụkọ Azụmahịa maka ọnwa ọ bụla · a na-ezipu ya n'email n'ụbọchị 1", yo: "Ìròyìn Iṣẹ́ Òwò fún oṣù kọ̀ọ̀kan · a máa ń fi ránṣẹ́ ní ímeèlì ní ọjọ́ kìíní" },
  "finance.rptMonthlyCardWallet": { en: "Business Report + Wallet Statement for every month · emailed on the 1st", pidgin: "Business Report + Wallet Statement for every month · we go email am for 1st", ha: "Rahoton Kasuwanci + Bayanin Walat na kowane wata · ana aikawa ta imel a ranar 1", ig: "Akụkọ Azụmahịa + Nkọwa Wallet maka ọnwa ọ bụla · a na-ezipu ya n'email n'ụbọchị 1", yo: "Ìròyìn Iṣẹ́ Òwò + Àkọọ́lẹ̀ Àpò-owó fún oṣù kọ̀ọ̀kan · a máa ń fi ránṣẹ́ ní ímeèlì ní ọjọ́ kìíní" },
  "finance.rptWalletCardSub":    { en: "Every wallet transaction with the balance after it · PDF & CSV", pidgin: "Every wallet transaction plus the balance after am · PDF & CSV", ha: "Kowace ma'amalar walat tare da ragowar bayanta · PDF da CSV", ig: "Azụmahịa wallet ọ bụla na ego fọdụrụ mgbe ya gasịrị · PDF na CSV", yo: "Gbogbo ìdúnàádúrà àpò-owó pẹ̀lú ìyókù lẹ́yìn rẹ̀ · PDF àti CSV" },
  "finance.rptNoDataYet":        { en: "No data yet", pidgin: "No data yet", ha: "Babu bayani tukuna", ig: "Enweghị data ugbu a", yo: "Kò sí àkọsílẹ̀ síbẹ̀" },
  "finance.rptNoDataHint":       { en: "Add some transactions to generate your first report. The report will show zeroes until then.", pidgin: "Add some transactions to make your first report. The report go show zero until then.", ha: "Ƙara wasu ma'amaloli don samar da rahotonka na farko. Rahoton zai nuna sifili har zuwa lokacin.", ig: "Tinye azụmahịa ụfọdụ iji mepụta akụkọ mbụ gị. Akụkọ ahụ ga-egosi efu ruo mgbe ahụ.", yo: "Fi àwọn ìdúnàádúrà kún un láti ṣe ìròyìn àkọ́kọ́ rẹ. Ìròyìn náà yóò fi òdo hàn títí di ìgbà náà." },
  "finance.rptLoadingAjoContribs": { en: "Loading Ajo contributions…", pidgin: "E dey load Ajo contributions…", ha: "Ana loda gudummawar Ajo…", ig: "Ọ na-ebu ntinye ego Ajo…", yo: "Ó ń gbé owó àdáṣe Àjọ…" },

  /* Finance dashboard */
  "finance.periodToday":  { en: "Today", pidgin: "Today", ha: "Yau", ig: "Taa", yo: "Òní" },
  "finance.periodWeek":   { en: "Week", pidgin: "Week", ha: "Mako", ig: "Izu", yo: "Ọ̀sẹ̀" },
  "finance.periodMonth":  { en: "Month", pidgin: "Month", ha: "Wata", ig: "Ọnwa", yo: "Oṣù" },
  "finance.periodYear":   { en: "Year", pidgin: "Year", ha: "Shekara", ig: "Afọ", yo: "Ọdún" },
  "finance.tileCredit":   { en: "Credit", pidgin: "Credit", ha: "Bashi", ig: "Mgbazinye", yo: "Àwìn" },
  "finance.tileAjo":      { en: "Ajo Savings", pidgin: "Ajo Savings", ha: "Ajiyar Ajo", ig: "Nchekwa Ajo", yo: "Ìfowópamọ́ Àjọ" },
  "finance.tileLoan":     { en: "Business Loan", pidgin: "Business Loan", ha: "Lamunin Kasuwanci", ig: "Mbinye Ego Azụmahịa", yo: "Ẹ̀yáwó Iṣẹ́ Òwò" },
  "finance.tileOrg":      { en: "Organisation", pidgin: "Organisation", ha: "Ƙungiya", ig: "Nzukọ", yo: "Àjọ" },
  "finance.tileInvoices": { en: "Invoices", pidgin: "Invoices", ha: "Takardun Kuɗi", ig: "Akwụkwọ Ụgwọ", yo: "Ìwé Ìdíyelé" },
  "finance.netPL":        { en: "Net P&L", pidgin: "Net P&L", ha: "Riba ko Asara", ig: "Uru ma ọ bụ Mfu", yo: "Èrè tàbí Àdánù" },
  "finance.netCash":      { en: "Net Cash", pidgin: "Net Cash", ha: "Sauran Kuɗi", ig: "Ego Fọdụrụ", yo: "Owó Àṣẹ́kù" },
  "finance.vsPrior":      { en: "{pct}% vs prior period", pidgin: "{pct}% vs last period", ha: "{pct}% idan aka kwatanta da lokacin baya", ig: "{pct}% ma e jiri tụnyere oge gara aga", yo: "{pct}% sí àkókò tó kọjá" },
  "finance.wcTitle":      { en: "Working Capital", pidgin: "Working Capital", ha: "Jarin Aiki", ig: "Isi Ego Ọrụ", yo: "Owó Ìdókòwò" },
  "finance.wcHealthy":    { en: "Healthy", pidgin: "Good", ha: "Lafiya", ig: "Ọ dị mma", yo: "Ó dára" },
  "finance.wcCaution":    { en: "Caution", pidgin: "Take care", ha: "Hattara", ig: "Kpachara anya", yo: "Ṣọ́ra" },
  "finance.wcShortfall":  { en: "Shortfall", pidgin: "E no reach", ha: "Gibi", ig: "Ụkọ", yo: "Àìtó" },
  "finance.wcDeclared":   { en: "Declared capital", pidgin: "Capital wey you declare", ha: "Jarin da aka bayyana", ig: "Isi ego ekwuputara", yo: "Owó ìdókòwò tí o kéde" },
  "finance.wcNetPL":      { en: "Net profit / loss", pidgin: "Net profit / loss", ha: "Riba / asara", ig: "Uru / mfu", yo: "Èrè / àdánù" },
  "finance.wcStockPurchased": { en: "Stock purchased", pidgin: "Stock wey you buy", ha: "Kayan da aka saya", ig: "Ngwaahịa azụrụ", yo: "Ọjà tí a rà" },
  "finance.wcStockSold":  { en: "Stock sold (COGS back)", pidgin: "Stock wey sell (cost don come back)", ha: "Kayan da aka sayar (farashi ya dawo)", ig: "Ngwaahịa erere (ọnụahịa laghachiri)", yo: "Ọjà tí a tà (iye owó rírà padà)" },
  "finance.wcCashPosition": { en: "Cash position", pidgin: "Cash position", ha: "Matsayin kuɗi", ig: "Ọnọdụ ego", yo: "Ipò owó" },
  "finance.wcLocked":     { en: "{amount} locked in unsold inventory", pidgin: "{amount} dey hold for stock wey never sell", ha: "{amount} na kulle a kayan da ba a sayar ba", ig: "{amount} kpọchiri na ngwaahịa a na-erebeghị", yo: "{amount} wà nínú ọjà tí a kò tíì tà" },
  "finance.noTxPeriod":   { en: "No transactions for this period", pidgin: "No transaction for this time", ha: "Babu ma'amala a wannan lokaci", ig: "Enweghị azụmahịa n'oge a", yo: "Kò sí ìdúnàádúrà ní àkókò yìí" },
  "finance.tapPlus":      { en: "Tap + to record income or expenses", pidgin: "Tap + to record income or expenses", ha: "Danna + don rubuta kuɗin shiga ko kashewa", ig: "Pịa + iji dekọọ ego mbata ma ọ bụ mmefu", yo: "Tẹ + láti kọ owó wíwọlé tàbí ìnáwó sílẹ̀" },
  "finance.catExpense":   { en: "Expense", pidgin: "Expense", ha: "Kashewa", ig: "Mmefu", yo: "Ìnáwó" },
  "finance.catStock":     { en: "Stock Purchase", pidgin: "Stock Purchase", ha: "Sayen Kaya", ig: "Ịzụ Ngwaahịa", yo: "Ìrà Ọjà" },
  "finance.catOther":     { en: "Other", pidgin: "Other", ha: "Wani", ig: "Ọzọ", yo: "Òmíràn" },
  "finance.financeTools": { en: "Finance Tools", pidgin: "Finance Tools", ha: "Kayan Aikin Kuɗi", ig: "Ngwa Ego", yo: "Irinṣẹ́ Ìṣúná" },
  "finance.nOverdue":     { en: "{n} overdue", pidgin: "{n} don pass time", ha: "{n} sun wuce lokaci", ig: "{n} gafere oge", yo: "{n} ti kọjá àkókò" },
  "finance.nRecord":      { en: "{n} record", pidgin: "{n} record", ha: "Bayani {n}", ig: "Ndekọ {n}", yo: "Àkọsílẹ̀ {n}" },
  "finance.nRecords":     { en: "{n} records", pidgin: "{n} records", ha: "Bayanai {n}", ig: "Ndekọ {n}", yo: "Àkọsílẹ̀ {n}" },
  "finance.upgradeToAccess": { en: "Upgrade to access", pidgin: "Upgrade to use am", ha: "Haɓaka don samun dama", ig: "Kwalite iji nweta ya", yo: "Gbéga láti lò ó" },
  "finance.notInPlan":    { en: "Not in your plan", pidgin: "E no dey your plan", ha: "Ba ya cikin tsarinka", ig: "Ọ nọghị n'atụmatụ gị", yo: "Kò sí nínú ètò rẹ" },
  "finance.nActiveClient":  { en: "{n} active client", pidgin: "{n} active client", ha: "Abokin ciniki {n} mai aiki", ig: "Onye ahịa {n} na-arụ", yo: "Oníbàárà {n} tó ń ṣiṣẹ́" },
  "finance.nActiveClients": { en: "{n} active clients", pidgin: "{n} active clients", ha: "Abokan ciniki {n} masu aiki", ig: "Ndị ahịa {n} na-arụ", yo: "Oníbàárà {n} tó ń ṣiṣẹ́" },
  "finance.pendingCredits": { en: "Pending Credits", pidgin: "Credits wey remain", ha: "Basussukan da ke Jira", ig: "Mgbazinye Na-echere", yo: "Àwìn Tó Ń Dúró" },
  "finance.seeAll":       { en: "See all", pidgin: "See all", ha: "Duba duka", ig: "Hụ ha niile", yo: "Wo gbogbo rẹ̀" },
  "finance.cstatusActive":  { en: "active", pidgin: "active", ha: "mai aiki", ig: "na-arụ", yo: "ń lọ" },
  "finance.cstatusOverdue": { en: "overdue", pidgin: "time don pass", ha: "ya wuce lokaci", ig: "gafere oge", yo: "ti kọjá àkókò" },
  "finance.cstatusPaid":    { en: "paid", pidgin: "paid", ha: "an biya", ig: "kwụrụ", yo: "ti san" },
  "finance.cstatusPartial": { en: "partially_paid", pidgin: "pay small", ha: "an biya wani sashi", ig: "kwụrụ obere", yo: "ti san díẹ̀" },
  "finance.dueOn":        { en: "Due", pidgin: "Due", ha: "Ranar biya", ig: "Ụbọchị ịkwụ", yo: "Ọjọ́ ìsanwó" },
  "finance.activeAjo":    { en: "Active Ajo", pidgin: "Active Ajo", ha: "Ajo Mai Aiki", ig: "Ajo Na-arụ", yo: "Àjọ Tó Ń Lọ" },
  "finance.nextOn":       { en: "Next:", pidgin: "Next:", ha: "Na gaba:", ig: "Nke ọzọ:", yo: "Tó kàn:" },
  "finance.lensProfit":   { en: "Profit & Loss", pidgin: "Profit & Loss", ha: "Riba da Asara", ig: "Uru na Mfu", yo: "Èrè àti Àdánù" },
  "finance.lensCash":     { en: "Cash Flow", pidgin: "Cash Flow", ha: "Gudanar Kuɗi", ig: "Mmegharị Ego", yo: "Ìṣàn Owó" },
  "finance.plRevenue":    { en: "Revenue", pidgin: "Revenue", ha: "Kuɗin shiga", ig: "Ego mbata", yo: "Owó wíwọlé" },
  "finance.plInterest":   { en: "Interest earned", pidgin: "Interest wey you get", ha: "Ribar da aka samu", ig: "Ọmụrụnwa enwetara", yo: "Èlé tí a rí" },
  "finance.plCogs":       { en: "Cost of Goods", pidgin: "Cost of Goods", ha: "Farashin Kaya", ig: "Ọnụahịa Ngwaahịa", yo: "Iye Owó Ọjà" },
  "finance.plGross":      { en: "Gross Profit", pidgin: "Gross Profit", ha: "Babban Riba", ig: "Uru Niile", yo: "Èrè Gbogbo" },
  "finance.plExpenses":   { en: "Expenses", pidgin: "Expenses", ha: "Kashe-kashe", ig: "Mmefu", yo: "Ìnáwó" },
  "finance.plNet":        { en: "Net Profit", pidgin: "Net Profit", ha: "Ribar Ƙarshe", ig: "Uru Ikpeazụ", yo: "Èrè Àṣẹ́kù" },
  "finance.unmeasuredOne":  { en: "{n} sale — margin unknown", pidgin: "{n} sale — we no know the profit", ha: "Siyarwa {n} — ba a san riba ba", ig: "Ahịa {n} — amaghị uru ya", yo: "Títà {n} — a kò mọ èrè rẹ̀" },
  "finance.unmeasuredMany": { en: "{n} sales — margin unknown", pidgin: "{n} sales — we no know the profit", ha: "Siyarwa {n} — ba a san riba ba", ig: "Ahịa {n} — amaghị uru ha", yo: "Títà {n} — a kò mọ èrè wọn" },
  "finance.setCostPrices": { en: "Set cost prices in Inventory to measure profit", pidgin: "Set cost price for Inventory to know your profit", ha: "Saka farashin saye a Kaya don auna riba", ig: "Tọọ ọnụahịa ịzụ na Ngwaahịa iji tụọ uru", yo: "Ṣètò iye owó rírà nínú Ọjà láti mọ èrè" },
  "finance.revenueOnly":  { en: "revenue only", pidgin: "na revenue only", ha: "kuɗin shiga kawai", ig: "naanị ego mbata", yo: "owó wíwọlé nìkan" },
  "finance.howCalculated": { en: "How is this calculated?", pidgin: "How we take calculate am?", ha: "Yaya ake lissafa wannan?", ig: "Kedu otú e si gụọ nke a?", yo: "Báwo ni a ṣe ṣírò èyí?" },
  "finance.cfSales":          { en: "Sales", pidgin: "Sales", ha: "Tallace-tallace", ig: "Ahịa", yo: "Títà" },
  "finance.cfCreditSales":    { en: "Credit sales", pidgin: "Credit sales", ha: "Siyarwa ta bashi", ig: "Ahịa mgbazinye", yo: "Títà àwìn" },
  "finance.cfDebtRepayments": { en: "Debt repayments", pidgin: "Debt payback", ha: "Biyan bashi", ig: "Nkwụghachi ụgwọ", yo: "Ìsanpadà gbèsè" },
  "finance.cfInvoicePayments": { en: "Invoice payments", pidgin: "Invoice payments", ha: "Biyan takardun kuɗi", ig: "Ịkwụ akwụkwọ ụgwọ", yo: "Ìsanwó ìwé ìdíyelé" },
  "finance.cfAjoFees":        { en: "Ajo fee income", pidgin: "Ajo fee income", ha: "Kuɗin shiga na Ajo", ig: "Ego ụgwọ Ajo", yo: "Owó àsanpadà Àjọ" },
  "finance.cfExpenses":       { en: "Expenses", pidgin: "Expenses", ha: "Kashe-kashe", ig: "Mmefu", yo: "Ìnáwó" },
  "finance.cfStockPurchases": { en: "Stock purchases", pidgin: "Stock wey you buy", ha: "Sayen kaya", ig: "Ịzụ ngwaahịa", yo: "Ìrà ọjà" },
  "finance.cfBillPayments":   { en: "Bill payments", pidgin: "Bill payments", ha: "Biyan buƙatu", ig: "Ịkwụ ụgwọ ọrụ", yo: "Ìsanwó owó iṣẹ́" },
  "finance.cfTotalIn":        { en: "Total in", pidgin: "Total wey enter", ha: "Jimillar shiga", ig: "Ngụkọta batara", yo: "Àpapọ̀ tó wọlé" },
  "finance.cfTotalOut":       { en: "Total out", pidgin: "Total wey comot", ha: "Jimillar fita", ig: "Ngụkọta pụrụ", yo: "Àpapọ̀ tó jáde" },
  "finance.cfNet":            { en: "Net cash flow", pidgin: "Net cash flow", ha: "Sauran gudanar kuɗi", ig: "Mmegharị ego fọdụrụ", yo: "Àṣẹ́kù ìṣàn owó" },
  "finance.cfFailedBillsTitle": { en: "Failed bill payments (not deducted from balance)", pidgin: "Bill payments wey fail (we no remove am from balance)", ha: "Biyan buƙatu da suka kasa (ba a cire daga ragowa ba)", ig: "Ịkwụ ụgwọ ọrụ dara (ewepụghị ya na ego fọdụrụ)", yo: "Ìsanwó owó iṣẹ́ tó kùnà (a kò yọ ọ́ kúrò nínú ìyókù)" },
  "finance.cfFailedBills":    { en: "Bills attempted but failed", pidgin: "Bills wey you try but fail", ha: "Biyan buƙatu da aka gwada amma suka kasa", ig: "Ụgwọ ọrụ a nwara mana dara", yo: "Owó iṣẹ́ tí a gbìyànjú ṣùgbọ́n tó kùnà" },
  "finance.cfFailedBillPayments": { en: "Failed bill payments", pidgin: "Bill payments wey fail", ha: "Biyan buƙatu da suka kasa", ig: "Ịkwụ ụgwọ ọrụ dara", yo: "Ìsanwó owó iṣẹ́ tó kùnà" },
  "finance.cfClientSavings":  { en: "Client savings (not business income)", pidgin: "Client savings (no be business income)", ha: "Ajiyar abokan ciniki (ba kuɗin shigar kasuwanci ba)", ig: "Nchekwa ndị ahịa (ọ bụghị ego azụmahịa)", yo: "Ìfowópamọ́ oníbàárà (kì í ṣe owó iṣẹ́ òwò)" },
  "finance.cfHeldInTrust":    { en: "Held in trust", pidgin: "Wey you dey keep for dem", ha: "Ana riƙewa amana", ig: "Ejidere n'ntụkwasị obi", yo: "Tí a ń bá wọn tọ́jú" },
  "finance.cfReleased":       { en: "Released to clients", pidgin: "Wey you don give clients", ha: "An ba abokan ciniki", ig: "E nyere ndị ahịa", yo: "Tí a ti fún oníbàárà" },
  "finance.ddTransaction":    { en: "Transaction", pidgin: "Transaction", ha: "Ma'amala", ig: "Azụmahịa", yo: "Ìdúnàádúrà" },
  "finance.ddInvoice":        { en: "Invoice {ref}", pidgin: "Invoice {ref}", ha: "Takardar kuɗi {ref}", ig: "Akwụkwọ ụgwọ {ref}", yo: "Ìwé ìdíyelé {ref}" },
  "finance.ddInterestFor":    { en: "Interest — {name}", pidgin: "Interest — {name}", ha: "Riba — {name}", ig: "Ọmụrụnwa — {name}", yo: "Èlé — {name}" },
  "finance.ddItemsSumOne":    { en: "{n} item · sum {sum}", pidgin: "{n} item · total {sum}", ha: "Abu {n} · jimilla {sum}", ig: "Ihe {n} · ngụkọta {sum}", yo: "Nǹkan {n} · àpapọ̀ {sum}" },
  "finance.ddItemsSumMany":   { en: "{n} items · sum {sum}", pidgin: "{n} items · total {sum}", ha: "Abubuwa {n} · jimilla {sum}", ig: "Ihe {n} · ngụkọta {sum}", yo: "Nǹkan {n} · àpapọ̀ {sum}" },
  "finance.ddNoItems":        { en: "No items to show", pidgin: "No item to show", ha: "Babu abin nunawa", ig: "Enweghị ihe a ga-egosi", yo: "Kò sí nǹkan láti fihàn" },

  /* "How is this calculated?" */
  "finance.info1Title": { en: "Revenue", pidgin: "Revenue", ha: "Kuɗin shiga", ig: "Ego mbata", yo: "Owó wíwọlé" },
  "finance.info1Body":  { en: "Every money-in transaction with category 'sale' or 'credit sale'. Credit sales count at recording time — when the sale happens, not when the customer pays. Debt repayments received count as cash movement only; they don't create new revenue.", pidgin: "Every money-in transaction wey get category 'sale' or 'credit sale'. Credit sales dey count the time you record am — when the sale happen, no be when customer pay. Debt payback wey you collect na only cash movement; e no be new revenue.", ha: "Kowace ma'amalar shigar kuɗi mai rukuni 'sale' ko 'credit sale'. Ana ƙidaya siyarwar bashi a lokacin rubutawa — lokacin da siyarwar ta faru, ba lokacin da abokin ciniki ya biya ba. Biyan bashin da aka karɓa motsin kuɗi ne kawai; ba ya samar da sabon kuɗin shiga.", ig: "Azụmahịa ego mbata ọ bụla nwere ụdị 'sale' ma ọ bụ 'credit sale'. A na-agụ ahịa mgbazinye n'oge e dekọrọ ya — mgbe ahịa mere, ọ bụghị mgbe onye ahịa kwụrụ. Nkwụghachi ụgwọ a natara bụ naanị mmegharị ego; ha anaghị eweta ego mbata ọhụrụ.", yo: "Gbogbo ìdúnàádúrà owó wíwọlé tí ẹ̀ka rẹ̀ jẹ́ 'sale' tàbí 'credit sale'. A máa ń ka títà àwìn ní àkókò tí a kọ ọ́ sílẹ̀ — nígbà tí títà ṣẹlẹ̀, kì í ṣe nígbà tí oníbàárà san. Ìsanpadà gbèsè tí a gbà jẹ́ ìṣípòpadà owó nìkan; kò dá owó wíwọlé tuntun sílẹ̀." },
  "finance.info2Title": { en: "Service income", pidgin: "Service income", ha: "Kuɗin shiga na sabis", ig: "Ego ọrụ", yo: "Owó iṣẹ́ ìpèsè" },
  "finance.info2Body":  { en: "Ajo registration fees, withdrawal fees, and commissions are business service income — they appear in revenue with zero cost of goods (service work, no stock consumed).", pidgin: "Ajo registration fees, withdrawal fees, and commission na business service income — dem dey show for revenue with zero cost of goods (service work, no stock wey you use).", ha: "Kuɗin rajistar Ajo, kuɗin cire kuɗi, da kwamishan kuɗin shigar sabis na kasuwanci ne — suna bayyana a kuɗin shiga ba tare da farashin kaya ba (aikin sabis, ba a yi amfani da kaya ba).", ig: "Ụgwọ ndebanye aha Ajo, ụgwọ mwepụ ego, na kọmịshọn bụ ego ọrụ azụmahịa — ha na-apụta na ego mbata na-enweghị ọnụahịa ngwaahịa (ọrụ, ọ dịghị ngwaahịa ejiri).", yo: "Owó ìforúkọsílẹ̀ Àjọ, owó ìgbàjáde, àti kọmíṣọ̀n jẹ́ owó iṣẹ́ ìpèsè ti iṣẹ́ òwò — wọ́n máa ń hàn nínú owó wíwọlé láìsí iye owó ọjà (iṣẹ́ ìpèsè, a kò lo ọjà kankan)." },
  "finance.info3Title": { en: "Cost of Goods (COGS)", pidgin: "Cost of Goods (COGS)", ha: "Farashin Kaya (COGS)", ig: "Ọnụahịa Ngwaahịa (COGS)", yo: "Iye Owó Ọjà (COGS)" },
  "finance.info3Body":  { en: "Cost price × quantity for each named sale where the product has a known cost price set in Inventory. Items in the Needs-Costing queue (no cost price yet) contribute to revenue but not to gross profit — their margin is unknown until cost prices are set.", pidgin: "Cost price × quantity for each sale wey get name where the product get cost price for Inventory. Items wey dey Needs-Costing queue (no cost price yet) dey add to revenue but no dey add to gross profit — we no go know their profit until you set cost price.", ha: "Farashin saye × yawa ga kowace siyarwa mai suna inda kayan ke da sanannen farashin saye a Kaya. Kayan da ke jerin Needs-Costing (babu farashin saye tukuna) suna ƙara kuɗin shiga amma ba babban riba ba — ba a san ribarsu ba sai an saka farashin saye.", ig: "Ọnụahịa ịzụ × ọnụọgụ maka ahịa ọ bụla nwere aha ebe ngwaahịa ahụ nwere ọnụahịa ịzụ amaara na Ngwaahịa. Ngwa nọ n'usoro Needs-Costing (enweghị ọnụahịa ịzụ ugbu a) na-agbakwunye na ego mbata mana ọ bụghị na uru niile — amaghị uru ha ruo mgbe etinyere ọnụahịa ịzụ.", yo: "Iye owó rírà × iye fún títà kọ̀ọ̀kan tó ní orúkọ níbi tí ọjà náà ti ní iye owó rírà tí a mọ̀ nínú Ọjà. Àwọn ọjà tó wà nínú ìlà Needs-Costing (kò tíì ní iye owó rírà) ń fi kún owó wíwọlé ṣùgbọ́n kì í ṣe èrè gbogbo — a kò mọ èrè wọn títí a ó fi ṣètò iye owó rírà." },
  "finance.info4Title": { en: "Gross Profit", pidgin: "Gross Profit", ha: "Babban Riba", ig: "Uru Niile", yo: "Èrè Gbogbo" },
  "finance.info4Body":  { en: "Revenue from measurable sales (products with known cost prices) minus the cost of those goods. Unmeasured sales sit in a separate row — their revenue is tracked but margin is unknown.", pidgin: "Revenue from sales wey we fit measure (products wey get cost price) minus the cost of those goods. Sales wey we no fit measure dey for separate row — we dey track their revenue but we no know the profit.", ha: "Kuɗin shiga daga siyarwar da za a iya auna (kayan da ke da sanannen farashin saye) a cire farashin waɗannan kaya. Siyarwar da ba a iya auna ba tana a wani layi daban — ana bin kuɗin shigarta amma ba a san riba ba.", ig: "Ego mbata sitere n'ahịa a pụrụ ịtụ (ngwaahịa nwere ọnụahịa ịzụ amaara) wepụ ọnụahịa ngwa ndị ahụ. Ahịa a na-atụghị nọ n'ahịrị dị iche — a na-esochi ego mbata ha mana amaghị uru ha.", yo: "Owó wíwọlé láti inú títà tí a lè wọ̀n (ọjà tí a mọ iye owó rírà wọn) yọ iye owó àwọn ọjà náà kúrò. Títà tí a kò lè wọ̀n wà ní ìlà tirẹ̀ — à ń tọpinpin owó wíwọlé wọn ṣùgbọ́n a kò mọ èrè wọn." },
  "finance.info5Title": { en: "Expenses", pidgin: "Expenses", ha: "Kashe-kashe", ig: "Mmefu", yo: "Ìnáwó" },
  "finance.info5Body":  { en: "All money-out transactions except stock purchases (which are inventory investment, not a P&L expense) and bill payments (pass-through for utilities, data, etc.).", pidgin: "All money-out transactions except stock wey you buy (na investment for stock, no be P&L expense) and bill payments (wey just pass through for light, data, etc.).", ha: "Duk ma'amalolin fitar kuɗi sai dai sayen kaya (wanda zuba jari ne a kaya, ba kashewar riba da asara ba) da biyan buƙatu (wanda ke wucewa don wuta, data, da sauransu).", ig: "Azụmahịa ego pụrụ niile ma e wepụ ịzụ ngwaahịa (nke bụ itinye ego na ngwaahịa, ọ bụghị mmefu uru na mfu) na ịkwụ ụgwọ ọrụ (nke na-agafe maka ọkụ, data, wdg.).", yo: "Gbogbo ìdúnàádúrà owó jíjáde àyàfi ìrà ọjà (tí ó jẹ́ ìdókòwò sínú ọjà, kì í ṣe ìnáwó èrè àti àdánù) àti ìsanwó owó iṣẹ́ (tí ó kàn ń kọjá fún iná, dátà, abbl.)." },
  "finance.info6Title": { en: "Cash view", pidgin: "Cash view", ha: "Duban kuɗi", ig: "Nlele ego", yo: "Ìwòye owó" },
  "finance.info6Body":  { en: "Every actual money movement in the period: all money in (including debt repayments received) and all money out (including stock purchases and bill payments). Ajo contributions and payouts are shown separately as client savings held in trust — they are never mixed into business cash or income.", pidgin: "Every real money movement for the period: all money wey enter (including debt payback wey you collect) and all money wey comot (including stock wey you buy and bill payments). Ajo contributions and payouts dey show separate as client savings wey you dey keep for dem — we no dey mix am with business cash or income.", ha: "Kowane ainihin motsin kuɗi a lokacin: duk kuɗin shiga (har da biyan bashin da aka karɓa) da duk kuɗin fita (har da sayen kaya da biyan buƙatu). Ana nuna gudummawar Ajo da biyan kuɗi daban a matsayin ajiyar abokan ciniki da ake riƙewa amana — ba a taɓa haɗa su da kuɗin kasuwanci ko kuɗin shiga ba.", ig: "Mmegharị ego ọ bụla n'ezie n'oge ahụ: ego niile batara (gụnyere nkwụghachi ụgwọ a natara) na ego niile pụrụ (gụnyere ịzụ ngwaahịa na ịkwụ ụgwọ ọrụ). A na-egosi ntinye ego Ajo na ịkwụ ụgwọ iche dịka nchekwa ndị ahịa ejidere n'ntụkwasị obi — a naghị agwakọta ha na ego azụmahịa ma ọ bụ ego mbata.", yo: "Gbogbo ìṣípòpadà owó gidi ní àkókò náà: gbogbo owó tó wọlé (pẹ̀lú ìsanpadà gbèsè tí a gbà) àti gbogbo owó tó jáde (pẹ̀lú ìrà ọjà àti ìsanwó owó iṣẹ́). A máa ń fi owó àdáṣe Àjọ àti ìsanjáde hàn lọ́tọ̀ gẹ́gẹ́ bí ìfowópamọ́ oníbàárà tí a ń bá wọn tọ́jú — a kì í dà wọ́n pọ̀ mọ́ owó iṣẹ́ òwò tàbí owó wíwọlé." },
  "finance.info7Title": { en: "Interest earned", pidgin: "Interest wey you get", ha: "Ribar da aka samu", ig: "Ọmụrụnwa enwetara", yo: "Èlé tí a rí" },
  "finance.info7Body":  { en: "When a credit record carries a declared interest charge, repayments are allocated principal-first. Once the full principal is recovered, any further repayment in the period is recognised as interest income in the Profit view — zero cost of goods, fully measured. Interest is never double-counted in Cash: the repayment transaction already captures the cash flow.", pidgin: "When credit record get interest, payback dey go to the main money first. Once the full main money don come back, any other payback for the period na interest income for Profit view — zero cost of goods, fully measured. We no dey count interest two times for Cash: the payback transaction don already capture the cash flow.", ha: "Idan bayanin bashi na da ribar da aka bayyana, ana fara biyan babban kuɗin. Da zarar an karɓo babban kuɗin gaba ɗaya, duk wani ƙarin biya a lokacin ana ɗaukarsa a matsayin kuɗin ribar da aka samu a duban Riba — ba farashin kaya, an auna gaba ɗaya. Ba a taɓa ƙidaya riba sau biyu a Kuɗi ba: ma'amalar biyan ta riga ta kama motsin kuɗin.", ig: "Mgbe ndekọ mgbazinye nwere ọmụrụnwa ekwuputara, a na-ebu ụzọ tinye nkwụghachi n'isi ego. Ozugbo enwetaghachiri isi ego niile, nkwụghachi ọ bụla ọzọ n'oge ahụ bụ ego ọmụrụnwa na nlele Uru — enweghị ọnụahịa ngwaahịa, a tụrụ ya nke ọma. A naghị agụ ọmụrụnwa ugboro abụọ na Ego: azụmahịa nkwụghachi ejidelarị mmegharị ego ahụ.", yo: "Nígbà tí àkọsílẹ̀ àwìn bá ní èlé tí a kéde, ìsanpadà máa ń lọ sí owó ìpìlẹ̀ kọ́kọ́. Ní kété tí a bá gba gbogbo owó ìpìlẹ̀ padà, ìsanpadà míràn ní àkókò náà jẹ́ owó èlé nínú ìwòye Èrè — láìsí iye owó ọjà, a wọ̀n ọ́n pé. A kì í ka èlé lẹ́ẹ̀mejì nínú Owó: ìdúnàádúrà ìsanpadà ti ka ìṣàn owó náà tẹ́lẹ̀." },
  "finance.info8Title": { en: "Working Capital", pidgin: "Working Capital", ha: "Jarin Aiki", ig: "Isi Ego Ọrụ", yo: "Owó Ìdókòwò" },
  "finance.info8Body":  { en: "Working Capital position = your declared capital + cumulative net profit since the 'count from' date you set. Healthy means profit has not eroded your capital. Caution (amber) means losses are within 10% of declared capital. Shortfall (red) means losses have exceeded that threshold. Set your declared capital in Settings → Business.", pidgin: "Working Capital position = the capital wey you declare + all the net profit since the 'count from' date wey you set. Healthy mean say profit never chop your capital. Caution (amber) mean say loss dey inside 10% of your capital. Shortfall (red) mean say loss don pass that line. Set your capital for Settings → Business.", ha: "Matsayin Jarin Aiki = jarin da ka bayyana + jimillar ribar da aka samu tun ranar 'count from' da ka saka. Lafiya na nufin riba ba ta rage jarinka ba. Hattara (rawaya) na nufin asara tana cikin kashi 10% na jarin da aka bayyana. Gibi (ja) na nufin asara ta wuce wannan iyaka. Saka jarinka a Saituna → Kasuwanci.", ig: "Ọnọdụ Isi Ego Ọrụ = isi ego i kwuputara + uru niile kemgbe ụbọchị 'count from' ị tọrọ. Ọ dị mma pụtara na uru erighị isi ego gị. Kpachara anya (odo) pụtara na mfu dị n'ime 10% nke isi ego. Ụkọ (uhie) pụtara na mfu agafeela oke ahụ. Tọọ isi ego gị na Ntọala → Azụmahịa.", yo: "Ipò Owó Ìdókòwò = owó ìdókòwò tí o kéde + àpapọ̀ èrè láti ọjọ́ 'count from' tí o ṣètò. Ó dára túmọ̀ sí pé èrè kò jẹ owó ìdókòwò rẹ. Ṣọ́ra (ofeefee) túmọ̀ sí pé àdánù wà láàrin 10% owó ìdókòwò. Àìtó (pupa) túmọ̀ sí pé àdánù ti kọjá ààlà náà. Ṣètò owó ìdókòwò rẹ nínú Ètò → Iṣẹ́ Òwò." },

  /* Business loan screen */
  "finance.comingSoon":            { en: "Coming Soon", pidgin: "E dey come soon", ha: "Yana Zuwa Nan Ba Da Jimawa Ba", ig: "Ọ Na-abịa N'oge Na-adịghị Anya", yo: "Ó Ń Bọ̀ Láìpẹ́" },
  "finance.loanQuickFinancing":    { en: "Quick financing — no collateral required", pidgin: "Quick money — no collateral needed", ha: "Kuɗi cikin sauri — babu jingina", ig: "Ego ngwa ngwa — achọghị ihe nkwado", yo: "Owó kíákíá — kò nílò ìdógò" },
  "finance.loanEnterpriseRequired": { en: "Enterprise Plan required to access loans", pidgin: "You need Enterprise Plan to get loan", ha: "Ana buƙatar Tsarin Enterprise don samun lamuni", ig: "Achọrọ Atụmatụ Enterprise iji nweta mbinye ego", yo: "O nílò Ètò Enterprise láti rí ẹ̀yáwó" },
  "finance.loanUpgradeUnlock":     { en: "Upgrade to {plan} — Unlock Loans", pidgin: "Upgrade to {plan} — Open Loans", ha: "Haɓaka zuwa {plan} — Buɗe Lamuni", ig: "Kwalite gaa {plan} — Mepee Mbinye Ego", yo: "Gbéga sí {plan} — Ṣí Ẹ̀yáwó" },
  "finance.loanTermsTitle":        { en: "Terms & Conditions", pidgin: "Terms & Conditions", ha: "Sharudda da Ka'idoji", ig: "Usoro na Ọnọdụ", yo: "Òfin àti Àdéhùn" },
  "finance.loanTermsRead":         { en: "Read carefully before applying for a loan", pidgin: "Read am well before you apply for loan", ha: "Karanta da kyau kafin neman lamuni", ig: "Gụọ nke ọma tupu ị rịọ mbinye ego", yo: "Kà á dáadáa kí o tó béèrè fún ẹ̀yáwó" },
  "finance.loanAccept":            { en: "I Accept & Continue to Apply", pidgin: "I Accept & Continue to Apply", ha: "Na Amince & Ci Gaba da Nema", ig: "Ekwenyere m & Gaa n'ihu Rịọ", yo: "Mo Gbà & Tẹ̀síwájú Láti Béèrè" },
  "finance.loanUnlocksIn":         { en: "Loan Access Unlocks In", pidgin: "Loan go open in", ha: "Samun Lamuni Zai Buɗe Cikin", ig: "Nnweta Mbinye Ego Ga-emeghe N'ime", yo: "Ẹ̀yáwó Yóò Ṣí Láàrin" },
  "finance.loanAvailable120":      { en: "Available once you reach 120 days of active use", pidgin: "E go dey once you reach 120 days of active use", ha: "Zai samu da zarar ka kai kwanaki 120 na amfani", ig: "Ọ ga-adị ozugbo i ruru ụbọchị 120 nke iji ya", yo: "Yóò wà ní kété tí o bá dé ọjọ́ 120 ti lílò" },
  "finance.cdDays":                { en: "Days", pidgin: "Days", ha: "Kwanaki", ig: "Ụbọchị", yo: "Ọjọ́" },
  "finance.cdHours":               { en: "Hours", pidgin: "Hours", ha: "Awanni", ig: "Awa", yo: "Wákàtí" },
  "finance.cdMinutes":             { en: "Minutes", pidgin: "Minutes", ha: "Mintuna", ig: "Nkeji", yo: "Ìṣẹ́jú" },
  "finance.cdSeconds":             { en: "Seconds", pidgin: "Seconds", ha: "Daƙiƙoƙi", ig: "Sekọnd", yo: "Ìṣẹ́jú-àáyá" },
  "finance.loanEligibilityProgress": { en: "Eligibility Progress", pidgin: "How far you don reach", ha: "Ci gaban Cancanta", ig: "Ọganihu Ntozu", yo: "Ìlọsíwájú Ìtóótun" },
  "finance.loanDaysActive":        { en: "Days Active", pidgin: "Days Active", ha: "Kwanakin Aiki", ig: "Ụbọchị Na-arụ", yo: "Ọjọ́ Ìṣiṣẹ́" },
  "finance.loanActivityScore":     { en: "Activity Score", pidgin: "Activity Score", ha: "Makin Aiki", ig: "Akara Ọrụ", yo: "Máàkì Ìgbòkègbodò" },
  "finance.loanMayQualify":        { en: "Based on current activity, you may qualify for", pidgin: "Based on wetin you don do so far, you fit qualify for", ha: "Bisa ayyukan yanzu, za ka iya cancanta don", ig: "Dabere n'ọrụ ugbu a, ị nwere ike itozu maka", yo: "Gẹ́gẹ́ bí ìgbòkègbodò rẹ báyìí, o lè tọ́ sí" },
  "finance.loanKeepRecording":     { en: "Keep recording to increase your limit!", pidgin: "Keep dey record make your limit increase!", ha: "Ci gaba da rubutawa don ƙara iyakarka!", ig: "Gaa n'ihu na-edekọ ka oke gị bawanye!", yo: "Máa kọ sílẹ̀ kí òdiwọ̀n rẹ lè pọ̀ sí i!" },
  "finance.loanStatTransactions":  { en: "Transactions", pidgin: "Transactions", ha: "Ma'amaloli", ig: "Azụmahịa", yo: "Ìdúnàádúrà" },
  "finance.loanStatLast30":        { en: "Last 30 days", pidgin: "Last 30 days", ha: "Kwanaki 30 na ƙarshe", ig: "Ụbọchị 30 gara aga", yo: "Ọjọ́ 30 tó kọjá" },
  "finance.loanStatCreditRecords": { en: "Credit records", pidgin: "Credit records", ha: "Bayanan bashi", ig: "Ndekọ mgbazinye", yo: "Àkọsílẹ̀ àwìn" },
  "finance.loanPartnersAnalyse":   { en: "What Our Partners Analyse", pidgin: "Wetin Our Partners Dey Check", ha: "Abin da Abokan Huldarmu ke Nazari", ig: "Ihe Ndị Mmekọ Anyị Na-enyocha", yo: "Ohun Tí Àwọn Alábàáṣiṣẹ́pọ̀ Wa Ń Ṣàyẹ̀wò" },
  "finance.loanCheckConsistency":  { en: "Transaction consistency & frequency", pidgin: "How often & steady you dey record", ha: "Daidaito da yawan ma'amaloli", ig: "Nkwụsi ike na ugboro azụmahịa", yo: "Ìdúróṣinṣin àti ìgbàkúgbà ìdúnàádúrà" },
  "finance.loanCheckCashflow":     { en: "Business cash flow (income vs expenses)", pidgin: "Business cash flow (income vs expenses)", ha: "Gudanar kuɗin kasuwanci (shiga da kashewa)", ig: "Mmegharị ego azụmahịa (mbata na mmefu)", yo: "Ìṣàn owó iṣẹ́ òwò (wíwọlé àti ìnáwó)" },
  "finance.loanCheckCredit":       { en: "Credit management history", pidgin: "How you don manage credit", ha: "Tarihin gudanar da bashi", ig: "Akụkọ nlekọta mgbazinye", yo: "Ìtàn ìṣàkóso àwìn" },
  "finance.loanCheckAjo":          { en: "Ajo savings & financial discipline", pidgin: "Ajo savings & how you take manage money", ha: "Ajiyar Ajo da ladabin kuɗi", ig: "Nchekwa Ajo na ịdọ aka ná ntị n'ego", yo: "Ìfowópamọ́ Àjọ àti ìkóra-ẹni-níjàánu nínú owó" },
  "finance.loanCheck120":          { en: "120 days of active platform use", pidgin: "120 days of active use", ha: "Kwanaki 120 na amfani da dandali", ig: "Ụbọchị 120 nke iji nyiwe a", yo: "Ọjọ́ 120 ti lílo pẹpẹ" },
  "finance.loanYoureEligible":     { en: "You're Eligible!", pidgin: "You Qualify!", ha: "Ka Cancanta!", ig: "Ị Tozuru!", yo: "O Tọ́ Sí I!" },
  "finance.loanAccess":            { en: "Business Loan Access", pidgin: "Business Loan Access", ha: "Samun Lamunin Kasuwanci", ig: "Nnweta Mbinye Ego Azụmahịa", yo: "Àǹfààní Ẹ̀yáwó Iṣẹ́ Òwò" },
  "finance.loanOrMore":            { en: "or more, based on your activity", pidgin: "or more, based on wetin you dey do", ha: "ko fiye, bisa ayyukanka", ig: "ma ọ bụ karịa, dabere n'ọrụ gị", yo: "tàbí jù bẹ́ẹ̀ lọ, gẹ́gẹ́ bí ìgbòkègbodò rẹ" },
  "finance.loanEstimatedRange":    { en: "Your Estimated Loan Range", pidgin: "Your Loan Range (estimate)", ha: "Kimanin Adadin Lamuninka", ig: "Oke Mbinye Ego Gị A Tụrụ Anya", yo: "Iye Ẹ̀yáwó Rẹ Ní Ìfojúbù" },
  "finance.loanFinalAmount":       { en: "Final amount determined by our partners after review", pidgin: "Our partners go decide the final amount after dem check", ha: "Abokan huldarmu ne za su yanke adadin ƙarshe bayan dubawa", ig: "Ndị mmekọ anyị ga-ekpebi ego ikpeazụ mgbe nyocha gasịrị", yo: "Àwọn alábàáṣiṣẹ́pọ̀ wa ló máa pinnu iye ìkẹyìn lẹ́yìn àyẹ̀wò" },
  "finance.loanBusinessProfile":   { en: "Your Business Profile", pidgin: "Your Business Profile", ha: "Bayanin Kasuwancinka", ig: "Profaịlụ Azụmahịa Gị", yo: "Àpèjúwe Iṣẹ́ Òwò Rẹ" },
  "finance.loanTotalTransactions": { en: "Total Transactions", pidgin: "Total Transactions", ha: "Jimillar Ma'amaloli", ig: "Ngụkọta Azụmahịa", yo: "Àpapọ̀ Ìdúnàádúrà" },
  "finance.loanLast30Days":        { en: "Last 30 Days", pidgin: "Last 30 Days", ha: "Kwanaki 30 na Ƙarshe", ig: "Ụbọchị 30 Gara Aga", yo: "Ọjọ́ 30 Tó Kọjá" },
  "finance.loanNTxns":             { en: "{n} txns", pidgin: "{n} txns", ha: "ma'amala {n}", ig: "azụmahịa {n}", yo: "ìdúnàádúrà {n}" },
  "finance.loanTotalRevenue":      { en: "Total Revenue", pidgin: "Total Revenue", ha: "Jimillar Kuɗin Shiga", ig: "Ngụkọta Ego Mbata", yo: "Àpapọ̀ Owó Wíwọlé" },
  "finance.loanCreditRecords":     { en: "Credit Records", pidgin: "Credit Records", ha: "Bayanan Bashi", ig: "Ndekọ Mgbazinye", yo: "Àkọsílẹ̀ Àwìn" },
  "finance.loanAjoClients":        { en: "Ajo Clients", pidgin: "Ajo Clients", ha: "Abokan Ciniki na Ajo", ig: "Ndị Ahịa Ajo", yo: "Oníbàárà Àjọ" },
  "finance.loanFeatFast":          { en: "Fast review within 48–72 hours", pidgin: "Quick check inside 48–72 hours", ha: "Dubawa cikin sauri a awanni 48–72", ig: "Nyocha ngwa ngwa n'ime awa 48–72", yo: "Àyẹ̀wò kíákíá láàrin wákàtí 48–72" },
  "finance.loanFeatFastSub":       { en: "Our partners respond quickly", pidgin: "Our partners dey answer fast", ha: "Abokan huldarmu suna amsa da sauri", ig: "Ndị mmekọ anyị na-aza ngwa ngwa", yo: "Àwọn alábàáṣiṣẹ́pọ̀ wa máa ń dáhùn kíákíá" },
  "finance.loanFeatRates":         { en: "Competitive interest rates", pidgin: "Good interest rates", ha: "Ribar da ta dace", ig: "Ọmụrụnwa dị mma", yo: "Èlé tó dára" },
  "finance.loanFeatRatesSub":      { en: "Based on your business profile", pidgin: "Based on your business profile", ha: "Bisa bayanin kasuwancinka", ig: "Dabere na profaịlụ azụmahịa gị", yo: "Gẹ́gẹ́ bí àpèjúwe iṣẹ́ òwò rẹ" },
  "finance.loanFeatCollateral":    { en: "No collateral required", pidgin: "No collateral needed", ha: "Babu buƙatar jingina", ig: "Achọghị ihe nkwado", yo: "Kò nílò ìdógò" },
  "finance.loanFeatCollateralSub": { en: "Your data is your guarantee", pidgin: "Your data na your guarantee", ha: "Bayananka su ne tabbacinka", ig: "Data gị bụ nkwa gị", yo: "Àkọsílẹ̀ rẹ ni ìdánilójú rẹ" },
  "finance.loanFeatRepay":         { en: "Flexible repayment terms", pidgin: "Easy way to pay back", ha: "Sharuɗɗan biya masu sassauci", ig: "Usoro nkwụghachi dị mfe", yo: "Ọ̀nà ìsanpadà tó rọrùn" },
  "finance.loanFeatRepaySub":      { en: "Tailored to your cash flow", pidgin: "E go match how your money dey flow", ha: "An tsara bisa gudanar kuɗinka", ig: "Ahaziri ya maka mmegharị ego gị", yo: "A ṣe é fún ìṣàn owó rẹ" },
  "finance.loanBusinessLoans":     { en: "Business Loans", pidgin: "Business Loans", ha: "Lamunin Kasuwanci", ig: "Mbinye Ego Azụmahịa", yo: "Ẹ̀yáwó Iṣẹ́ Òwò" },
  "finance.enc1Title": { en: "You're building something great!", pidgin: "You dey build something great!", ha: "Kana gina wani abu mai girma!", ig: "Ị na-ewu ihe dị ukwuu!", yo: "Ò ń kọ́ nǹkan ńlá!" },
  "finance.enc1Body":  { en: "Every transaction you record is building your financial profile. Our lending partners see active, consistent businesses — and they reward them with better loan limits.", pidgin: "Every transaction wey you record dey build your money profile. Our loan partners dey see businesses wey active and steady — and dem dey reward dem with better loan limit.", ha: "Kowace ma'amala da ka rubuta tana gina bayanin kuɗinka. Abokan huldar ba da lamuninmu suna ganin kasuwancin da ke aiki akai-akai — kuma suna ba su lada da mafi kyawun iyakar lamuni.", ig: "Azụmahịa ọ bụla ị dekọrọ na-ewu profaịlụ ego gị. Ndị mmekọ anyị na-agbazinye ego na-ahụ azụmahịa na-arụ ọrụ mgbe niile — ha na-akwụ ha ụgwọ oke mbinye ego ka mma.", yo: "Gbogbo ìdúnàádúrà tí o kọ sílẹ̀ ń kọ́ àpèjúwe owó rẹ. Àwọn alábàáṣiṣẹ́pọ̀ awínni wa ń rí àwọn iṣẹ́ òwò tó ń ṣiṣẹ́ déédéé — wọ́n sì ń san èrè fún wọn pẹ̀lú òdiwọ̀n ẹ̀yáwó tó dára jù." },
  "finance.enc2Title": { en: "Your records = your credit score!", pidgin: "Your records = your credit score!", ha: "Bayananka = makin bashinka!", ig: "Ndekọ gị = akara mgbazinye gị!", yo: "Àkọsílẹ̀ rẹ = máàkì àwìn rẹ!" },
  "finance.enc2Body":  { en: "Unlike traditional banks, we don't just look at your bank statement. Every sale, every credit record, every Ajo contribution is evidence of your business strength.", pidgin: "We no be like normal bank wey only dey look your bank statement. Every sale, every credit record, every Ajo contribution na proof say your business strong.", ha: "Ba kamar bankunan gargajiya ba, ba bayanin asusun bankinka kaɗai muke dubawa ba. Kowace siyarwa, kowane bayanin bashi, kowace gudummawar Ajo shaida ce ta ƙarfin kasuwancinka.", ig: "N'adịghị ka ụlọ akụ ochie, anyị anaghị ele naanị nkọwa akaụntụ ụlọ akụ gị. Ahịa ọ bụla, ndekọ mgbazinye ọ bụla, ntinye ego Ajo ọ bụla bụ ihe akaebe na azụmahịa gị siri ike.", yo: "Kò dà bí àwọn ilé-ìfowópamọ́ àtijọ́, a kì í wo àkọọ́lẹ̀ báǹkì rẹ nìkan. Gbogbo títà, gbogbo àkọsílẹ̀ àwìn, gbogbo owó àdáṣe Àjọ jẹ́ ẹ̀rí agbára iṣẹ́ òwò rẹ." },
  "finance.enc3Title": { en: "Active businesses get more!", pidgin: "Active businesses dey get more!", ha: "Kasuwancin da ke aiki suna samun ƙari!", ig: "Azụmahịa na-arụ ọrụ na-enweta karịa!", yo: "Iṣẹ́ òwò tó ń ṣiṣẹ́ máa ń rí jù!" },
  "finance.enc3Body":  { en: "The more consistently you record your business activities, the stronger your profile becomes. Businesses with 100+ records qualify for our highest loan tiers — up to ₦5,000,000 or more.", pidgin: "As you dey record your business steady, na so your profile go dey strong. Businesses wey get 100+ records dey qualify for our highest loan level — reach ₦5,000,000 or more.", ha: "Yayin da kake rubuta ayyukan kasuwancinka akai-akai, bayaninka yana ƙara ƙarfi. Kasuwancin da ke da bayanai 100+ suna cancanta don matakan lamuninmu mafi girma — har zuwa ₦5,000,000 ko fiye.", ig: "Ka ị na-edekọ ọrụ azụmahịa gị mgbe niile, ka profaịlụ gị na-esiwanye ike. Azụmahịa nwere ndekọ 100+ na-etozu maka ọkwa mbinye ego anyị kacha elu — ruo ₦5,000,000 ma ọ bụ karịa.", yo: "Bí o ṣe ń kọ ìgbòkègbodò iṣẹ́ òwò rẹ sílẹ̀ déédéé tó, bẹ́ẹ̀ ni àpèjúwe rẹ ṣe ń lágbára sí i. Iṣẹ́ òwò tó ní àkọsílẹ̀ 100+ tọ́ sí ìpele ẹ̀yáwó wa tó ga jù — títí dé ₦5,000,000 tàbí jù bẹ́ẹ̀ lọ." },
  "finance.enc4Title": { en: "Stay consistent — it pays!", pidgin: "Dey steady — e dey pay!", ha: "Ci gaba da daidaito — yana da riba!", ig: "Nọgide na-eme ya — ọ na-akwụ ụgwọ!", yo: "Máa ṣe é déédéé — ó ń mówó wá!" },
  "finance.enc4Body":  { en: "Our partners reward consistency. A business that records every day is far more trusted than one with gaps. Keep recording and watch your eligible amount grow.", pidgin: "Our partners dey reward people wey dey steady. Business wey dey record every day dey get trust pass the one wey dey skip. Keep dey record and watch your amount dey grow.", ha: "Abokan huldarmu suna ba da lada ga daidaito. Kasuwancin da ke rubutawa kowace rana ya fi samun amincewa fiye da wanda ke da gibi. Ci gaba da rubutawa ka ga adadinka yana ƙaruwa.", ig: "Ndị mmekọ anyị na-akwụ ụgwọ maka nkwụsi ike. A na-atụkwasị azụmahịa na-edekọ kwa ụbọchị obi karịa nke nwere oghere. Gaa n'ihu na-edekọ ma lee ka ego gị na-eto.", yo: "Àwọn alábàáṣiṣẹ́pọ̀ wa máa ń san èrè fún ìdúróṣinṣin. Iṣẹ́ òwò tó ń kọ sílẹ̀ lójoojúmọ́ ni a gbẹ́kẹ̀lé jù èyí tó ní àlàfo lọ. Máa kọ sílẹ̀ kí o sì wo bí iye rẹ ṣe ń pọ̀ sí i." },
  "finance.enc5Title": { en: "Partners are watching your growth!", pidgin: "Partners dey watch as you dey grow!", ha: "Abokan hulda suna kallon ci gabanka!", ig: "Ndị mmekọ na-ele uto gị!", yo: "Àwọn alábàáṣiṣẹ́pọ̀ ń wo ìdàgbàsókè rẹ!" },
  "finance.enc5Body":  { en: "Our lending partners analyse real business data — not guesswork. Your daily records are your strongest loan application. Record every sale, every expense, every credit.", pidgin: "Our loan partners dey check real business data — no be guess. Your daily records na your strongest loan application. Record every sale, every expense, every credit.", ha: "Abokan huldar ba da lamuninmu suna nazarin ainihin bayanan kasuwanci — ba hasashe ba. Bayananka na yau da kullum su ne mafi ƙarfin neman lamuninka. Rubuta kowace siyarwa, kowace kashewa, kowane bashi.", ig: "Ndị mmekọ anyị na-agbazinye ego na-enyocha ezi data azụmahịa — ọ bụghị nkọ. Ndekọ gị kwa ụbọchị bụ arịrịọ mbinye ego gị kacha sie ike. Dekọọ ahịa ọ bụla, mmefu ọ bụla, mgbazinye ọ bụla.", yo: "Àwọn alábàáṣiṣẹ́pọ̀ awínni wa ń ṣàyẹ̀wò àkọsílẹ̀ iṣẹ́ òwò gidi — kì í ṣe àfojúdá. Àkọsílẹ̀ ojoojúmọ́ rẹ ni ìbéèrè ẹ̀yáwó rẹ tó lágbára jù. Kọ gbogbo títà, gbogbo ìnáwó, gbogbo àwìn sílẹ̀." },
  "finance.enc6Title": { en: "Unlock up to ₦5,000,000!", pidgin: "Open reach ₦5,000,000!", ha: "Buɗe har zuwa ₦5,000,000!", ig: "Mepee ruo ₦5,000,000!", yo: "Ṣí títí dé ₦5,000,000!" },
  "finance.enc6Body":  { en: "Hit 120 days of consistent activity and you'll be able to apply for up to ₦5,000,000 in business financing — with no collateral required.", pidgin: "Reach 120 days of steady activity and you go fit apply for reach ₦5,000,000 business money — no collateral needed.", ha: "Kai kwanaki 120 na aiki akai-akai kuma za ka iya neman har zuwa ₦5,000,000 na kuɗin kasuwanci — ba tare da jingina ba.", ig: "Ruo ụbọchị 120 nke ọrụ mgbe niile ma ị ga-enwe ike ịrịọ ruo ₦5,000,000 ego azụmahịa — n'achọghị ihe nkwado.", yo: "Dé ọjọ́ 120 ìgbòkègbodò déédéé, o sì máa lè béèrè fún títí dé ₦5,000,000 owó iṣẹ́ òwò — láìnílò ìdógò." },
  "finance.loanTerms": { en: `BUSINESS LOAN ACCESS — TERMS & CONDITIONS

1. ELIGIBILITY
You must have been an active KudiAI Track subscriber on the Enterprise Plan for at least 4 calendar months (120 days). "Active" means consistently recording business transactions, managing credit records, and keeping your business data current on the platform throughout this period.

2. DATA ANALYSIS & CONSENT
By proceeding with a loan application, you explicitly authorize KudiAI Track and its verified lending partners to securely access and analyze your business transaction history, credit records, Ajo savings data, inventory activity, and other business records on the platform. This data is the primary basis for assessing your loan eligibility and the amount you qualify for.

3. LOAN AMOUNT
Eligible businesses may be assessed for loans ranging from ₦100,000 to ₦5,000,000 or higher, depending on their recorded business activity and financial performance. The final amount approved is solely determined by our lending partners based on your platform data and credit assessment.

4. PRIVACY & DATA SECURITY
Your business data will be transmitted securely to our verified lending partners under strict confidentiality and data protection agreements in compliance with the Nigeria Data Protection Act (NDPA). Your data will not be sold, rented, or shared for any purpose other than loan assessment.

5. NO GUARANTEE OF APPROVAL
Submitting an application does not guarantee loan approval. Our lending partners reserve the right to approve, decline, or modify any application based on their credit assessment criteria.

6. REPAYMENT OBLIGATION
All approved loans must be repaid in full according to the terms communicated by the lending partner. Failure to repay may result in legal action and will be reported to relevant credit bureaus.

7. CONTINUED PLATFORM ACTIVITY
You are encouraged to continue recording all business activities on KudiAI Track throughout the duration of any loan. Continued activity may positively impact future loan eligibility and credit limits.

8. DATA ACCURACY
You confirm and warrant that all business data recorded on the platform is accurate, truthful, and representative of your actual business operations. Providing false or misleading information is grounds for immediate application cancellation and may result in legal consequences.

9. AMENDMENTS
KudiAI Track reserves the right to modify these terms at any time. Continued use of the loan access feature constitutes acceptance of any updated terms.

By tapping "I Accept & Continue", you confirm you have read, understood, and agreed to these terms and conditions.`,
    pidgin: `BUSINESS LOAN ACCESS — TERMS & CONDITIONS

1. WHO FIT APPLY
You must don dey use KudiAI Track as active subscriber for Enterprise Plan for at least 4 calendar months (120 days). "Active" mean say you dey record your business transactions every time, dey manage your credit records, and dey keep your business data up to date for the platform for that whole time.

2. DATA CHECK & YOUR PERMISSION
When you apply for loan, you dey allow KudiAI Track and our verified lending partners to safely see and check your business transaction history, credit records, Ajo savings data, stock activity, and other business records for the platform. Na this data dem go mainly use to know whether you qualify and how much you fit collect.

3. LOAN AMOUNT
Businesses wey qualify fit get loan from ₦100,000 reach ₦5,000,000 or more, depending on the business activity and money performance wey dem record. Na only our lending partners go decide the final amount, based on your platform data and credit check.

4. PRIVACY & DATA SAFETY
We go send your business data safely to our verified lending partners under strict confidentiality and data protection agreement, according to the Nigeria Data Protection Act (NDPA). Nobody go sell, rent, or share your data for any other reason apart from loan check.

5. APPROVAL NO DEY GUARANTEED
To submit application no mean say the loan go approve. Our lending partners fit approve, decline, or change any application based on their own credit check rules.

6. YOU MUST PAY BACK
You must pay back every approved loan finish according to the terms wey the lending partner give you. If you no pay, dem fit take legal action and report you to credit bureaus.

7. CONTINUE TO USE THE PLATFORM
We encourage you to continue to record all your business activities for KudiAI Track throughout the loan time. If you continue, e fit help you qualify for more loan and higher credit limit for future.

8. CORRECT DATA
You confirm say all the business data wey you record for the platform correct, true, and show how your business really dey run. If you give false or wrong information, dem go cancel your application sharp sharp and you fit face legal wahala.

9. CHANGES
KudiAI Track fit change these terms anytime. If you continue to use the loan access feature, e mean say you accept the new terms.

When you tap "I Accept & Continue", you dey confirm say you don read, understand, and agree to these terms and conditions.`,
    ha: `SAMUN LAMUNIN KASUWANCI — SHARUDDA DA KA'IDOJI

1. CANCANTA
Dole ne ka kasance mai biyan kuɗin KudiAI Track mai aiki a kan Tsarin Enterprise na aƙalla watanni 4 (kwanaki 120). "Mai aiki" na nufin yin rajistar ma'amalolin kasuwanci akai-akai, kula da bayanan bashi, da kuma sabunta bayanan kasuwancinka a dandalin a duk tsawon wannan lokaci.

2. NAZARIN BAYANAI DA IZINI
Ta hanyar ci gaba da neman lamuni, kana ba KudiAI Track da abokan huldar ba da lamuni da aka tabbatar izini a fili su shiga su kuma yi nazarin tarihin ma'amalolin kasuwancinka, bayanan bashi, bayanan ajiyar Ajo, ayyukan kaya, da sauran bayanan kasuwanci a dandalin cikin aminci. Waɗannan bayanai su ne babban tushen tantance cancantarka da adadin da ka cancanci samu.

3. ADADIN LAMUNI
Kasuwancin da suka cancanta za a iya tantance su don lamuni daga ₦100,000 zuwa ₦5,000,000 ko fiye, gwargwadon ayyukan kasuwancinsu da aka rubuta da yadda kuɗinsu ke tafiya. Abokan huldar ba da lamuninmu ne kaɗai ke yanke adadin ƙarshe da aka amince da shi bisa bayanan dandalinka da tantance bashi.

4. SIRRI DA TSARON BAYANAI
Za a aika bayanan kasuwancinka cikin aminci zuwa ga abokan huldar ba da lamuninmu da aka tabbatar a ƙarƙashin yarjejeniyoyin sirri da kare bayanai masu tsauri bisa Dokar Kare Bayanai ta Najeriya (NDPA). Ba za a sayar, a yi hayar, ko a raba bayananka don wata manufa ba sai dai tantance lamuni.

5. BA TABBACIN AMINCEWA
Tura neman lamuni ba ya tabbatar da amincewa da lamunin. Abokan huldar ba da lamuninmu suna da 'yancin amincewa, ƙi, ko gyara kowace buƙata bisa ka'idojin tantance bashinsu.

6. WAJIBCIN BIYA
Dole ne a biya duk lamunin da aka amince da shi gaba ɗaya bisa sharuddan da abokin huldar ba da lamuni ya sanar. Rashin biya na iya haifar da matakin shari'a kuma za a kai rahoto ga hukumomin bayanan bashi.

7. CI GABA DA AMFANI DA DANDALI
Ana ƙarfafa ka ka ci gaba da rubuta duk ayyukan kasuwanci a KudiAI Track a duk tsawon kowane lamuni. Ci gaba da aiki na iya inganta cancantar lamuni da iyakar bashi a nan gaba.

8. INGANCIN BAYANAI
Ka tabbatar kuma ka ba da tabbaci cewa duk bayanan kasuwancin da aka rubuta a dandalin daidai ne, gaskiya ne, kuma suna wakiltar ainihin ayyukan kasuwancinka. Bayar da bayanan ƙarya ko na yaudara dalili ne na soke buƙatar nan take kuma na iya haifar da sakamakon shari'a.

9. GYARE-GYARE
KudiAI Track tana da 'yancin gyara waɗannan sharuɗɗa a kowane lokaci. Ci gaba da amfani da fasalin samun lamuni yana nufin amincewa da duk wani sabon sharaɗi.

Ta danna "I Accept & Continue", ka tabbatar cewa ka karanta, ka fahimta, kuma ka amince da waɗannan sharuɗɗa da ka'idoji.`,
    ig: `NNWETA MBINYE EGO AZỤMAHỊA — USORO NA ỌNỌDỤ

1. ONYE TOZURU
Ị ga-abụrịrị onye debanyere aha KudiAI Track na-arụ ọrụ na Atụmatụ Enterprise opekata mpe ọnwa 4 (ụbọchị 120). "Na-arụ ọrụ" pụtara ịdekọ azụmahịa gị mgbe niile, ilekọta ndekọ mgbazinye, na idobe data azụmahịa gị ka ọ dị ọhụrụ na nyiwe a n'oge ahụ niile.

2. NYOCHA DATA NA NKWENYE
Site n'ịga n'ihu na arịrịọ mbinye ego, ị na-enye KudiAI Track na ndị mmekọ na-agbazinye ego a kwadoro ikike n'ụzọ doro anya ịbanye n'enweghị nsogbu ma nyochaa akụkọ azụmahịa gị, ndekọ mgbazinye, data nchekwa Ajo, ihe gbasara ngwaahịa, na ndekọ azụmahịa ndị ọzọ dị na nyiwe a. Data a bụ isi ihe a na-eji amata ma ị tozuru na ego ole ị ga-enweta.

3. EGO MBINYE
Azụmahịa tozuru etozu nwere ike nweta nyocha maka mbinye ego site na ₦100,000 ruo ₦5,000,000 ma ọ bụ karịa, dabere na ọrụ azụmahịa ha edekọrọ na otú ego ha si aga. Ọ bụ naanị ndị mmekọ anyị na-agbazinye ego ga-ekpebi ego ikpeazụ a kwadoro dabere na data nyiwe gị na nyocha mgbazinye.

4. NZUZO NA NCHEKWA DATA
A ga-ezipu data azụmahịa gị n'enweghị nsogbu nye ndị mmekọ anyị na-agbazinye ego a kwadoro n'okpuru nkwekọrịta nzuzo na nchedo data siri ike dịka Iwu Nchedo Data Naịjirịa (NDPA) si dị. A gaghị ere, gbazinye, ma ọ bụ kesaa data gị maka ebumnuche ọ bụla karịa nyocha mbinye ego.

5. ỌNWEGHỊ NKWA NA A GA-AKWADO YA
Izipu arịrịọ apụtaghị na a ga-akwado mbinye ego ahụ. Ndị mmekọ anyị na-agbazinye ego nwere ikike ịkwado, ịjụ, ma ọ bụ ịgbanwe arịrịọ ọ bụla dabere n'usoro nyocha mgbazinye ha.

6. ỌRỤ ỊKWỤGHACHI
A ga-akwụghachi mbinye ego ọ bụla a kwadoro n'uju dịka usoro onye mmekọ na-agbazinye ego kọwara si dị. Ọ bụrụ na ịkwụghachighị, e nwere ike ime ihe gbasara iwu ma kọọrọ ndị na-edekọ akụkọ mgbazinye.

7. ỊGA N'IHU N'ỌRỤ NA NYIWE A
A na-agba gị ume ka ị gaa n'ihu na-edekọ ihe niile gbasara azụmahịa gị na KudiAI Track n'oge mbinye ego ọ bụla. Ịga n'ihu nwere ike inyere gị aka itozu maka mbinye ego na oke mgbazinye ka ukwuu n'ọdịnihu.

8. EZIOKWU DATA
Ị kwenyere ma kwe nkwa na data azụmahịa niile edekọrọ na nyiwe a bụ eziokwu, zie ezie, ma gosi otú azụmahịa gị si arụ n'ezie. Inye ozi ụgha ma ọ bụ nke na-eduhie mmadụ bụ ihe ga-eme ka a kagbuo arịrịọ ozugbo ma nwee ike ibute nsogbu iwu.

9. MGBANWE
KudiAI Track nwere ikike ịgbanwe usoro ndị a n'oge ọ bụla. Ịga n'ihu na-eji njirimara nnweta mbinye ego pụtara na ị nabatara usoro ọhụrụ ọ bụla.

Site n'ịpị "I Accept & Continue", ị na-akwado na ị gụrụ, ghọta, ma kwenye n'usoro na ọnọdụ ndị a.`,
    yo: `ÀǸFÀÀNÍ Ẹ̀YÁWÓ IṢẸ́ ÒWÒ — ÀWỌN ÒFIN ÀTI ÀDÉHÙN

1. ẸNI TÓ TỌ́
O gbọ́dọ̀ ti jẹ́ alábàápín KudiAI Track tó ń ṣiṣẹ́ lórí Ètò Enterprise fún ó kéré tán oṣù mẹ́rin (ọjọ́ 120). "Tó ń ṣiṣẹ́" túmọ̀ sí kíkọ àwọn ìdúnàádúrà iṣẹ́ òwò sílẹ̀ déédéé, ṣíṣàkóso àkọsílẹ̀ àwìn, àti mímú kí àkọsílẹ̀ iṣẹ́ òwò rẹ wà lọ́jọ́ lórí pẹpẹ yìí ní gbogbo àkókò náà.

2. ÀYẸ̀WÒ ÀKỌSÍLẸ̀ ÀTI ÌFỌWỌ́SÍ
Nípa títẹ̀síwájú pẹ̀lú ìbéèrè ẹ̀yáwó, o fún KudiAI Track àti àwọn alábàáṣiṣẹ́pọ̀ awínni tí a ti fìdí wọn múlẹ̀ ní àṣẹ kedere láti wọlé láìléwu kí wọ́n sì ṣàyẹ̀wò ìtàn ìdúnàádúrà iṣẹ́ òwò rẹ, àkọsílẹ̀ àwìn, àkọsílẹ̀ ìfowópamọ́ Àjọ, ìgbòkègbodò ọjà, àti àwọn àkọsílẹ̀ iṣẹ́ òwò míràn lórí pẹpẹ yìí. Àkọsílẹ̀ yìí ni ìpìlẹ̀ àkọ́kọ́ fún ṣíṣe àyẹ̀wò bóyá o tọ́ sí ẹ̀yáwó àti iye tí o lè gbà.

3. IYE Ẹ̀YÁWÓ
Àwọn iṣẹ́ òwò tó tọ́ lè ní àyẹ̀wò fún ẹ̀yáwó láti ₦100,000 dé ₦5,000,000 tàbí jù bẹ́ẹ̀ lọ, gẹ́gẹ́ bí ìgbòkègbodò iṣẹ́ òwò wọn tí a kọ sílẹ̀ àti bí owó wọn ṣe ń lọ. Àwọn alábàáṣiṣẹ́pọ̀ awínni wa nìkan ló máa pinnu iye ìkẹyìn tí a fọwọ́ sí, gẹ́gẹ́ bí àkọsílẹ̀ pẹpẹ rẹ àti àyẹ̀wò àwìn.

4. ÀṢÍRÍ ÀTI ÀÀBÒ ÀKỌSÍLẸ̀
A ó fi àkọsílẹ̀ iṣẹ́ òwò rẹ ránṣẹ́ láìléwu sí àwọn alábàáṣiṣẹ́pọ̀ awínni wa tí a ti fìdí wọn múlẹ̀ lábẹ́ àdéhùn àṣírí àti ààbò àkọsílẹ̀ tó le, ní ìbámu pẹ̀lú Òfin Ààbò Àkọsílẹ̀ Nàìjíríà (NDPA). A kò ní ta, yá, tàbí pín àkọsílẹ̀ rẹ fún ète míràn yàtọ̀ sí àyẹ̀wò ẹ̀yáwó.

5. KÒ SÍ ÌDÁNILÓJÚ ÌFỌWỌ́SÍ
Fífi ìbéèrè ránṣẹ́ kò túmọ̀ sí pé a ó fọwọ́ sí ẹ̀yáwó náà. Àwọn alábàáṣiṣẹ́pọ̀ awínni wa ní ẹ̀tọ́ láti fọwọ́ sí, kọ̀, tàbí ṣàtúnṣe ìbéèrè èyíkéyìí gẹ́gẹ́ bí òdiwọ̀n àyẹ̀wò àwìn wọn.

6. ỌRANYÀN ÌSANPADÀ
Gbogbo ẹ̀yáwó tí a fọwọ́ sí gbọ́dọ̀ jẹ́ sísan padà ní kíkún gẹ́gẹ́ bí àdéhùn tí alábàáṣiṣẹ́pọ̀ awínni sọ. Àìsanpadà lè yọrí sí ìgbésẹ̀ òfin, a ó sì fi ròyìn fún àwọn àjọ ìtọpinpin àwìn tó yẹ.

7. ÌTẸ̀SÍWÁJÚ LÓRÍ PẸPẸ
A gbà ọ́ níyànjú láti máa kọ gbogbo ìgbòkègbodò iṣẹ́ òwò rẹ sílẹ̀ lórí KudiAI Track ní gbogbo àkókò ẹ̀yáwó èyíkéyìí. Ìtẹ̀síwájú lè mú kí o tọ́ sí ẹ̀yáwó àti òdiwọ̀n àwìn tó ga jù lọ́jọ́ iwájú.

8. ÌPÉYE ÀKỌSÍLẸ̀
O jẹ́rìí, o sì ṣe ìdánilójú pé gbogbo àkọsílẹ̀ iṣẹ́ òwò lórí pẹpẹ yìí péye, òtítọ́ ni, ó sì ṣàfihàn bí iṣẹ́ òwò rẹ ṣe ń lọ gan-an. Fífúnni ní àlàyé èké tàbí ṣíṣinilọ́nà jẹ́ ìdí fún fífagilé ìbéèrè lẹ́sẹ̀kẹsẹ̀, ó sì lè yọrí sí àbájáde òfin.

9. ÀTÚNṢE
KudiAI Track ní ẹ̀tọ́ láti ṣàtúnṣe àwọn òfin yìí nígbàkígbà. Lílo àǹfààní ẹ̀yáwó lọ túmọ̀ sí pé o gba àwọn òfin tuntun èyíkéyìí.

Nípa títẹ "I Accept & Continue", o jẹ́rìí pé o ti kà á, o yé ọ, o sì gbà pẹ̀lú àwọn òfin àti àdéhùn wọ̀nyí.` },

  /* Plan labels (same wording as utils/plans.js, in the chosen language) */
  "finance.planUpgradePlan":     { en: "Upgrade Plan", pidgin: "Upgrade Plan", ha: "Haɓaka Tsari", ig: "Kwalite Atụmatụ", yo: "Gbé Ètò Ga" },
  "finance.planPricePerMonth":   { en: "₦{amount}/mo", pidgin: "₦{amount}/month", ha: "₦{amount}/wata", ig: "₦{amount}/ọnwa", yo: "₦{amount}/oṣù" },
  "finance.planFree":            { en: "Free", pidgin: "Free", ha: "Kyauta", ig: "N'efu", yo: "Ọ̀fẹ́" },
  "finance.planUpgradeTo":       { en: "Upgrade to {plan} — {price}", pidgin: "Upgrade to {plan} — {price}", ha: "Haɓaka zuwa {plan} — {price}", ig: "Kwalite gaa {plan} — {price}", yo: "Gbéga sí {plan} — {price}" },
  "finance.planNotIncluded":     { en: "Not included in your plan", pidgin: "E no dey your plan", ha: "Ba ya cikin tsarinka", ig: "Ọ nọghị n'atụmatụ gị", yo: "Kò sí nínú ètò rẹ" },
  "finance.planRequired":        { en: "{plan} Plan Required", pidgin: "You need {plan} Plan", ha: "Ana Buƙatar Tsarin {plan}", ig: "Achọrọ Atụmatụ {plan}", yo: "O Nílò Ètò {plan}" },
  "finance.planUpgradeRequired": { en: "Upgrade Required", pidgin: "You need to upgrade", ha: "Ana Buƙatar Haɓakawa", ig: "Achọrọ Nkwalite", yo: "O Nílò Láti Gbéga" },
  "finance.planNotInCurrent":    { en: "This feature is not included in your current plan.", pidgin: "This feature no dey your current plan.", ha: "Wannan fasalin ba ya cikin tsarinka na yanzu.", ig: "Njirimara a anọghị n'atụmatụ gị ugbu a.", yo: "Àǹfààní yìí kò sí nínú ètò rẹ lọ́wọ́lọ́wọ́." },
  "finance.planAvailableOn":     { en: "Available on the {plan} plan and above.", pidgin: "E dey for {plan} plan and above.", ha: "Akwai a tsarin {plan} da sama.", ig: "Ọ dị n'atụmatụ {plan} na nke dị elu.", yo: "Ó wà lórí ètò {plan} àti èyí tó ga jù." },
  "finance.planUpgradeToAccess": { en: "Upgrade to access this feature.", pidgin: "Upgrade to use this feature.", ha: "Haɓaka don samun wannan fasalin.", ig: "Kwalite iji nweta njirimara a.", yo: "Gbéga láti lo àǹfààní yìí." },

  /* Short month names (on-screen dates like "1 Oct 2026") */
  "finance.monthShort1":  { en: "Jan", pidgin: "Jan", ha: "Jan", ig: "Jen", yo: "Ṣẹ́rẹ́" },
  "finance.monthShort2":  { en: "Feb", pidgin: "Feb", ha: "Fab", ig: "Feb", yo: "Èrèlè" },
  "finance.monthShort3":  { en: "Mar", pidgin: "Mar", ha: "Mar", ig: "Maa", yo: "Ẹrẹ̀nà" },
  "finance.monthShort4":  { en: "Apr", pidgin: "Apr", ha: "Afi", ig: "Epr", yo: "Ìgbé" },
  "finance.monthShort5":  { en: "May", pidgin: "May", ha: "May", ig: "Mee", yo: "Ẹ̀bibi" },
  "finance.monthShort6":  { en: "Jun", pidgin: "Jun", ha: "Yun", ig: "Juu", yo: "Òkúdu" },
  "finance.monthShort7":  { en: "Jul", pidgin: "Jul", ha: "Yul", ig: "Jul", yo: "Agẹmọ" },
  "finance.monthShort8":  { en: "Aug", pidgin: "Aug", ha: "Agu", ig: "Ọgọ", yo: "Ògún" },
  "finance.monthShort9":  { en: "Sep", pidgin: "Sep", ha: "Sat", ig: "Sep", yo: "Owewe" },
  "finance.monthShort10": { en: "Oct", pidgin: "Oct", ha: "Okt", ig: "Ọkt", yo: "Ọ̀wàrà" },
  "finance.monthShort11": { en: "Nov", pidgin: "Nov", ha: "Nuw", ig: "Nov", yo: "Bélú" },
  "finance.monthShort12": { en: "Dec", pidgin: "Dec", ha: "Dis", ig: "Dis", yo: "Ọ̀pẹ̀" },
};

export default T;
