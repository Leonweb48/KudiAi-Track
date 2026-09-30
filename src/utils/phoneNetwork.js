// The mobile network a Nigerian number belongs to, from its prefix ("MTN" | "Airtel" | "Glo" | "9mobile" | null).
// The bill form switches to this network as the number is typed, so a missing prefix means the order goes out on whatever
// network was selected before — and ClubKonnect refuses an order on the wrong network.
const MTN    = ["0703", "0704", "0706", "0803", "0806", "0810", "0813", "0814", "0816", "0903", "0906", "0913", "0916"];   // 0704 = the old Visafone range
const AIRTEL = ["0701", "0708", "0802", "0808", "0812", "0901", "0902", "0904", "0907", "0911", "0912", "0917"];
const GLO    = ["0705", "0805", "0807", "0811", "0815", "0905", "0915"];
const NMOB   = ["0809", "0817", "0818", "0908", "0909", "0919"];

export function detectNetwork(phone) {
  const clean = String(phone ?? "").replace(/\D/g, "");
  const local = clean.startsWith("234") ? "0" + clean.slice(3) : clean;
  if (local.length < 4) return null;
  const prefix = local.slice(0, 4);
  // 0702 is split: only 07025 / 07026 are MTN — needs the fifth digit
  if (prefix === "0702") return ["07025", "07026"].includes(local.slice(0, 5)) ? "MTN" : null;
  if (MTN.includes(prefix))    return "MTN";
  if (AIRTEL.includes(prefix)) return "Airtel";
  if (GLO.includes(prefix))    return "Glo";
  if (NMOB.includes(prefix))   return "9mobile";
  return null;
}
