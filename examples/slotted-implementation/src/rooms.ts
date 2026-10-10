const archivedRoomMarks = new Map<string, boolean>();

export function markRoomArchived(roomId: string) {
  archivedRoomMarks.set(roomId, true);
}
