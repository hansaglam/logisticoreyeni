/** Auth UID snapshot for save bootstrap — avoids importing Firebase/RN in storage tests. */

let bootstrapAuthUid: string | null = null;

export function setSaveBootstrapAuthUid(uid: string | null): void {
  bootstrapAuthUid = uid;
}

export function getSaveBootstrapAuthUid(): string | null {
  return bootstrapAuthUid;
}
