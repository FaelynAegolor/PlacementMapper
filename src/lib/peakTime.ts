/** The next upcoming weekday at 08:30 local time, strictly in the future.
 * Used as the departure time for traffic- and schedule-aware route lookups,
 * so times reflect a typical morning commute rather than free-flow/off-peak
 * conditions. */
export function nextPeakDeparture(): Date {
  const target = new Date();
  target.setHours(8, 30, 0, 0);
  if (target <= new Date()) target.setDate(target.getDate() + 1);
  while (target.getDay() === 0 || target.getDay() === 6) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}
