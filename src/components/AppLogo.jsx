import { useState } from "react";

export default function AppLogo({ className = "" }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={`font-extrabold text-green-600 tracking-tight ${className}`}
        style={{ fontSize: "inherit", display: "inline-block" }}>
        KudiAI Track
      </span>
    );
  }

  return (
    <img
      src="/icon-transparent.png"
      alt="KudiAI Track"
      className={className}
      style={{ objectFit: "contain" }}
      onError={() => setFailed(true)}
    />
  );
}
