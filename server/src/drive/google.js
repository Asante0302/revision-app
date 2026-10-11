import { chiffrer, dechiffrer } from '../lib/crypto.js';
import { ErreurGoogle, ReconnexionNecessaire } from '../lib/erreurs.js';

export const PORTEES = 'openid email profile https://www.googleapis.com/auth/drive.file';

const delai = () => AbortSignal.timeout(20_000);

export function creerGoogle({ config, db, fetchFn = fetch }) {
  const redirectUri = config.publicUrl + '/auth/google/callback';
  const cacheAcces = new Map(); // userId -> {token, exp}

  function urlAutorisation(state, consent) {
    const u = new URL(config.google.authUrl);
    u.search = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: PORTEES,
      access_type: 'offline',
      state,
      ...(consent ? { prompt: 'consent' } : {}),
    }).toString();
    return u.href;
  }

  async function post(url, corps) {
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(corps),
      signal: delai(),
    });
    const texte = await r.text();
    let json = {};
    try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    return { ok: r.ok, status: r.status, json };
  }

  async function echangerCode(code) {
    const r = await post(config.google.tokenUrl, {
      code, client_id: config.googleClientId, client_secret: config.googleClientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    if (!r.ok) throw new ErreurGoogle('Google a refusé le code de connexion.');
    const idToken = r.json.id_token;
    let claims;
    try { claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')); } catch { throw new ErreurGoogle('Réponse Google illisible.'); }
    // Le jeton vient directement de Google en TLS (échange de code) : on vérifie seulement l'audience.
    if (claims.aud !== config.googleClientId || !claims.sub) throw new ErreurGoogle('Réponse Google inattendue.');
    return { sub: String(claims.sub), email: claims.email ?? '', emailVerifie: claims.email_verified === true || claims.email_verified === 'true', nom: claims.name ?? '', refreshToken: r.json.refresh_token ?? null };
  }

  async function accessTokenPour(userId) {
    const c = cacheAcces.get(userId);
    if (c && c.exp > Date.now() + 60_000) return c.token;
    const u = db.prepare('SELECT refresh_enc FROM users WHERE id = ?').get(userId);
    if (!u?.refresh_enc) throw new ReconnexionNecessaire(config.publicUrl);
    let refresh;
    try { refresh = dechiffrer(config.encKey, u.refresh_enc); } catch { throw new ReconnexionNecessaire(config.publicUrl); }
    const r = await post(config.google.tokenUrl, {
      refresh_token: refresh, client_id: config.googleClientId, client_secret: config.googleClientSecret, grant_type: 'refresh_token',
    });
    if (!r.ok) {
      if (r.json?.error === 'invalid_grant') {
        db.prepare('UPDATE users SET refresh_enc = NULL WHERE id = ?').run(userId);
        throw new ReconnexionNecessaire(config.publicUrl);
      }
      throw new ErreurGoogle('Google ne répond pas correctement pour le moment. Réessaie dans un instant.');
    }
    cacheAcces.set(userId, { token: r.json.access_token, exp: Date.now() + (r.json.expires_in ?? 3600) * 1000 });
    return r.json.access_token;
  }

  const oublier = (userId) => cacheAcces.delete(userId);
  const chiffrerRefresh = (t) => chiffrer(config.encKey, t);

  async function revoquer(userId) {
    const u = db.prepare('SELECT refresh_enc FROM users WHERE id = ?').get(userId);
    if (!u?.refresh_enc) return;
    try {
      await post(config.google.revokeUrl, { token: dechiffrer(config.encKey, u.refresh_enc) });
    } catch { /* au mieux */ }
  }

  return { redirectUri, urlAutorisation, echangerCode, accessTokenPour, oublier, chiffrerRefresh, revoquer };
}
