export function submitBookingRequest(durationDays: number, leadDays: number) {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 7) {
    throw new RangeError("duration");
  }
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 180) {
    throw new RangeError("lead time");
  }
  return { durationDays, leadDays };
}

export function changePendingRange(
  request: ReturnType<typeof submitBookingRequest>,
  durationDays: number,
  leadDays: number,
) {
  return { ...request, ...submitBookingRequest(durationDays, leadDays) };
}
