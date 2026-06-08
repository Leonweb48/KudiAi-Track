const STATUS_COLORS = {
  active:          "bg-blue-100 text-blue-700",
  paid:            "bg-green-100 text-green-700",
  partially_paid:  "bg-amber-100 text-amber-700",
  overdue:         "bg-red-100 text-red-700",
};

export default function Badge({ status }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
        STATUS_COLORS[status] || "bg-gray-100 text-gray-600"
      }`}
    >
      {status?.replace(/_/g, " ")}
    </span>
  );
}
