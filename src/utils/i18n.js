/* ── Language configuration ──────────────────────────────────────── */
export const LANGUAGES = [
  { code: "en",     name: "English",          native: "English",   flag: "🇬🇧" },
  { code: "pidgin", name: "Nigerian Pidgin",   native: "Naija",     flag: "🇳🇬" },
  { code: "ha",     name: "Hausa",             native: "Hausa",     flag: "🇳🇬" },
  { code: "ig",     name: "Igbo",              native: "Igbo",      flag: "🇳🇬" },
  { code: "yo",     name: "Yoruba",            native: "Yorùbá",    flag: "🇳🇬" },
];

export const getLang  = () => localStorage.getItem("kt_language") || "en";
export const setLang  = (code) => localStorage.setItem("kt_language", code);
export const getLangMeta = (code) => LANGUAGES.find(l => l.code === code) || LANGUAGES[0];

/* ── Language detection from user's typed text ───────────────────── */
export function detectLanguage(text) {
  const t = (text || "").toLowerCase();

  // Pidgin — common Nigerian Pidgin words
  if (/\b(wetin|wey\b|na\b|abeg|oga\b|dey\b|don\b|sef\b|wahala|comot|sabi|joor|tey|chop|abi\b|sha\b|plenty|ginger|carry go|no be|e go|e don)\b/.test(t))
    return "pidgin";

  // Hausa — common Hausa business words
  if (/\b(nawa|yaya\b|yadda|kuɗi|kudi|tallace|kasuwanci|riba|bashi|kaya\b|yau\b|abokin|abokan|wa\b|ko\b|da\b|mai\b|yaushe|nawa ne|adadin)\b/.test(t))
    return "ha";

  // Igbo — common Igbo words
  if (/\b(ego\b|ahịa|ahia|uru\b|ugwọ|ugwo|azụmaahịa|azumaahia|ndị|ndi\b|taa\b|ole\b|gịnị|ginị|ọ\b|maka\b|site\b|ihe\b|onye\b|ngwaahịa|ngwaahia)\b/.test(t))
    return "ig";

  // Yoruba — common Yoruba words
  if (/\b(owo\b|oja\b|ere\b|inawo|gbese|isowo|oni\b|bawo|kini\b|melo|jowo|dupe|beeni|beko|pelu|tita\b|wọlé|woле|àwọn|awon\b)\b/.test(t))
    return "yo";

  return null; // unknown — caller uses stored preference
}

/* ── Number formatting (shared across all languages) ────────────── */
export const fmtN = (n) => "₦" + Math.round(n || 0).toLocaleString();

/* ── AI Response templates — one per intent × language ──────────── */

export const R = {

  /* ─ TODAY'S SALES ─ */
  todaySales: {
    en: ({ revenue, expense, profit, sales, outs, top, lastDate }) => {
      if (!sales.length && !outs.length)
        return `No activity recorded today yet.\n\nYour last transaction was on ${lastDate}. Tap Cash In to start logging today's sales.`;
      return (
        `Today's business summary:\n\n` +
        `• Revenue: **${fmtN(revenue)}** from ${sales.length} sale${sales.length !== 1 ? "s" : ""}\n` +
        `• Expenses: **${fmtN(expense)}**\n` +
        `• Net profit: **${fmtN(profit)}**` +
        (top.length ? `\n\nTop sales today:\n${top.map(t => `• ${t.item_name}: ${fmtN(t.amount)}`).join("\n")}` : "")
      );
    },
    pidgin: ({ revenue, expense, profit, sales, outs, top, lastDate }) => {
      if (!sales.length && !outs.length)
        return `You never record anything for today yet.\n\nYour last transaction na ${lastDate}. Press Cash In make you start record today sales.`;
      return (
        `Today business summary:\n\n` +
        `• Money wey enter: **${fmtN(revenue)}** from ${sales.length} sale${sales.length !== 1 ? "s" : ""}\n` +
        `• Money wey comot: **${fmtN(expense)}**\n` +
        `• Profit for today: **${fmtN(profit)}**` +
        (top.length ? `\n\nBig sales today:\n${top.map(t => `• ${t.item_name}: ${fmtN(t.amount)}`).join("\n")}` : "")
      );
    },
    ha: ({ revenue, expense, profit, sales, outs, top, lastDate }) => {
      if (!sales.length && !outs.length)
        return `Ba a rikodin komai yau ba tukuna.\n\nTallacen ƙarshe naku na ${lastDate}. Danna "Cash In" don fara rubuta tallacen yau.`;
      return (
        `Taƙaitaccen kasuwancin yau:\n\n` +
        `• Kuɗin shiga: **${fmtN(revenue)}** daga tallace ${sales.length}\n` +
        `• Kashe-kashe: **${fmtN(expense)}**\n` +
        `• Ribar yau: **${fmtN(profit)}**` +
        (top.length ? `\n\nManyan siyarwa yau:\n${top.map(t => `• ${t.item_name}: ${fmtN(t.amount)}`).join("\n")}` : "")
      );
    },
    ig: ({ revenue, expense, profit, sales, outs, top, lastDate }) => {
      if (!sales.length && !outs.length)
        return `Ọ dịghị ihe edere maka taa ọ bụrụ ugbu a.\n\nTransaction ikpeazụ gị bụ ${lastDate}. Pịa "Cash In" iji malite ide ahịa gị nke taa.`;
      return (
        `Nchọpụta azụmaahịa taa:\n\n` +
        `• Ego na-abata: **${fmtN(revenue)}** site na ahịa ${sales.length}\n` +
        `• Ihe ejiri ego: **${fmtN(expense)}**\n` +
        `• Uru taa: **${fmtN(profit)}**` +
        (top.length ? `\n\nAhịa kacha buru ibu taa:\n${top.map(t => `• ${t.item_name}: ${fmtN(t.amount)}`).join("\n")}` : "")
      );
    },
    yo: ({ revenue, expense, profit, sales, outs, top, lastDate }) => {
      if (!sales.length && !outs.length)
        return `Ko si ohun ti a kọ fun oni tó.\n\nÌdúnàádúrà tó gbẹ̀yìn rẹ ni ${lastDate}. Tẹ "Cash In" lati bẹ̀rẹ̀ gbígba akọọlẹ tità òní.`;
      return (
        `Akọọlẹ isowo oni:\n\n` +
        `• Owo to wole: **${fmtN(revenue)}** lati ${sales.length} tita\n` +
        `• Inawo: **${fmtN(expense)}**\n` +
        `• Ere oni: **${fmtN(profit)}**` +
        (top.length ? `\n\nTita to ga julo oni:\n${top.map(t => `• ${t.item_name}: ${fmtN(t.amount)}`).join("\n")}` : "")
      );
    },
  },

  /* ─ TOTAL PROFIT ─ */
  totalProfit: {
    en: ({ allIn, allOut, mIn, mOut, lmIn, pct }) =>
      `Total profit across all records:\n\n` +
      `• **${fmtN(allIn - allOut)}** net profit\n` +
      `• ${fmtN(allIn)} total revenue\n` +
      `• ${fmtN(allOut)} total expenses\n\n` +
      `This month:\n• Revenue: **${fmtN(mIn)}**\n• Expenses: **${fmtN(mOut)}**\n• Profit: **${fmtN(mIn - mOut)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 Up" : "📉 Down"} ${Math.abs(pct)}% vs last month (${fmtN(lmIn)})` : ""),

    pidgin: ({ allIn, allOut, mIn, mOut, lmIn, pct }) =>
      `Total profit for all your records:\n\n` +
      `• **${fmtN(allIn - allOut)}** total profit\n` +
      `• ${fmtN(allIn)} total money wey enter\n` +
      `• ${fmtN(allOut)} total money wey comot\n\n` +
      `This month:\n• Money enter: **${fmtN(mIn)}**\n• Money comot: **${fmtN(mOut)}**\n• Profit: **${fmtN(mIn - mOut)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 E go up" : "📉 E come down"} ${Math.abs(pct)}% compared to last month (${fmtN(lmIn)})` : ""),

    ha: ({ allIn, allOut, mIn, mOut, lmIn, pct }) =>
      `Jimlar riba daga dukkan rikodin:\n\n` +
      `• **${fmtN(allIn - allOut)}** jimlar riba\n` +
      `• ${fmtN(allIn)} jimlar kuɗin shiga\n` +
      `• ${fmtN(allOut)} jimlar kashe-kashe\n\n` +
      `Wannan wata:\n• Kuɗin shiga: **${fmtN(mIn)}**\n• Kashe-kashe: **${fmtN(mOut)}**\n• Riba: **${fmtN(mIn - mOut)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 Ya karu" : "📉 Ya ragu"} ${Math.abs(pct)}% idan aka kwatanta da watan da ya wuce (${fmtN(lmIn)})` : ""),

    ig: ({ allIn, allOut, mIn, mOut, lmIn, pct }) =>
      `Ngụkọta uru n'akwụkwọ niile:\n\n` +
      `• **${fmtN(allIn - allOut)}** ngụkọta uru\n` +
      `• ${fmtN(allIn)} ngụkọta ego na-abata\n` +
      `• ${fmtN(allOut)} ngụkọta ihe ejiri ego\n\n` +
      `Ọnwa a:\n• Ego na-abata: **${fmtN(mIn)}**\n• Ihe ejiri ego: **${fmtN(mOut)}**\n• Uru: **${fmtN(mIn - mOut)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 Ọ rịgo elu" : "📉 Ọ dadata"} ${Math.abs(pct)}% tụnyere ọnwa gara aga (${fmtN(lmIn)})` : ""),

    yo: ({ allIn, allOut, mIn, mOut, lmIn, pct }) =>
      `Apapọ ere ninu gbogbo igbasile:\n\n` +
      `• **${fmtN(allIn - allOut)}** apapọ ere\n` +
      `• ${fmtN(allIn)} apapọ owo to wole\n` +
      `• ${fmtN(allOut)} apapọ inawo\n\n` +
      `Osu yi:\n• Owo to wole: **${fmtN(mIn)}**\n• Inawo: **${fmtN(mOut)}**\n• Ere: **${fmtN(mIn - mOut)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 O pọ si" : "📉 O dinku"} ${Math.abs(pct)}% ni akawe si osu to koja (${fmtN(lmIn)})` : ""),
  },

  /* ─ OUTSTANDING CREDIT ─ */
  credit: {
    en: ({ unpaid, overdue, totalOwed, top3 }) => {
      if (!unpaid.length) return `Great news! No outstanding credit balances. All your customers are fully paid up. 🎉`;
      return (
        `Outstanding credit summary:\n\n` +
        `• Total owed: **${fmtN(totalOwed)}**\n` +
        `• ${unpaid.length} customer${unpaid.length !== 1 ? "s" : ""} with unpaid balances` +
        (overdue.length ? `\n• ⚠️ ${overdue.length} overdue — follow up immediately!` : "") +
        `\n\nHighest balances:\n` + top3.map(c => `• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")
      );
    },
    pidgin: ({ unpaid, overdue, totalOwed, top3 }) => {
      if (!unpaid.length) return `Correct! No outstanding credit. All your customers don pay. 🎉`;
      return (
        `Credit summary:\n\n` +
        `• Total wey dem owe you: **${fmtN(totalOwed)}**\n` +
        `• ${unpaid.length} customer${unpaid.length !== 1 ? "s" : ""} never pay` +
        (overdue.length ? `\n• ⚠️ ${overdue.length} don pass time — follow up sharp sharp!` : "") +
        `\n\nPeople wey owe you most:\n` + top3.map(c => `• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")
      );
    },
    ha: ({ unpaid, overdue, totalOwed, top3 }) => {
      if (!unpaid.length) return `Alhamdulillah! Babu bashin da ya rage. Duk abokan ciniki sun biya. 🎉`;
      return (
        `Taƙaitaccen bashi:\n\n` +
        `• Jimlar da ake bin ku: **${fmtN(totalOwed)}**\n` +
        `• Abokan ciniki ${unpaid.length} ba su biya ba` +
        (overdue.length ? `\n• ⚠️ ${overdue.length} sun wuce lokaci — tuntube su yanzu!` : "") +
        `\n\nManyan masu bin ku:\n` + top3.map(c => `• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")
      );
    },
    ig: ({ unpaid, overdue, totalOwed, top3 }) => {
      if (!unpaid.length) return `Ọ dị mma! Ọ dịghị ugwọ e ji. Ndị ahịa niile akwụọla ọkwa. 🎉`;
      return (
        `Nchọpụta ugwọ:\n\n` +
        `• Ngụkọta ugwọ e ji gị: **${fmtN(totalOwed)}**\n` +
        `• Ndị ahịa ${unpaid.length} akwụbeghị` +
        (overdue.length ? `\n• ⚠️ ${overdue.length} agafeela oge — kpọtụrụ ha ozugbo!` : "") +
        `\n\nNdị ji ego ya karị:\n` + top3.map(c => `• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")
      );
    },
    yo: ({ unpaid, overdue, totalOwed, top3 }) => {
      if (!unpaid.length) return `Iroyin rere! Ko si gbese to wa. Gbogbo onibara ti san. 🎉`;
      return (
        `Akọọlẹ gbese:\n\n` +
        `• Apapọ ti won jẹ gẹ: **${fmtN(totalOwed)}**\n` +
        `• Onibara ${unpaid.length} ko san` +
        (overdue.length ? `\n• ⚠️ ${overdue.length} ti koja akoko — pe won lẹsẹkẹsẹ!` : "") +
        `\n\nAwon ti o jẹ gẹ julo:\n` + top3.map(c => `• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")
      );
    },
  },

  /* ─ TOP CUSTOMERS ─ */
  topCustomers: {
    en: ({ sorted }) => {
      if (!sorted.length) return `No customer records found yet.\n\nTip: Add customer names when recording transactions to track your best buyers.`;
      return `Your top ${sorted.length} customer${sorted.length !== 1 ? "s" : ""} by total spend:\n\n` +
        sorted.map(([name, d], i) => `${i + 1}. **${name}**\n   ${fmtN(d.total)} · ${d.count} purchase${d.count !== 1 ? "s" : ""}`).join("\n\n");
    },
    pidgin: ({ sorted }) => {
      if (!sorted.length) return `No customer record yet.\n\nTip: Add customer name when you dey record transaction make you fit track your best buyers.`;
      return `Your top ${sorted.length} customer${sorted.length !== 1 ? "s" : ""} wey dey buy from you:\n\n` +
        sorted.map(([name, d], i) => `${i + 1}. **${name}**\n   ${fmtN(d.total)} · ${d.count} time${d.count !== 1 ? "s" : ""}`).join("\n\n");
    },
    ha: ({ sorted }) => {
      if (!sorted.length) return `Babu rikodin abokan ciniki tukuna.\n\nTips: Rubuta sunayen abokan ciniki lokacin da kuke rubuta ma'amala don bin manyan masu sayan ku.`;
      return `Manyan abokan ciniki ${sorted.length} ta jimlar kashe:\n\n` +
        sorted.map(([name, d], i) => `${i + 1}. **${name}**\n   ${fmtN(d.total)} · siye ${d.count} sau`).join("\n\n");
    },
    ig: ({ sorted }) => {
      if (!sorted.length) return `Ọ dịghị ndekọ ndị ahịa ọ bụrụ ugbu a.\n\nTip: Tinye aha ndị ahịa mgbe ị na-ede transaction iji soro ndị ahịa kacha mma gị.`;
      return `Ndị ahịa kacha mma ${sorted.length} site na ngụkọta ego ha kwụrụ:\n\n` +
        sorted.map(([name, d], i) => `${i + 1}. **${name}**\n   ${fmtN(d.total)} · zụtara ${d.count} ugboro`).join("\n\n");
    },
    yo: ({ sorted }) => {
      if (!sorted.length) return `Ko si igbasile onibara sibẹ.\n\nTip: Fi oruko onibara kun nigba ti o ba n gba akọọlẹ transaction lati tele awon olura to dara julo.`;
      return `Awon onibara to ga julo ${sorted.length} nipa iye owo won lo:\n\n` +
        sorted.map(([name, d], i) => `${i + 1}. **${name}**\n   ${fmtN(d.total)} · ra ${d.count} igba`).join("\n\n");
    },
  },

  /* ─ STOCK STATUS ─ */
  stock: {
    en: ({ products, out, low, good, costVal, retailVal }) => {
      if (!products.length) return `Your inventory is empty.\n\nGo to the Stock tab to add products and start tracking your items.`;
      return (
        `Stock overview for ${products.length} product${products.length !== 1 ? "s" : ""}:\n\n` +
        (out.length  ? `⛔ Out of stock (${out.length}): ${out.slice(0,3).map(p=>p.product_name).join(", ")}${out.length>3?` +${out.length-3} more`:""}\n` : "") +
        (low.length  ? `⚠️ Running low (${low.length}): ${low.slice(0,3).map(p=>`${p.product_name} (${p.quantity} left)`).join(", ")}\n` : "") +
        (good.length ? `✅ Well stocked: ${good.length} item${good.length !== 1 ? "s" : ""}\n` : "") +
        `\n• Stock cost value: **${fmtN(costVal)}**\n• Retail value: **${fmtN(retailVal)}**`
      );
    },
    pidgin: ({ products, out, low, good, costVal, retailVal }) => {
      if (!products.length) return `Your stock empty.\n\nGo Stock tab make you add products and start track your items.`;
      return (
        `Stock check for ${products.length} product${products.length !== 1 ? "s" : ""}:\n\n` +
        (out.length  ? `⛔ Finish (${out.length}): ${out.slice(0,3).map(p=>p.product_name).join(", ")}${out.length>3?` +${out.length-3} more`:""}\n` : "") +
        (low.length  ? `⚠️ Stock dey low (${low.length}): ${low.slice(0,3).map(p=>`${p.product_name} (${p.quantity} remain)`).join(", ")}\n` : "") +
        (good.length ? `✅ Stock dey fine: ${good.length} item${good.length !== 1 ? "s" : ""}\n` : "") +
        `\n• Cost price value: **${fmtN(costVal)}**\n• Selling price value: **${fmtN(retailVal)}**`
      );
    },
    ha: ({ products, out, low, good, costVal, retailVal }) => {
      if (!products.length) return `Babu kayan ajiya.\n\nJe zuwa shafin Stock don ƙara kaya.`;
      return (
        `Duba kayan ajiya na kaya ${products.length}:\n\n` +
        (out.length  ? `⛔ Kayan da suka kare (${out.length}): ${out.slice(0,3).map(p=>p.product_name).join(", ")}${out.length>3?` +${out.length-3} ƙari`:""}\n` : "") +
        (low.length  ? `⚠️ Kayan da suke ƙarewa (${low.length}): ${low.slice(0,3).map(p=>`${p.product_name} (${p.quantity} ya rage)`).join(", ")}\n` : "") +
        (good.length ? `✅ Kayan da suke da yawa: kaya ${good.length}\n` : "") +
        `\n• Ƙimar farashi: **${fmtN(costVal)}**\n• Ƙimar siyarwa: **${fmtN(retailVal)}**`
      );
    },
    ig: ({ products, out, low, good, costVal, retailVal }) => {
      if (!products.length) return `Ngwaahịa gị dịghị n'ọchịchọ.\n\nGa na shafin Stock iji tinye ngwaahịa.`;
      return (
        `Ntụle ngwaahịa maka ngwaahịa ${products.length}:\n\n` +
        (out.length  ? `⛔ Foputara (${out.length}): ${out.slice(0,3).map(p=>p.product_name).join(", ")}${out.length>3?` +${out.length-3} ọzọ`:""}\n` : "") +
        (low.length  ? `⚠️ Na-acha (${low.length}): ${low.slice(0,3).map(p=>`${p.product_name} (${p.quantity} fọdụrụ)`).join(", ")}\n` : "") +
        (good.length ? `✅ Dị mma: ihe ${good.length}\n` : "") +
        `\n• Uru ọnụahịa ọnụ: **${fmtN(costVal)}**\n• Uru ọnụahịa ire: **${fmtN(retailVal)}**`
      );
    },
    yo: ({ products, out, low, good, costVal, retailVal }) => {
      if (!products.length) return `Ile-oja gẹ ofo.\n\nLọ si tab Stock lati fi awon ọja kun.`;
      return (
        `Akọọlẹ ile-oja fun ọja ${products.length}:\n\n` +
        (out.length  ? `⛔ Ti pari (${out.length}): ${out.slice(0,3).map(p=>p.product_name).join(", ")}${out.length>3?` +${out.length-3} siwaju`:""}\n` : "") +
        (low.length  ? `⚠️ N'isale (${low.length}): ${low.slice(0,3).map(p=>`${p.product_name} (${p.quantity} ku)`).join(", ")}\n` : "") +
        (good.length ? `✅ O pọ to: ọja ${good.length}\n` : "") +
        `\n• Iye owo gbigba: **${fmtN(costVal)}**\n• Iye owo tita: **${fmtN(retailVal)}**`
      );
    },
  },

  /* ─ MONTHLY SALES ─ */
  monthly: {
    en: ({ mSales, mRev, mExp, lmRev, pct }) =>
      `This month's performance:\n\n` +
      `• ${mSales.length} sale${mSales.length !== 1 ? "s" : ""} recorded\n` +
      `• Revenue: **${fmtN(mRev)}**\n• Expenses: **${fmtN(mExp)}**\n• Net profit: **${fmtN(mRev - mExp)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 Up" : "📉 Down"} ${Math.abs(pct)}% vs last month (${fmtN(lmRev)})` : ""),

    pidgin: ({ mSales, mRev, mExp, lmRev, pct }) =>
      `This month business:\n\n` +
      `• ${mSales.length} sale${mSales.length !== 1 ? "s" : ""} wey e record\n` +
      `• Money enter: **${fmtN(mRev)}**\n• Money comot: **${fmtN(mExp)}**\n• Profit: **${fmtN(mRev - mExp)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 E go up" : "📉 E come down"} ${Math.abs(pct)}% compared to last month (${fmtN(lmRev)})` : ""),

    ha: ({ mSales, mRev, mExp, lmRev, pct }) =>
      `Ayyukan kasuwanci na wannan wata:\n\n` +
      `• An rikodin tallace ${mSales.length}\n` +
      `• Kuɗin shiga: **${fmtN(mRev)}**\n• Kashe-kashe: **${fmtN(mExp)}**\n• Riba: **${fmtN(mRev - mExp)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 Ya karu" : "📉 Ya ragu"} ${Math.abs(pct)}% idan aka kwatanta da watan da ya wuce (${fmtN(lmRev)})` : ""),

    ig: ({ mSales, mRev, mExp, lmRev, pct }) =>
      `Ọrụ azụmaahịa ọnwa a:\n\n` +
      `• Edere ahịa ${mSales.length}\n` +
      `• Ego na-abata: **${fmtN(mRev)}**\n• Ihe ejiri ego: **${fmtN(mExp)}**\n• Uru: **${fmtN(mRev - mExp)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 Ọ rịgo elu" : "📉 Ọ dadata"} ${Math.abs(pct)}% tụnyere ọnwa gara aga (${fmtN(lmRev)})` : ""),

    yo: ({ mSales, mRev, mExp, lmRev, pct }) =>
      `Iṣe isowo osu yi:\n\n` +
      `• A gba akọọlẹ tita ${mSales.length}\n` +
      `• Owo to wole: **${fmtN(mRev)}**\n• Inawo: **${fmtN(mExp)}**\n• Ere: **${fmtN(mRev - mExp)}**` +
      (pct !== null ? `\n\n${pct >= 0 ? "📈 O pọ si" : "📉 O dinku"} ${Math.abs(pct)}% ni akawe si osu to koja (${fmtN(lmRev)})` : ""),
  },

  /* ─ EXPENSES ─ */
  expenses: {
    en:     ({ total, mTotal, topCats }) =>
      `Expenses breakdown:\n\n• All-time total: **${fmtN(total)}**\n• This month: **${fmtN(mTotal)}**` +
      (topCats.length ? `\n\nTop categories:\n${topCats.map(([c, a]) => `• ${c}: ${fmtN(a)}`).join("\n")}` : ""),
    pidgin: ({ total, mTotal, topCats }) =>
      `How you dey spend your money:\n\n• Total money wey comot: **${fmtN(total)}**\n• This month: **${fmtN(mTotal)}**` +
      (topCats.length ? `\n\nWhere the money dey go:\n${topCats.map(([c, a]) => `• ${c}: ${fmtN(a)}`).join("\n")}` : ""),
    ha:     ({ total, mTotal, topCats }) =>
      `Duba kashe-kashe:\n\n• Jimlar duka: **${fmtN(total)}**\n• Wannan wata: **${fmtN(mTotal)}**` +
      (topCats.length ? `\n\nManyan rukunoni:\n${topCats.map(([c, a]) => `• ${c}: ${fmtN(a)}`).join("\n")}` : ""),
    ig:     ({ total, mTotal, topCats }) =>
      `Ntọala ihe ejiri ego:\n\n• Ngụkọta niile: **${fmtN(total)}**\n• Ọnwa a: **${fmtN(mTotal)}**` +
      (topCats.length ? `\n\nNdi isi ọ dị n'otu:\n${topCats.map(([c, a]) => `• ${c}: ${fmtN(a)}`).join("\n")}` : ""),
    yo:     ({ total, mTotal, topCats }) =>
      `Akọọlẹ inawo:\n\n• Apapọ gbogbo: **${fmtN(total)}**\n• Osu yi: **${fmtN(mTotal)}**` +
      (topCats.length ? `\n\nAwon ẹka to ga julo:\n${topCats.map(([c, a]) => `• ${c}: ${fmtN(a)}`).join("\n")}` : ""),
  },

  /* ─ BEST SELLERS ─ */
  bestSellers: {
    en:     ({ sorted }) => !sorted.length
      ? `No sales data yet. Record transactions to see your best-selling items.`
      : `Your top-selling items:\n\n${sorted.map(([n, d], i) => `${i+1}. **${n}**\n   ${fmtN(d.total)} · sold ${d.count} time${d.count!==1?"s":""}`).join("\n\n")}`,
    pidgin: ({ sorted }) => !sorted.length
      ? `No sales data yet. Record transactions first.`
      : `Your best selling items:\n\n${sorted.map(([n, d], i) => `${i+1}. **${n}**\n   ${fmtN(d.total)} · sell ${d.count} time${d.count!==1?"s":""}`).join("\n\n")}`,
    ha:     ({ sorted }) => !sorted.length
      ? `Babu bayanan siyarwa tukuna. Rikodin ma'amala kafin.`
      : `Kayan da suke siyarwa mafi yawa:\n\n${sorted.map(([n, d], i) => `${i+1}. **${n}**\n   ${fmtN(d.total)} · an sayar ${d.count} sau`).join("\n\n")}`,
    ig:     ({ sorted }) => !sorted.length
      ? `Ọ dịghị data ahịa ọ bụrụ ugbu a. Dere transaction na-eso.`
      : `Ngwaahịa ire kachasị mma:\n\n${sorted.map(([n, d], i) => `${i+1}. **${n}**\n   ${fmtN(d.total)} · resiere ${d.count} ugboro`).join("\n\n")}`,
    yo:     ({ sorted }) => !sorted.length
      ? `Ko si data titẹ sibẹ. Gba akọọlẹ transaction kọkọ.`
      : `Awon ọja to n tita julo:\n\n${sorted.map(([n, d], i) => `${i+1}. **${n}**\n   ${fmtN(d.total)} · ta ${d.count} igba`).join("\n\n")}`,
  },

  /* ─ OVERDUE ─ */
  overdue: {
    en: ({ odCredits, odAso }) => {
      if (!odCredits.length && !odAso.length) return `No overdue payments — everything is up to date. 🎉`;
      let msg = "";
      if (odCredits.length) {
        const t = odCredits.reduce((s, c) => s + (c.outstanding||0), 0);
        msg += `Overdue credits (${odCredits.length}):\n${odCredits.slice(0,3).map(c=>`• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")}\nTotal: **${fmtN(t)}**`;
      }
      if (odAso.length) {
        if (msg) msg += "\n\n";
        msg += `Overdue Ajo contributions (${odAso.length}):\n${odAso.slice(0,3).map(c=>`• ${c.client_name}`).join("\n")}`;
      }
      return msg;
    },
    pidgin: ({ odCredits, odAso }) => {
      if (!odCredits.length && !odAso.length) return `No overdue payments — everything dey fine. 🎉`;
      let msg = "";
      if (odCredits.length) {
        const t = odCredits.reduce((s, c) => s + (c.outstanding||0), 0);
        msg += `Credit wey don pass time (${odCredits.length}):\n${odCredits.slice(0,3).map(c=>`• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")}\nTotal: **${fmtN(t)}**`;
      }
      if (odAso.length) {
        if (msg) msg += "\n\n";
        msg += `Ajo wey dem never pay (${odAso.length}):\n${odAso.slice(0,3).map(c=>`• ${c.client_name}`).join("\n")}`;
      }
      return msg;
    },
    ha: ({ odCredits, odAso }) => {
      if (!odCredits.length && !odAso.length) return `Babu biyan kuɗi da suka wuce lokaci — komai yana da kyau. 🎉`;
      let msg = "";
      if (odCredits.length) {
        const t = odCredits.reduce((s, c) => s + (c.outstanding||0), 0);
        msg += `Bashin da ya wuce lokaci (${odCredits.length}):\n${odCredits.slice(0,3).map(c=>`• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")}\nJimla: **${fmtN(t)}**`;
      }
      if (odAso.length) {
        if (msg) msg += "\n\n";
        msg += `Ajo wanda ya wuce lokaci (${odAso.length}):\n${odAso.slice(0,3).map(c=>`• ${c.client_name}`).join("\n")}`;
      }
      return msg;
    },
    ig: ({ odCredits, odAso }) => {
      if (!odCredits.length && !odAso.length) return `Ọ dịghị ụgwọ nke agafeela oge — ihe niile dị mma. 🎉`;
      let msg = "";
      if (odCredits.length) {
        const t = odCredits.reduce((s, c) => s + (c.outstanding||0), 0);
        msg += `Ugwọ agafeela oge (${odCredits.length}):\n${odCredits.slice(0,3).map(c=>`• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")}\nNgụkọta: **${fmtN(t)}**`;
      }
      if (odAso.length) {
        if (msg) msg += "\n\n";
        msg += `Ajo agafeela oge (${odAso.length}):\n${odAso.slice(0,3).map(c=>`• ${c.client_name}`).join("\n")}`;
      }
      return msg;
    },
    yo: ({ odCredits, odAso }) => {
      if (!odCredits.length && !odAso.length) return `Ko si isanwo to koja akoko — ohun gbogbo wa ni ipo to dara. 🎉`;
      let msg = "";
      if (odCredits.length) {
        const t = odCredits.reduce((s, c) => s + (c.outstanding||0), 0);
        msg += `Gbese to koja akoko (${odCredits.length}):\n${odCredits.slice(0,3).map(c=>`• ${c.customer_name}: ${fmtN(c.outstanding)}`).join("\n")}\nApapọ: **${fmtN(t)}**`;
      }
      if (odAso.length) {
        if (msg) msg += "\n\n";
        msg += `Ajo to koja akoko (${odAso.length}):\n${odAso.slice(0,3).map(c=>`• ${c.client_name}`).join("\n")}`;
      }
      return msg;
    },
  },

  /* ─ AJO / ASO ─ */
  ajo: {
    en:     ({ clients, active, totalBal, totalTarget, overdue }) => !clients.length
      ? `No Ajo clients on record yet. Add clients from the Ajo tab.`
      : `Ajo savings group:\n\n• ${clients.length} client${clients.length!==1?"s":""} (${active.length} active)\n• Total saved: **${fmtN(totalBal)}**\n• Target: **${fmtN(totalTarget)}**` +
        (overdue.length ? `\n\n⚠️ ${overdue.length} client${overdue.length>1?"s":""} overdue for contributions` : "\n\n✅ All contributions up to date"),
    pidgin: ({ clients, active, totalBal, totalTarget, overdue }) => !clients.length
      ? `No Ajo client yet. Add clients for Ajo tab.`
      : `Ajo group:\n\n• ${clients.length} client${clients.length!==1?"s":""} (${active.length} active)\n• Total wey dem save: **${fmtN(totalBal)}**\n• Target: **${fmtN(totalTarget)}**` +
        (overdue.length ? `\n\n⚠️ ${overdue.length} client${overdue.length>1?"s":""} never pay their Ajo` : "\n\n✅ All Ajo payments dey fine"),
    ha:     ({ clients, active, totalBal, totalTarget, overdue }) => !clients.length
      ? `Babu abokan ajiyar Ajo tukuna. Ƙara abokan ciniki daga shafin Ajo.`
      : `Ƙungiyar ajiyar Ajo:\n\n• Abokan ciniki ${clients.length} (${active.length} suna aiki)\n• Jimlar ajiya: **${fmtN(totalBal)}**\n• Manufa: **${fmtN(totalTarget)}**` +
        (overdue.length ? `\n\n⚠️ Abokan ciniki ${overdue.length} sun wuce lokacin biyan su` : "\n\n✅ Duk biyan Ajo yana da kyau"),
    ig:     ({ clients, active, totalBal, totalTarget, overdue }) => !clients.length
      ? `Ọ dịghị ndị ọrụ Ajo ọ bụrụ ugbu a. Tinye ndị ọrụ na-esite na tab Ajo.`
      : `Otu nchekwa Ajo:\n\n• Ndị ọrụ ${clients.length} (${active.length} na-arụ ọrụ)\n• Ngụkọta echekwara: **${fmtN(totalBal)}**\n• Ebumnuche: **${fmtN(totalTarget)}**` +
        (overdue.length ? `\n\n⚠️ Ndị ọrụ ${overdue.length} agafeela oge nke Ajo ha` : "\n\n✅ Akwụkwọ Ajo niile dị mma"),
    yo:     ({ clients, active, totalBal, totalTarget, overdue }) => !clients.length
      ? `Ko si awon onibara Ajo sibẹ. Fi onibara kun lati tab Ajo.`
      : `Ẹgbẹ ifowopamọ Ajo:\n\n• Onibara ${clients.length} (${active.length} to n ṣiṣẹ)\n• Apapọ ti a fipamọ: **${fmtN(totalBal)}**\n• Ibi-afẹde: **${fmtN(totalTarget)}**` +
        (overdue.length ? `\n\n⚠️ Onibara ${overdue.length} koja akoko isanwo Ajo wọn` : "\n\n✅ Gbogbo isanwo Ajo wa ni ipo to dara"),
  },

  /* ─ DEFAULT / HELP ─ */
  help: {
    en:     () => `I can help you understand your business data. Try asking:\n\n• **"How were today's sales?"**\n• **"What is my total profit?"**\n• **"Show outstanding credit"**\n• **"Who are my top customers?"**\n• **"What is my stock status?"**\n• "How are my monthly sales?"\n• "What are my best selling items?"\n• "Show my expenses breakdown"\n• "Any overdue payments?"`,
    pidgin: () => `I fit help you understand your business. You fit ask:\n\n• **"How today sales go?"**\n• **"Wetin be my total profit?"**\n• **"Show credit wey dem never pay"**\n• **"Who be my best customers?"**\n• **"How my stock dey?"**\n• "How this month business go?"\n• "Which item dey sell pass?"\n• "Show my spending"\n• "Any payment wey don pass time?"`,
    ha:     () => `Zan iya taimakawa ku fahimci bayanan kasuwancinku. Gwada tambayar:\n\n• **"Yaya tallacen yau?"**\n• **"Nawa ne jimlar ribar ta?"**\n• **"Nuna bashin da ya rage"**\n• **"Wane ne manyan abokan ciniki ta?"**\n• **"Yaya kayan ajiya ta?"**\n• "Yaya kasuwancin wannan watan?"\n• "Wane kayan suke siyarwa sosai?"\n• "Nuna kashe-kashena"\n• "Akwai biyan kuɗi da suka wuce lokaci?"`,
    ig:     () => `Nwere ike inye aka ịghọta data azụmaahịa gị. Nwa jụọ:\n\n• **"Ahịa taa dị ka ọ dị?"**\n• **"Gịnị bụ ngụkọta uru m?"**\n• **"Gosi ugwọ e ji"**\n• **"Onye bụ ndị ahịa kacha mma m?"**\n• **"Ngwaahịa m dị ka ọ dị?"**\n• "Azụmaahịa ọnwa a dị ka ọ dị?"\n• "Gịnị bụ ihe ire kachasị mma?"\n• "Gosi ihe ejiri ego"\n• "Ọ dị ụgwọ agafeela oge?"`,
    yo:     () => `Mo le ran ọ lọwọ lati ni oye data isowo rẹ. Gbiyanju bibeere:\n\n• **"Bawo ni titẹ oni?"**\n• **"Kini apapọ ere mi?"**\n• **"Fi gbese to wa han"**\n• **"Tani awon onibara to ga julo mi?"**\n• **"Bawo ni ile-oja mi?"**\n• "Bawo ni isowo osu yi?"\n• "Awon ọja wo lo n tita julo?"\n• "Fi inawo mi han"\n• "Ṣe akoko isanwo kankan to koja?"`,
  },
};

/* ── Text-to-Speech confirmation — hybrid: instant browser TTS + Gemini ──
   1. Browser Web Speech fires IMMEDIATELY so the user always hears something.
   2. Gemini 2.5 Flash TTS runs in parallel — if it arrives in time it cancels
      the browser voice and plays the natural Nigerian AI audio instead.
   3. If Gemini fails or is slow, the browser voice already covered it.       */


const TTS_LANG_MAP = {
  en:     "en-NG",
  pidgin: "en-NG",
  ha:     "ha-NG",
  ig:     "ig-NG",
  yo:     "yo-NG",
};

const TTS_MESSAGES = {
  "en-NG": {
    cashIn:      "Success! Cash in recorded.",
    cashOut:     "Success! Cash out recorded.",
    stockIn:     "Inventory updated. Stock in successful.",
    creditSaved: "Credit payment recorded.",
    ajoDeposit:  "Ajo contribution successfully saved.",
    ajoWithdraw: "Ajo withdrawal successful.",
  },
  "ha-NG": {
    cashIn:      "An yi nasara. An yi rikodin kuɗi shiga.",
    cashOut:     "An yi nasara. An yi rikodin kuɗi fita.",
    stockIn:     "An sabunta kaya. Shigar da kaya ya yi nasara.",
    creditSaved: "An yi rikodin biyan bashi.",
    ajoDeposit:  "An adana gudunmawar Ajo cikin nasara.",
    ajoWithdraw: "Cire kuɗin Ajo ya yi nasara.",
  },
  "yo-NG": {
    cashIn:      "Ẹ kú owó. A ti kọ ọ sílẹ̀.",
    cashOut:     "A ti kọ owó tí ó jáde sílẹ̀.",
    stockIn:     "A ti ṣe àfikún ọjà pẹ̀lú àṣeyọrí.",
    creditSaved: "A ti kọ sísanwó gbèsè sílẹ̀.",
    ajoDeposit:  "A ti fipamọ̀ owó àjọ rẹ pẹ̀lú àṣeyọrí.",
    ajoWithdraw: "Yíyọ owó àjọ yọrí sí rere.",
  },
  "ig-NG": {
    cashIn:      "Ọ gara nke ọma. E dekọrọ ego mbata.",
    cashOut:     "Ọ gara nke ọma. E dekọrọ ego ọpụpụ.",
    stockIn:     "Emegharịrị ngwa ahịa. Ịbata ngwa ahịa gara nke ọma.",
    creditSaved: "E dekọrọ ịkwụ ụgwọ banyere bishị.",
    ajoDeposit:  "Echekwara ego otu Ajo nke ọma.",
    ajoWithdraw: "Ịdọrọ ego Ajo gara nke ọma.",
  },
};

export const speakConfirmation = (eventKey, langCode = "en") => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const bcp47 = TTS_LANG_MAP[langCode] || "en-NG";
  const msgs  = TTS_MESSAGES[bcp47] || TTS_MESSAGES["en-NG"];
  const text  = msgs[eventKey]      || TTS_MESSAGES["en-NG"][eventKey];
  if (!text) return;
  window.speechSynthesis.cancel();
  const utt   = new SpeechSynthesisUtterance(text);
  utt.lang    = bcp47;
  utt.rate    = 0.95;
  utt.pitch   = 1.0;
  window.speechSynthesis.speak(utt);
};

/* ── Resolve response for given intent + language ────────────────── */
export function respond(intent, lang, data) {
  const L = lang || "en";
  const fn = R[intent]?.[L] || R[intent]?.en;
  return fn ? fn(data) : R.help.en();
}
