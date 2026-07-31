let cloudSaveAccountConflictPending = false;

export function setCloudSaveAccountConflictPending(pending: boolean): void {
  cloudSaveAccountConflictPending = pending;
}

export function isCloudSaveAccountConflictPending(): boolean {
  return cloudSaveAccountConflictPending;
}
