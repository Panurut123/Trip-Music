export type SeatGroup = "A" | "B";

export function groupNumberToSeat(group: SeatGroup, number: number): number {
  if (!Number.isInteger(number) || number < 1 || number > 20) throw new Error("invalid seat number");
  return group === "A" ? number : number + 20;
}

export function seatToGroup(seatNo: number): { group: SeatGroup; number: number; label: string } {
  const normalized = Math.min(40, Math.max(1, Math.trunc(seatNo || 1)));
  const group: SeatGroup = normalized <= 20 ? "A" : "B";
  const number = group === "A" ? normalized : normalized - 20;
  return { group, number, label: `${group === "A" ? "ก" : "ข"}-${String(number).padStart(2, "0")}` };
}

export function formatSeatLabel(seatNo?: number | null): string {
  if (!seatNo) return "—";
  return seatToGroup(seatNo).label;
}
