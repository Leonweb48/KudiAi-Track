// ManagerShared — primitives shared across all Manager tab screens.
// Re-exports everything from StaffShared so sub-screens don't need
// separate import paths. Extends with gradient-colour bill services
// and an ActionBtn with a 44px minimum touch target.
import { useT } from "../../contexts/LanguageContext";

export {
  NK, GK, GKL, YEAR,
  makeNav, greetingText, fmtDate, dateRange, uploadAvatar,
  Svg, P,
  SectionLabel, SettingsCard, Row, RowIcon, StatCard,
  TxRow, ChangePinModal,
} from "../staff/StaffShared";

// Bill services with gradient colours for the ManagerHome Quick Services grid.
export function useManagerBillServices() {
  const t = useT();
  return [
    { id: "mic",         label: t("bill.micSale"),     isMic: true, g1: "#059669", g2: "#065f46", icon: "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z|M19 10v2a7 7 0 01-14 0v-2|M12 19v4|M8 23h8" },
    { id: "airtime",     label: t("bill.airtime"),     g1: "#ef4444", g2: "#dc2626", icon: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
    { id: "data",        label: t("bill.data"),        g1: "#3b82f6", g2: "#1d4ed8", icon: "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4" },
    { id: "electricity", label: t("bill.electricity"), g1: "#f59e0b", g2: "#d97706", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
    { id: "cable",       label: t("bill.cableTV"),     g1: "#8b5cf6", g2: "#6d28d9", icon: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
    { id: "betting",     label: t("bill.betting"),     g1: "#10b981", g2: "#059669", icon: "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3" },
  ];
}

// ActionBtn — 44px minimum touch target (WCAG 2.5.5), matching business portal.
export function ActionBtn({ label, icon, bg, onClick }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
      <div className={`min-w-[44px] min-h-[44px] w-14 h-14 rounded-2xl flex items-center justify-center shadow-md ${bg}`}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white"
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {icon.split("|").map((d, i) => <path key={i} d={d} />)}
        </svg>
      </div>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[60px]">{label}</span>
    </button>
  );
}
