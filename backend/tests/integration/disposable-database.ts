const protectedNames = new Set(['nivaas', 'nivaas_test', 'nivaas_demo', 'admin', 'local', 'config']);

export function assertDisposableDatabase(name: string, confirmation: string | undefined): void {
  if (protectedNames.has(name.toLowerCase()) || !/^nivaas_disposable_[a-z0-9_]+$/.test(name) || confirmation !== name) {
    throw new Error('Tests require a nivaas_disposable_* database and matching NIVAAS_DISPOSABLE_DATABASE confirmation. Protected databases cannot be cleared.');
  }
}

export function validateTestUri(uri: string, confirmation: string | undefined): string {
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error('MONGODB_TEST_URI must be a valid MongoDB URI.'); }
  const name = decodeURIComponent(parsed.pathname.slice(1));
  assertDisposableDatabase(name, confirmation);
  if (parsed.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.searchParams.get('replicaSet') !== 'rs0') {
    throw new Error('Integration tests require a loopback MongoDB rs0 replica set.');
  }
  return name;
}
