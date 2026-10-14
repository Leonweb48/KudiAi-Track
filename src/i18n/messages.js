// messages — text built by shared helpers outside any screen: plan labels (utils/plans.js), the "last synced" time
// (utils/offlineCache.js) and plain-language error messages (utils/errorMessages.js). Keys: "msg.<name>".
const T = {
  // utils/plans.js
  "msg.plan.upgrade":          { en: "Upgrade Plan", pidgin: "Upgrade Plan", ha: "Haɓaka Tsari", ig: "Kwalite Atụmatụ", yo: "Gbé Ètò Sókè" },
  "msg.plan.upgradeTo":        { en: "Upgrade to {name} — {price}", pidgin: "Upgrade go {name} — {price}", ha: "Haɓaka zuwa {name} — {price}", ig: "Kwalite gaa {name} — {price}", yo: "Gbé e sókè sí {name} — {price}" },
  "msg.plan.perMonth":         { en: "{amount}/mo", pidgin: "{amount}/month", ha: "{amount}/wata", ig: "{amount}/ọnwa", yo: "{amount}/oṣù" },
  "msg.plan.free":             { en: "Free", pidgin: "Free", ha: "Kyauta", ig: "N'efu", yo: "Ọ̀fẹ́" },
  "msg.plan.notIncluded":      { en: "Not included in your plan", pidgin: "E no dey your plan", ha: "Ba ya cikin tsarinka", ig: "Ọ nọghị n'atụmatụ gị", yo: "Kò sí nínú ètò rẹ" },
  "msg.plan.required":         { en: "{name} Plan Required", pidgin: "You need {name} Plan", ha: "Ana bukatar Tsarin {name}", ig: "Achọrọ Atụmatụ {name}", yo: "Ètò {name} ni a nílò" },
  "msg.plan.upgradeRequired":  { en: "Upgrade Required", pidgin: "You need to upgrade", ha: "Ana bukatar haɓakawa", ig: "Achọrọ ịkwalite", yo: "O nílò láti gbé e sókè" },
  "msg.plan.notInCurrent":     { en: "This feature is not included in your current plan.", pidgin: "This feature no dey your current plan.", ha: "Wannan fasalin ba ya cikin tsarinka na yanzu.", ig: "Akụkụ a anọghị n'atụmatụ gị ugbu a.", yo: "Ẹ̀yà yìí kò sí nínú ètò rẹ lọ́wọ́lọ́wọ́." },
  "msg.plan.availableOn":      { en: "Available on the {name} plan and above.", pidgin: "E dey for {name} plan and the ones wey pass am.", ha: "Akwai shi a tsarin {name} da sama.", ig: "Ọ dị n'atụmatụ {name} na ndị karịrị ya.", yo: "Ó wà lórí ètò {name} àti èyí tó ga jù bẹ́ẹ̀ lọ." },
  "msg.plan.upgradeToAccess":  { en: "Upgrade to access this feature.", pidgin: "Upgrade make you fit use this feature.", ha: "Haɓaka don samun wannan fasalin.", ig: "Kwalite ka i nweta akụkụ a.", yo: "Gbé e sókè láti lo ẹ̀yà yìí." },

  // utils/offlineCache.js
  "msg.sync.yesterday":        { en: "yesterday {time}", pidgin: "yesterday {time}", ha: "jiya {time}", ig: "ụnyahụ {time}", yo: "àná {time}" },

  // utils/errorMessages.js
  "msg.err.generic":           { en: "Something went wrong — please try again.", pidgin: "Something no work well — abeg try again.", ha: "Wani abu ya faru ba daidai ba — da fatan a sake gwadawa.", ig: "Ihe adịghị mma mere — biko nwaa ọzọ.", yo: "Nǹkan kan kò lọ dáadáa — jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan sí i." },
  "msg.err.network":           { en: "Check your connection and try again.", pidgin: "Check your network and try again.", ha: "Duba haɗin intanet ɗinka ka sake gwadawa.", ig: "Lelee njikọ gị ma nwaa ọzọ.", yo: "Ṣàyẹ̀wò ìsopọ̀ rẹ kí o sì gbìyànjú lẹ́ẹ̀kan sí i." },
  "msg.err.paymentNotConfirmed": { en: "Payment wasn't confirmed — your balance was not affected. Tap Retry if you completed the payment.", pidgin: "Payment no confirm — dem no touch your balance. Tap Retry if you don pay finish.", ha: "Ba a tabbatar da biyan ba — ba a taɓa ma'aunin kuɗinka ba. Danna Sake gwadawa idan ka kammala biyan.", ig: "Akwadoghị ịkwụ ụgwọ — emetụghị ego gị aka. Pịa Nwaa ọzọ ma ọ bụrụ na i kwụchaala ụgwọ.", yo: "A kò fìdí ìsanwó múlẹ̀ — owó rẹ kò yí padà. Tẹ Gbìyànjú lẹ́ẹ̀kan sí i tí o bá ti san án tán." },
  "msg.err.paymentNotStarted": { en: "Payment couldn't be started — please try again.", pidgin: "Payment no fit start — abeg try again.", ha: "Ba a iya fara biyan ba — da fatan a sake gwadawa.", ig: "Enweghị ike ịmalite ịkwụ ụgwọ — biko nwaa ọzọ.", yo: "A kò lè bẹ̀rẹ̀ ìsanwó — jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan sí i." },
  "msg.err.clientNotFound":    { en: "We couldn't find your account — please sign out and sign back in.", pidgin: "We no see your account — abeg sign out come sign in again.", ha: "Ba mu sami asusunka ba — da fatan ka fita ka sake shiga.", ig: "Anyị ahụghị akaụntụ gị — biko pụọ ma banye ọzọ.", yo: "A kò rí àkáǹtì rẹ — jọ̀wọ́ jáde kí o sì wọlé padà." },
  "msg.err.noEmail":           { en: "You don't have an email on file — ask your savings agent to add one.", pidgin: "You no get email for your account — tell your savings agent make e add one.", ha: "Ba ka da imel a rajista — ka roƙi wakilin ajiyarka ya ƙara ɗaya.", ig: "Ị nweghị email edebere — gwa onye na-elekọta nchekwa gị ka o tinye otu.", yo: "O kò ní ímeèlì nínú àkọsílẹ̀ — sọ fún aṣojú ìfipamọ́ rẹ kí ó fi ọ̀kan kún un." },
  "msg.err.insufficient":      { en: "You don't have enough balance for this amount.", pidgin: "Your balance no reach for this amount.", ha: "Ba ka da isasshen kuɗi don wannan adadin.", ig: "Ego gị ezughị maka ego a.", yo: "Owó rẹ kò tó fún iye yìí." },
  "msg.err.tooSmallAfterFee":  { en: "The amount is too small — the fee would use it all up.", pidgin: "The amount too small — the fee go chop am finish.", ha: "Adadin ya yi ƙanƙanta — kuɗin caji zai cinye shi duka.", ig: "Ego a pere mpe — ụgwọ ọrụ ga-eri ya niile.", yo: "Iye náà kéré jù — owó iṣẹ́ yóò jẹ gbogbo rẹ̀ tán." },
  "msg.err.enterAmount":       { en: "Enter an amount to continue.", pidgin: "Put amount to continue.", ha: "Shigar da adadi don ci gaba.", ig: "Tinye ego ka i gaa n'ihu.", yo: "Tẹ iye owó sí i láti tẹ̀síwájú." },
  "msg.err.amountAboveZero":   { en: "Enter an amount greater than zero.", pidgin: "Put amount wey pass zero.", ha: "Shigar da adadin da ya fi sifili.", ig: "Tinye ego karịrị efu.", yo: "Tẹ iye tó ju òdo lọ." },
  "msg.err.pin4":              { en: "Your PIN must be exactly 4 digits.", pidgin: "Your PIN must be 4 numbers exactly.", ha: "PIN ɗinka dole ya zama lambobi 4 daidai.", ig: "PIN gị ga-abụrịrị ọnụọgụ 4 kpọmkwem.", yo: "PIN rẹ gbọ́dọ̀ jẹ́ nọ́ńbà mẹ́rin gẹ́lẹ́." },
  "msg.err.pinWrong":          { en: "Incorrect PIN — try again.", pidgin: "PIN no correct — try again.", ha: "PIN ba daidai ba ne — sake gwadawa.", ig: "PIN ezighi ezi — nwaa ọzọ.", yo: "PIN kò tọ̀nà — gbìyànjú lẹ́ẹ̀kan sí i." },
  "msg.err.pinCurrentWrong":   { en: "That PIN isn't right — try again.", pidgin: "That PIN no correct — try again.", ha: "Wannan PIN ba daidai ba ne — sake gwadawa.", ig: "PIN ahụ ezighi ezi — nwaa ọzọ.", yo: "PIN yẹn kò tọ̀nà — gbìyànjú lẹ́ẹ̀kan sí i." },
  "msg.err.otpWrong":          { en: "That code isn't right — check and try again.", pidgin: "That code no correct — check am and try again.", ha: "Wannan lambar ba daidai ba ce — duba ka sake gwadawa.", ig: "Koodu ahụ ezighi ezi — lelee ma nwaa ọzọ.", yo: "Kóòdù yẹn kò tọ̀nà — ṣàyẹ̀wò kí o sì gbìyànjú lẹ́ẹ̀kan sí i." },
  "msg.err.otpExpired":        { en: "This code has expired — tap Resend to get a new one.", pidgin: "This code don expire — tap Resend make you get new one.", ha: "Wannan lambar ta ƙare — danna Sake aikawa don samun sabuwa.", ig: "Koodu a agwụla — pịa Zigharịa ka i nweta nke ọhụrụ.", yo: "Kóòdù yìí ti parí — tẹ Fi ránṣẹ́ lẹ́ẹ̀kan sí i láti gba tuntun." },
  "msg.err.password8":         { en: "Password must be at least 8 characters.", pidgin: "Password must reach at least 8 characters.", ha: "Kalmar sirri dole ta kai haruffa 8 aƙalla.", ig: "Okwuntughe ga-enwerịrị opekata mpe mkpụrụedemede 8.", yo: "Ọ̀rọ̀ aṣínà gbọ́dọ̀ ní ó kéré tán lẹ́tà mẹ́jọ." },
  "msg.err.sessionExpired":    { en: "Your session has expired — please sign out and sign back in.", pidgin: "Your session don expire — abeg sign out come sign in again.", ha: "Zamanka ya ƙare — da fatan ka fita ka sake shiga.", ig: "Oge nnọkọ gị agwụla — biko pụọ ma banye ọzọ.", yo: "Ìgbà ìwọlé rẹ ti parí — jọ̀wọ́ jáde kí o sì wọlé padà." },
  "msg.err.waitMoment":        { en: "Please wait a moment before trying again.", pidgin: "Abeg wait small before you try again.", ha: "Da fatan ka jira ɗan lokaci kafin ka sake gwadawa.", ig: "Biko chere ntakịrị tupu i nwaa ọzọ.", yo: "Jọ̀wọ́ dúró díẹ̀ kí o tó gbìyànjú lẹ́ẹ̀kan sí i." },
  // Co-op broadcast form labels (CoopDashboard) that had no text and showed the raw key
  "bcast.contentField":        { en: "Message", pidgin: "Message", ha: "Saƙo", ig: "Ozi", yo: "Ìfiránṣẹ́" },
  "bcast.eventType":           { en: "Event type", pidgin: "Event type", ha: "Nau'in taron", ig: "Ụdị ememe", yo: "Irú ìṣẹ̀lẹ̀" },
  "bcast.descField":           { en: "Description", pidgin: "Description", ha: "Bayani", ig: "Nkọwa", yo: "Àpèjúwe" },

  "msg.err.balanceSafe":      { en: "Your balance was not affected.", pidgin: "Dem no touch your balance.", ha: "Ba a taɓa ma'aunin kuɗinka ba.", ig: "Emetụghị ego gị aka.", yo: "Owó rẹ kò yí padà." },
};

export default T;
