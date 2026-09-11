import { createRequire } from 'node:module';

const require = createRequire(__filename);

export async function getFirebaseCliAccessToken(): Promise<string> {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  // Read-only health checks reuse the active Firebase CLI login. Tokens are
  // never printed or persisted by these scripts.
  const auth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () => { tokens?: { refresh_token?: string } } | undefined;
    getAccessToken: (
      refreshToken?: string,
      scopes?: string[],
    ) => Promise<{ access_token?: string }>;
  };
  const scopes = require('firebase-tools/lib/scopes') as { CLOUD_PLATFORM: string };
  const account = auth.getGlobalDefaultAccount();
  const token = await auth.getAccessToken(account?.tokens?.refresh_token, [scopes.CLOUD_PLATFORM]);
  if (!token.access_token) throw new Error('FIREBASE_CLI_ACCESS_TOKEN_UNAVAILABLE');
  return token.access_token;
}

export function decodeFirestoreValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if ('integerValue' in record) return Number(record.integerValue);
  if ('doubleValue' in record) return Number(record.doubleValue);
  if ('stringValue' in record) return record.stringValue;
  if ('booleanValue' in record) return record.booleanValue;
  if ('timestampValue' in record) return record.timestampValue;
  if ('nullValue' in record) return null;
  if ('arrayValue' in record) {
    const values = (record.arrayValue as { values?: unknown[] }).values ?? [];
    return values.map(decodeFirestoreValue);
  }
  if ('mapValue' in record) {
    return decodeFirestoreFields(
      (record.mapValue as { fields?: Record<string, unknown> }).fields ?? {},
    );
  }
  return undefined;
}

export function decodeFirestoreFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

export async function firestoreGetDocument(
  projectId: string,
  documentPath: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`FIRESTORE_READ_FAILED:${response.status}`);
  const document = await response.json() as { fields?: Record<string, unknown> };
  return decodeFirestoreFields(document.fields ?? {});
}

/** Read-only: returns null when document is absent (404). */
export async function firestoreGetDocumentOrNull(
  projectId: string,
  documentPath: string,
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FIRESTORE_READ_FAILED:${response.status}`);
  const document = await response.json() as { fields?: Record<string, unknown> };
  return decodeFirestoreFields(document.fields ?? {});
}

export type FirestoreListedDocument = {
  id: string;
  path: string;
  fields: Record<string, unknown>;
};

/** Read-only collection list with pagination. Never writes. */
export async function firestoreListDocuments(
  projectId: string,
  collectionPath: string,
  accessToken: string,
  options?: { pageSize?: number; maxDocuments?: number },
): Promise<FirestoreListedDocument[]> {
  const pageSize = Math.min(300, Math.max(1, options?.pageSize ?? 100));
  const maxDocuments = Math.max(1, options?.maxDocuments ?? 5_000);
  const out: FirestoreListedDocument[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set('pageToken', pageToken);
    const url =
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionPath}?${params}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`FIRESTORE_LIST_FAILED:${response.status}:${collectionPath}`);
    const body = (await response.json()) as {
      documents?: Array<{ name?: string; fields?: Record<string, unknown> }>;
      nextPageToken?: string;
    };
    for (const document of body.documents ?? []) {
      const name = String(document.name ?? '');
      const id = name.split('/').pop() ?? '';
      out.push({
        id,
        path: name.replace(
          `projects/${projectId}/databases/(default)/documents/`,
          '',
        ),
        fields: decodeFirestoreFields(document.fields ?? {}),
      });
      if (out.length >= maxDocuments) return out;
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

export async function firestoreRunQuery(
  projectId: string,
  structuredQuery: Record<string, unknown>,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_QUERY_FAILED:${response.status}`);
  const rows = await response.json() as Array<{ document?: { fields?: Record<string, unknown> } }>;
  return rows
    .filter((row) => row.document)
    .map((row) => decodeFirestoreFields(row.document?.fields ?? {}));
}
