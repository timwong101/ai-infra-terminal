export type SelectablePeriod = {
  id: string;
  periodKind: string;
  periodBasis: string;
  evidenceCount: number;
};

export function selectDefaultReportingPeriod<T extends SelectablePeriod>(
  periods: T[],
  requestedPeriodId?: string,
  metricPeriodIds: ReadonlySet<string> = new Set(),
) {
  return periods.find((period) => period.id === requestedPeriodId)
    ?? periods.find((period) => metricPeriodIds.has(period.id) && period.periodKind === "quarter" && period.periodBasis !== "calendar-fallback")
    ?? periods.find((period) => period.evidenceCount > 0 && period.periodKind === "quarter" && period.periodBasis !== "calendar-fallback")
    ?? periods.find((period) => period.evidenceCount > 0 && period.periodKind === "quarter")
    ?? periods.find((period) => period.evidenceCount > 0)
    ?? periods.find((period) => period.periodKind === "quarter" && period.periodBasis !== "calendar-fallback")
    ?? periods[0];
}
