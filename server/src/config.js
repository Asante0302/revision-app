import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jourLocal } from './lib/dates.js';

const ici = path.dirname(fileURLToPath(import.meta.url));

export function chargerConfig(env = process.env, surcharges = {}) {
  const port = Number(env.PORT || 8650);
  const publicUrl = (env.PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  const googleClientId = env.GOOGLE_CLIENT_ID || '';
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET || '';
  let encKey = null;
  if (env.ENC_KEY) {
    encKey = Buffer.from(env.ENC_KEY, 'base64');
    if (encKey.length !== 32) throw new Error('ENC_KEY doit faire 32 octets (base64).');
  }
  if (googleClientId && !encKey) throw new Error('ENC_KEY est obligatoire quand GOOGLE_CLIENT_ID est défini.');
  let maxUsers = 10;
  if (env.MAX_USERS !== undefined && env.MAX_USERS !== '') {
    if (!/^\d+$/.test(env.MAX_USERS.trim()) || Number(env.MAX_USERS) < 1) throw new Error('MAX_USERS doit être un entier supérieur ou égal à 1.');
    maxUsers = Number(env.MAX_USERS);
  }
  const listeVirgules = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const emailsAutorises = listeVirgules(env.ALLOWED_EMAILS).map((s) => s.toLowerCase());
  const timezone = env.TIMEZONE || 'Europe/Paris';
  const config = {
    port,
    publicUrl,
    mcpUrl: publicUrl + '/mcp',
    googleClientId,
    googleClientSecret,
    googlePret: Boolean(googleClientId),
    encKey,
    dataDir: env.DATA_DIR || path.resolve('data'),
    dbPath: null,
    maxUsers,
    emailsAutorises: emailsAutorises.length ? new Set(emailsAutorises) : null,
    redirectUrisSupplementaires: listeVirgules(env.EXTRA_REDIRECT_URIS),
    timezone,
    today: () => jourLocal(new Date(), timezone),
    webDir: path.resolve(ici, '../../web'),
    templatesDir: path.resolve(ici, '../templates'),
    google: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
      driveUrl: 'https://www.googleapis.com/drive/v3',
      uploadUrl: 'https://www.googleapis.com/upload/drive/v3',
    },
    ...surcharges,
  };
  config.dbPath ??= path.join(config.dataDir, 'revision.sqlite');
  if (surcharges.google) config.google = { ...config.google, ...surcharges.google };
  return config;
}
