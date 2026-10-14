// home — UI text in all five languages. Keys: "home.<name>": { en, pidgin, ha, ig, yo }. Use {var} for values: t("home.x", { var }).
// Home dashboard, profile banners and the KudiAI daily brief. (Older home.* keys — todayProfit, payBills, seeAll, recentTxns,
// noTxns, welcome … — live in src/utils/translations.js and are not repeated here.)
const T = {
  /* ── Wallet account-number notice ── */
  "home.walletRetired":     { en: "Your old wallet number has stopped working", pidgin: "Your old wallet number don stop to work", ha: "Tsohuwar lambar walat ɗinka ta daina aiki", ig: "Nọmba walet ochie gị akwụsịla ịrụ ọrụ", yo: "Nọ́ńbà wọ́lẹ́ẹ̀tì àtijọ́ rẹ ti dáwọ́ iṣẹ́ dúró" },
  "home.walletNewNumber":   { en: "Your wallet has a new account number", pidgin: "Your wallet don get new account number", ha: "Walat ɗinka yana da sabuwar lambar asusu", ig: "Walet gị nwere nọmba akaụntụ ọhụrụ", yo: "Wọ́lẹ́ẹ̀tì rẹ ní nọ́ńbà àkáǹtì tuntun" },
  "home.walletTapNewNumber": { en: "Tap to get your new number", pidgin: "Tap make you collect your new number", ha: "Taɓa don samun sabuwar lambarka", ig: "Pịa ka ị nweta nọmba ọhụrụ gị", yo: "Tẹ̀ láti gba nọ́ńbà tuntun rẹ" },

  /* ── Hero card ── */
  "home.showBalances":      { en: "Show balances",   pidgin: "Show balance",    ha: "Nuna ma'auni",   ig: "Gosi ego dị n'akaụntụ", yo: "Fi iye owó hàn" },
  "home.hideBalances":      { en: "Hide balances",   pidgin: "Hide balance",    ha: "Ɓoye ma'auni",   ig: "Zoo ego dị n'akaụntụ",  yo: "Fi iye owó pamọ́" },
  "home.heroSales":         { en: "Sales",           pidgin: "Sales",           ha: "Tallace-tallace", ig: "Ahịa",                 yo: "Títà" },
  "home.heroWallet":        { en: "Wallet",          pidgin: "Wallet",          ha: "Walat",          ig: "Walet",                 yo: "Wọ́lẹ́ẹ̀tì" },
  "home.walletBalance":     { en: "WALLET BALANCE",  pidgin: "WALLET BALANCE",  ha: "KUƊIN WALAT",    ig: "EGO DỊ NA WALET",       yo: "OWÓ INÚ WỌ́LẸ́Ẹ̀TÌ" },
  "home.activateWallet":    { en: "Activate wallet", pidgin: "Open your wallet", ha: "Kunna walat",   ig: "Mee ka walet rụọ ọrụ",  yo: "Mú wọ́lẹ́ẹ̀tì ṣiṣẹ́" },
  "home.fund":              { en: "Fund",            pidgin: "Fund",            ha: "Saka kuɗi",      ig: "Tinye ego",             yo: "Fi owó sí" },
  "home.transfer":          { en: "Transfer",        pidgin: "Transfer",        ha: "Tura",           ig: "Zipu",                  yo: "Fi ránṣẹ́" },
  "home.receive":           { en: "Receive",         pidgin: "Receive",         ha: "Karɓa",          ig: "Nata",                  yo: "Gbà" },
  "home.waitingFor":        { en: "Waiting for {amount}", pidgin: "Dey wait for {amount}", ha: "Ana jiran {amount}", ig: "Na-eche {amount}", yo: "Ń dúró de {amount}" },
  "home.todaysSales":       { en: "TODAY'S SALES",   pidgin: "TODAY SALES",     ha: "TALLACEN YAU",   ig: "AHỊA TAA",              yo: "TÍTÀ ÒNÍ" },
  "home.in":                { en: "in",              pidgin: "enter",           ha: "shiga",          ig: "batara",                yo: "wọlé" },
  "home.out":               { en: "out",             pidgin: "comot",           ha: "fita",           ig: "pụrụ",                  yo: "jáde" },
  "home.txnCountOne":       { en: "{n} txn",         pidgin: "{n} deal",        ha: "ma'amala {n}",   ig: "azụmaahịa {n}",         yo: "ìdúnàádúrà {n}" },
  "home.txnCountMany":      { en: "{n} txns",        pidgin: "{n} deals",       ha: "ma'amaloli {n}", ig: "azụmaahịa {n}",         yo: "ìdúnàádúrà {n}" },

  /* ── Wallet activity / profit card ── */
  "home.recentActivity":    { en: "Recent activity", pidgin: "Wetin happen recently", ha: "Ayyukan kwanan nan", ig: "Ihe mere n'oge na-adịbeghị anya", yo: "Ìṣẹ̀lẹ̀ àìpẹ́" },
  "home.noWalletActivity":  { en: "No wallet activity yet.", pidgin: "Nothing don happen for wallet yet.", ha: "Babu wani aiki a walat tukuna.", ig: "Ọ dịbeghị ihe mere na walet.", yo: "Kò sí ìṣẹ̀lẹ̀ wọ́lẹ́ẹ̀tì síbẹ̀." },
  "home.todaysDeficit":     { en: "Today's Deficit", pidgin: "Today Loss",      ha: "Gibin Yau",      ig: "Mfu Taa",               yo: "Àdánù Òní" },
  "home.breakEven":         { en: "Break Even",      pidgin: "No gain, no loss", ha: "Babu riba, babu faɗuwa", ig: "Enweghị uru, enweghị mfu", yo: "Kò sí èrè, kò sí àdánù" },
  "home.expensesAmount":    { en: "Expenses: {amount}", pidgin: "Expenses: {amount}", ha: "Kashe-kashe: {amount}", ig: "Mmefu: {amount}", yo: "Ìnáwó: {amount}" },
  "home.collectedToday":    { en: "{amount} collected today", pidgin: "{amount} wey we collect today", ha: "An karɓi {amount} yau", ig: "Anakọtara {amount} taa", yo: "A gba {amount} lónìí" },

  /* ── Stat strip ── */
  "home.thisWeek":          { en: "This Week",       pidgin: "This Week",       ha: "Wannan Mako",    ig: "Izu a",                 yo: "Ọ̀sẹ̀ Yìí" },
  "home.outstanding":       { en: "Outstanding",     pidgin: "Still dey owe",   ha: "Saura",          ig: "Fọdụrụ",                yo: "Tó kù" },
  "home.held":              { en: "Held",            pidgin: "Wey we hold",     ha: "A riƙe",         ig: "Ejidere",               yo: "Tí a mú" },

  /* ── Quick actions / services ── */
  "home.recordSale":        { en: "Record Sale",     pidgin: "Record Sale",     ha: "Rubuta Siyarwa", ig: "Dekọọ Ire",             yo: "Kọ Títà Sílẹ̀" },
  "home.newInvoice":        { en: "New Invoice",     pidgin: "New Invoice",     ha: "Sabuwar Takardar Kuɗi", ig: "Akwụkwọ Ụgwọ Ọhụrụ", yo: "Ìwé-owó Tuntun" },
  "home.receivePayment":    { en: "Receive Payment", pidgin: "Collect Payment", ha: "Karɓi Biya",     ig: "Nata Ụgwọ",             yo: "Gba Owó" },
  "home.quickServices":     { en: "Quick Services",  pidgin: "Quick Services",  ha: "Ayyuka Masu Sauri", ig: "Ọrụ Ngwa Ngwa",       yo: "Iṣẹ́ Kíákíá" },
  "home.seeAllShort":       { en: "See all",         pidgin: "See all",         ha: "Duba duka",      ig: "Hụ ha niile",           yo: "Wo gbogbo" },

  /* ── KudiAI assistant entry ── */
  "home.aiTipTitle":        { en: "Ask me anything about your business", pidgin: "Ask me anything about your business", ha: "Tambaye ni komai game da kasuwancinka", ig: "Jụọ m ihe ọ bụla gbasara azụmahịa gị", yo: "Bi mí ní ohunkóhun nípa òwò rẹ" },
  "home.aiTipLangs":        { en: "I speak English, Pidgin, Hausa, Igbo & Yoruba", pidgin: "I dey speak English, Pidgin, Hausa, Igbo & Yoruba", ha: "Ina magana da Turanci, Pidgin, Hausa, Igbo da Yarbanci", ig: "Ana m asụ Bekee, Pidgin, Hausa, Igbo na Yoruba", yo: "Mo ń sọ Gẹ̀ẹ́sì, Pidgin, Hausa, Igbo àti Yorùbá" },
  "home.dismiss":           { en: "Dismiss",         pidgin: "Comot am",        ha: "Rufe",           ig: "Wepụ",                  yo: "Yọ ọ́ kúrò" },
  "home.aiAssistant":       { en: "KudiAI Assistant", pidgin: "KudiAI Assistant", ha: "Mataimakin KudiAI", ig: "Onye Enyemaka KudiAI", yo: "Olùrànlọ́wọ́ KudiAI" },
  "home.aiAssistantSub":    { en: "Ask anything · sales, credit, stock, ajo", pidgin: "Ask anything · sales, credit, stock, ajo", ha: "Tambayi komai · tallace, bashi, kaya, ajo", ig: "Jụọ ihe ọ bụla · ahịa, ụgwọ, ngwaahịa, ajo", yo: "Béèrè ohunkóhun · títà, gbèsè, ọjà, àjọ" },

  /* ── Recent transactions / search ── */
  "home.searchPlaceholder": { en: "Search transactions, items, customers…", pidgin: "Search deals, items, customers…", ha: "Bincika ma'amaloli, kayayyaki, abokan ciniki…", ig: "Chọọ azụmaahịa, ngwaahịa, ndị ahịa…", yo: "Wá ìdúnàádúrà, ọjà, oníbàárà…" },
  "home.resultsFor":        { en: "Results for \"{q}\"", pidgin: "Wetin we see for \"{q}\"", ha: "Sakamakon \"{q}\"", ig: "Nsonaazụ maka \"{q}\"", yo: "Àbájáde fún \"{q}\"" },
  "home.noTxnsFound":       { en: "No transactions found", pidgin: "We no see any deal", ha: "Ba a sami ma'amala ba", ig: "Ahụghị azụmaahịa ọ bụla", yo: "A kò rí ìdúnàádúrà kankan" },
  "home.tryDifferentTerm":  { en: "Try a different search term", pidgin: "Try search another word", ha: "Gwada wata kalmar bincike", ig: "Nwaa okwu ọchụchọ ọzọ", yo: "Gbìyànjú ọ̀rọ̀ ìwádìí mìíràn" },
  "home.firstSaleHint":     { en: "Record your first sale and watch this space come alive", pidgin: "Record your first sale make this place come alive", ha: "Rubuta siyarwarka ta farko ka ga wannan wuri ya rayu", ig: "Dekọọ ire mbụ gị ma hụ ka ebe a si dị ndụ", yo: "Kọ títà àkọ́kọ́ rẹ sílẹ̀ kí o rí i bí ibí yìí ṣe máa kún fún ìyè" },
  "home.recordFirstSale":   { en: "Record First Sale", pidgin: "Record First Sale", ha: "Rubuta Siyarwa ta Farko", ig: "Dekọọ Ire Mbụ", yo: "Kọ Títà Àkọ́kọ́ Sílẹ̀" },
  "home.offersForYou":      { en: "Offers for You",  pidgin: "Offers for You",  ha: "Tayi a Gare Ka", ig: "Onyinye Maka Gị",       yo: "Àwọn Ìfilọ̀ fún Ọ" },

  /* ── Profile completion banner (free plan) ── */
  "home.profileStarting":   { en: "Your profile is just getting started", pidgin: "Your profile just dey start", ha: "Bayananka sun fara ne kawai", ig: "Profaịlụ gị ka na-amalite", yo: "Àkọsílẹ̀ rẹ ṣẹ̀ṣẹ̀ ń bẹ̀rẹ̀ ni" },
  "home.profileGoodProgress": { en: "Good progress — keep going!", pidgin: "You dey try — no stop!", ha: "Ci gaba mai kyau — ka ci gaba!", ig: "Ọganihu dị mma — gaa n'ihu!", yo: "Ìtẹ̀síwájú tó dára — máa bá a lọ!" },
  "home.profileAlmostThere": { en: "Almost there — finish your profile", pidgin: "E don almost reach — finish your profile", ha: "Kusan an gama — kammala bayananka", ig: "Ọ fọrọ obere — mechaa profaịlụ gị", yo: "Ó kù díẹ̀ — parí àkọsílẹ̀ rẹ" },
  "home.fieldsLeftOne":     { en: "{n} field left · Tap to complete", pidgin: "{n} box remain · Tap make you finish", ha: "Saura fili {n} · Taɓa don kammalawa", ig: "Ohere {n} fọdụrụ · Pịa ka ị mechaa", yo: "Àlàfo {n} ló kù · Tẹ̀ láti parí" },
  "home.fieldsLeftMany":    { en: "{n} fields left · Tap to complete", pidgin: "{n} boxes remain · Tap make you finish", ha: "Saura filaye {n} · Taɓa don kammalawa", ig: "Ohere {n} fọdụrụ · Pịa ka ị mechaa", yo: "Àlàfo {n} ló kù · Tẹ̀ láti parí" },
  "home.dismiss3Days":      { en: "Dismiss for 3 days", pidgin: "Hide am for 3 days", ha: "Ɓoye na kwana 3", ig: "Zoo ya ruo ụbọchị 3", yo: "Fi pamọ́ fún ọjọ́ 3" },

  /* ── Paid-plan compliance banner ── */
  "home.paidTitle":         { en: "Complete your profile to keep your plan active", pidgin: "Finish your profile make your plan still dey work", ha: "Kammala bayananka don shirinka ya ci gaba da aiki", ig: "Mechaa profaịlụ gị ka atụmatụ gị nọgide na-arụ ọrụ", yo: "Parí àkọsílẹ̀ rẹ kí ètò rẹ lè máa ṣiṣẹ́" },
  "home.daysLeftShort":     { en: "{n}d left",       pidgin: "{n} days remain", ha: "Saura kwana {n}", ig: "Ụbọchị {n} fọdụrụ",    yo: "Ọjọ́ {n} ló kù" },
  "home.featuresRestricted": { en: "Features restricted", pidgin: "Some features don lock", ha: "An taƙaita wasu ayyuka", ig: "Egbochiri ụfọdụ atụmatụ", yo: "A ti dí àwọn ẹ̀yà kan" },
  "home.paidUrgentBody":    { en: "Some premium features are restricted until your profile is complete. Core transactions, savings, and bills are always available.", pidgin: "Some premium features don lock until you finish your profile. Your main deals, savings and bills go still dey work anytime.", ha: "An taƙaita wasu ayyukan premium har sai ka kammala bayananka. Muhimman ma'amaloli, ajiya da biyan kuɗi suna nan koyaushe.", ig: "Egbochiri ụfọdụ atụmatụ premium ruo mgbe ị mechara profaịlụ gị. Azụmaahịa bụ isi, nchekwa ego na ịkwụ ụgwọ bịl dị mgbe niile.", yo: "A ti dí àwọn ẹ̀yà premium kan títí o fi máa parí àkọsílẹ̀ rẹ. Ìdúnàádúrà pàtàkì, ìfowópamọ́ àti ìsanwó bílù wà nígbà gbogbo." },
  "home.paidGraceOne":      { en: "You have {n} day to complete your profile. Verified identity is required for your plan.", pidgin: "You get {n} day to finish your profile. Your plan need verified ID.", ha: "Kana da kwana {n} don kammala bayananka. Ana buƙatar tabbataccen shaida don shirinka.", ig: "Ị nwere ụbọchị {n} imecha profaịlụ gị. Atụmatụ gị chọrọ njirimara akwadoro.", yo: "O ní ọjọ́ {n} láti parí àkọsílẹ̀ rẹ. Ètò rẹ nílò ìdánimọ̀ tí a ti fìdí rẹ̀ múlẹ̀." },
  "home.paidGraceMany":     { en: "You have {n} days to complete your profile. Verified identity is required for your plan.", pidgin: "You get {n} days to finish your profile. Your plan need verified ID.", ha: "Kana da kwanaki {n} don kammala bayananka. Ana buƙatar tabbataccen shaida don shirinka.", ig: "Ị nwere ụbọchị {n} imecha profaịlụ gị. Atụmatụ gị chọrọ njirimara akwadoro.", yo: "O ní ọjọ́ {n} láti parí àkọsílẹ̀ rẹ. Ètò rẹ nílò ìdánimọ̀ tí a ti fìdí rẹ̀ múlẹ̀." },
  "home.groupPersonal":     { en: "Personal details", pidgin: "Your personal details", ha: "Bayanan kai", ig: "Nkọwa onwe", yo: "Àlàyé ara ẹni" },
  "home.groupBusiness":     { en: "Business details", pidgin: "Business details", ha: "Bayanan kasuwanci", ig: "Nkọwa azụmahịa", yo: "Àlàyé òwò" },
  "home.groupLocation":     { en: "Business location", pidgin: "Where your business dey", ha: "Wurin kasuwanci", ig: "Ebe azụmahịa dị", yo: "Ibi tí òwò wà" },
  "home.groupSettlement":   { en: "Settlement account", pidgin: "Settlement account", ha: "Asusun karɓar kuɗi", ig: "Akaụntụ nnata ego", yo: "Àkáǹtì ìgbowó" },
  "home.groupVerification": { en: "Verification",    pidgin: "Verification",    ha: "Tabbatarwa",     ig: "Nkwenye",               yo: "Ìfìdímúlẹ̀" },
  "home.completeProfile":   { en: "Complete profile", pidgin: "Finish profile", ha: "Kammala bayanai", ig: "Mechaa profaịlụ",      yo: "Parí àkọsílẹ̀" },
  "home.verifyId":          { en: "Verify ID",       pidgin: "Verify ID",       ha: "Tabbatar da shaida", ig: "Nyochaa njirimara", yo: "Fìdí ìdánimọ̀ múlẹ̀" },
  "home.settlement":        { en: "Settlement",      pidgin: "Settlement",      ha: "Karɓar kuɗi",    ig: "Nnata ego",             yo: "Ìgbowó" },

  /* ── KudiAI daily brief ── */
  "home.briefTitle":        { en: "KudiAI Daily Brief", pidgin: "KudiAI Daily Gist", ha: "Taƙaitaccen Bayanin Yau na KudiAI", ig: "Nchịkọta Ụbọchị KudiAI", yo: "Àkópọ̀ Ojoojúmọ́ KudiAI" },
  "home.briefSpeaking":     { en: "Speaking…",       pidgin: "E dey talk…",     ha: "Ana magana…",    ig: "Ọ na-ekwu…",            yo: "Ó ń sọ̀rọ̀…" },
  "home.briefGenerating":   { en: "Generating…",     pidgin: "E dey prepare…",  ha: "Ana shiryawa…",  ig: "Ọ na-akwado…",          yo: "Ó ń pèsè…" },
  "home.briefSummary":      { en: "Your daily summary", pidgin: "Your summary for today", ha: "Taƙaitawarka ta yau", ig: "Nchịkọta gị nke ụbọchị", yo: "Àkópọ̀ ojoojúmọ́ rẹ" },
  "home.briefListenAgain":  { en: "Listen again",    pidgin: "Hear am again",   ha: "Sake saurara",   ig: "Gee ntị ọzọ",           yo: "Tún gbọ́ ọ" },
  "home.briefGeneratingLong": { en: "Generating your brief…", pidgin: "E dey prepare your gist…", ha: "Ana shirya taƙaitawarka…", ig: "Ọ na-akwado nchịkọta gị…", yo: "Ó ń pèsè àkópọ̀ rẹ…" },
  "home.briefTapToHear":    { en: "Tap to hear",     pidgin: "Tap make you hear", ha: "Taɓa don ji",  ig: "Pịa ka ị nụ",           yo: "Tẹ̀ láti gbọ́" },
  "home.briefFallback":     { en: "Your numbers look good — keep the momentum going today!", pidgin: "Your numbers fine well well — keep am up today!", ha: "Lambobinka suna da kyau — ci gaba da ƙoƙari yau!", ig: "Ọnụọgụ gị dị mma — gaa n'ihu taa!", yo: "Àwọn nọ́ńbà rẹ dára — máa bá a lọ lónìí!" },
};

export default T;
