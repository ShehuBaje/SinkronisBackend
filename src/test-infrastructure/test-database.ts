export type DatabaseIdentity = { protocol: string; host: string; port: string; database: string; username: string };

export const databaseIdentity = (value: string, variableName: string): DatabaseIdentity => {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${variableName} is not a valid database URL`); }
  if (!['mysql:', 'mysqls:'].includes(parsed.protocol)) throw new Error(`${variableName} must use the MySQL protocol`);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).trim();
  if (!parsed.hostname || !database || !parsed.username) throw new Error(`${variableName} is missing host, database, or username`);
  return { protocol: parsed.protocol, host: parsed.hostname.toLowerCase(), port: parsed.port || '3306', database: database.toLowerCase(), username: decodeURIComponent(parsed.username) };
};

export const assertSafeTestDatabase = (input: { databaseUrl?: string; testDatabaseUrl?: string; nodeEnv?: string; destructive?: boolean }) => {
  if (!input.testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required; refusing to fall back to DATABASE_URL');
  if (!input.databaseUrl) throw new Error('DATABASE_URL is required for isolation comparison');
  const development = databaseIdentity(input.databaseUrl, 'DATABASE_URL');
  const test = databaseIdentity(input.testDatabaseUrl, 'TEST_DATABASE_URL');
  if (development.host === test.host && development.port === test.port && development.database === test.database) throw new Error('TEST_DATABASE_URL targets the development database');
  if (test.database !== 'sinkronis_test') throw new Error('TEST_DATABASE_URL must target the approved sinkronis_test database');
  if (input.destructive && input.nodeEnv !== 'test') throw new Error('Destructive test database utilities require NODE_ENV=test');
  return { development, test };
};

export const testDatabaseUrlWithSchema = (databaseUrl: string, database = 'sinkronis_test') => {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};
