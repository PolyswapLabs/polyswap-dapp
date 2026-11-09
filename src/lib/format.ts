export function fmtUSD(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  if (opts.compact) {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
    return `$${n.toFixed(0)}`;
  }
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : 2,
  });
}

export function fmtPct(p: number, digits = 0): string {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const TOKEN_AMOUNT_MIN_DISPLAY = 1e-9;

/**
 * Display a token amount with up to 9 decimal places. Values that round
 * to zero at that precision but are still positive are shown as `> 1e-9`
 * so users can tell the estimate is non-zero rather than empty.
 */
export function fmtTokenAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n <= 0) return "0";
  if (n < TOKEN_AMOUNT_MIN_DISPLAY) return "> 0.000000001";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: 9,
    minimumFractionDigits: 0,
  });
}

export function fmtDate(date: string | number | Date): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(date: string | number | Date): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "—";

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

export function fmtPointsAway(current: number, threshold: number): string {
  const pts = Math.abs((threshold - current) * 100);
  return `${pts.toFixed(1)} pts`;
}

export function fmtRelative(date: Date, now = Date.now()): string {
  const diff = now - date.getTime();
  if (diff < 60_000) return "Just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
