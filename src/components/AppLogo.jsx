import { useState } from "react";
import HolidayCap, { useHolidayCap } from "./HolidayCap";

function Wordmark() {
  return (
    <span className="flex items-baseline gap-0 select-none leading-none">
      <span
        className="text-[17px] font-black tracking-tight"
        style={{ background: "linear-gradient(135deg,#3DA829,#2E8020)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
      >
        KudiAI
      </span>
      <span className="text-[13px] font-semibold tracking-wide ml-1 text-[#16255A] dark:text-slate-300">
        Track
      </span>
    </span>
  );
}

// `portal` (owner | staff | manager | ajo_client | coop_admin | coop_member | public) turns on the holiday cap the admin
// scheduled for that portal (admin portal → Settings → Holiday Logo Caps). No portal = never a cap.
export default function AppLogo({ businessName, iconUrl, className = "", portal }) {
  const [imgFailed, setImgFailed]       = useState(false);
  const [customFailed, setCustomFailed] = useState(false);
  const cap = useHolidayCap(portal);

  const showCustom = iconUrl && !customFailed;

  return (
    <div className={`flex items-center gap-2 flex-none min-w-0 ${className}`}>
      <span className="relative inline-flex flex-shrink-0">
      {cap && <HolidayCap preset={cap.preset} title={cap.title} />}
      {showCustom ? (
        <img
          src={iconUrl}
          alt="Business logo"
          className="h-8 w-8 rounded-xl object-cover flex-shrink-0"
          onError={() => setCustomFailed(true)}
        />
      ) : imgFailed ? (
        <div className="h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-[#3DA829] to-[#2E8020]">
          <span className="text-white font-black text-sm">K</span>
        </div>
      ) : (
        <img
          src="/logo-tp.png"
          alt="KudiAI Track"
          className="h-8 w-8 object-contain flex-shrink-0"
          onError={() => setImgFailed(true)}
        />
      )}
      </span>

      {businessName ? (
        <p className="text-[15px] font-black text-slate-800 dark:text-white leading-tight truncate max-w-[160px]">
          {businessName}
        </p>
      ) : (
        <Wordmark />
      )}
    </div>
  );
}
