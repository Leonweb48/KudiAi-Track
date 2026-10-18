// planend — owner plan ending / grace banner and the Renew button (plans don't renew by themselves; 3-day grace, then Free).
// Keys: "planend.<name>": { en, pidgin, ha, ig, yo }. {plan} {date} placeholders. Native-speaker review pending for ha/ig/yo.
const T = {
  "planend.endsSoon":  { en: "Your {plan} plan ends on {date}.", pidgin: "Your {plan} plan go end for {date}.", ha: "Shirin {plan} naka zai ƙare a {date}.", ig: "Atụmatụ {plan} gị ga-agwụ na {date}.", yo: "Ètò {plan} rẹ yóò parí ní {date}." },
  "planend.ended":     { en: "Your {plan} plan has ended. Renew by {date} to keep its features.", pidgin: "Your {plan} plan don end. Renew before {date} make you no lose the features.", ha: "Shirin {plan} naka ya ƙare. Sabunta kafin {date} don ka riƙe fasalolinsa.", ig: "Atụmatụ {plan} gị agwụla. Megharịa tupu {date} ka ị jigide atụmatụ ya.", yo: "Ètò {plan} rẹ ti parí. Sọ ọ́ dọ̀tun kí {date} tó dé kí o má pàdánù àwọn ẹ̀yà rẹ̀." },
  "planend.renew":     { en: "Renew", pidgin: "Renew", ha: "Sabunta", ig: "Megharịa", yo: "Sọ dọ̀tun" },
  "planend.renewWeb":  { en: "Renew on kudiai.app", pidgin: "Renew for kudiai.app", ha: "Sabunta a kudiai.app", ig: "Megharịa na kudiai.app", yo: "Sọ dọ̀tun lórí kudiai.app" },
  "planend.renewPlan": { en: "Renew {plan}", pidgin: "Renew {plan}", ha: "Sabunta {plan}", ig: "Megharịa {plan}", yo: "Sọ {plan} dọ̀tun" },
  "planend.renewHint": { en: "Plans don't renew by themselves. Renewing early adds the new period after your current end date — you don't lose any days.", pidgin: "Plan no dey renew by im self. If you renew early, the new time go start after your current end date — you no go lose any day.", ha: "Shirye-shirye ba sa sabuntuwa da kansu. Idan ka sabunta da wuri, sabon lokaci zai fara bayan ranar ƙarewar yanzu — ba za ka rasa kowace rana ba.", ig: "Atụmatụ anaghị emegharị onwe ya. Ọ bụrụ na ị megharịa n'oge, oge ọhụrụ ga-amalite mgbe ụbọchị njedebe gị ugbu a gasịrị — ị gaghị atụfu ụbọchị ọ bụla.", yo: "Ètò kì í sọ ara rẹ̀ dọ̀tun. Tí o bá sọ ọ́ dọ̀tun ní kùtùkùtù, àkókò tuntun á bẹ̀rẹ̀ lẹ́yìn ọjọ́ ìparí rẹ — o kò ní pàdánù ọjọ́ kankan." },
};
export default T;
