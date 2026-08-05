// matchDays.date é uma coluna `date` do Postgres — chega como "YYYY-MM-DD".
// Construímos a data ao meio-dia para não deslizar de dia por fuso horário.
function toDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00`);
}

export function formatDate(dateStr: string): string {
  return toDate(dateStr).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
}

export function formatDateShort(dateStr: string): string {
  return toDate(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// time do Postgres chega como "HH:MM:SS" — exibimos só HH:MM.
export function formatTime(timeStr: string | null): string | null {
  if (!timeStr) return null;
  return timeStr.slice(0, 5);
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
