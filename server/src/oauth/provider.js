import {
  InvalidGrantError, InvalidTokenError, InvalidClientMetadataError, InvalidTargetError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { transaction } from '../db/index.js';
import { sha256, aleatoire } from '../lib/crypto.js';
import { emailAutorise } from '../lib/acces.js';

const DUREE_ACCES = 3600; // 1 h
const DUREE_REFRESH = 30 * 24 * 3600; // 30 jours glissants
const DUREE_CODE = 300; // 5 min
const MAX_CLIENTS = 1000;
const maintenant = () => Math.floor(Date.now() / 1000);

// Seules les redirections de Claude sont acceptées (EXTRA_REDIRECT_URIS en ajoute, pour des tests).
export const REDIRECTIONS_AUTORISEES = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

const sansBarre = (s) => String(s).replace(/#.*$/, '').replace(/\/$/, '');

// Fournisseur OAuth pour le routeur d'autorisation du SDK. La connexion est déléguée à Google (demarrerGoogle).
export function creerProvider({ config, db, demarrerGoogle }) {
  function verifierResource(resource) {
    if (resource && sansBarre(resource.href ?? resource) !== sansBarre(config.mcpUrl)) {
      throw new InvalidTargetError(`resource doit être ${config.mcpUrl}`);
    }
  }

  const autorisees = new Set([...REDIRECTIONS_AUTORISEES, ...(config.redirectUrisSupplementaires ?? [])]);

  const clientsStore = {
    getClient(id) {
      const r = db.prepare('SELECT json FROM oauth_clients WHERE client_id=?').get(String(id));
      return r ? JSON.parse(r.json) : undefined;
    },
    registerClient(client) {
      const uris = client.redirect_uris ?? [];
      if (!uris.length || !uris.every((u) => autorisees.has(String(u)))) {
        throw new InvalidClientMetadataError('redirect_uris : seules les redirections de Claude sont acceptées.');
      }
      transaction(db, () => {
        db.prepare('INSERT INTO oauth_clients (client_id,json,created_at) VALUES (?,?,?)').run(client.client_id, JSON.stringify(client), maintenant());
        // Éviction des plus anciens, jamais un client qui a des jetons, un code ou une autorisation en cours.
        const t = maintenant();
        const trop = db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get().n - MAX_CLIENTS;
        if (trop > 0) {
          db.prepare(`DELETE FROM oauth_clients WHERE client_id IN (
            SELECT client_id FROM oauth_clients
            WHERE client_id <> ?
              AND client_id NOT IN (SELECT client_id FROM tokens WHERE expires_at >= ?)
              AND client_id NOT IN (SELECT client_id FROM auth_codes WHERE expires_at >= ?)
              AND client_id NOT IN (SELECT json_extract(payload, '$.client_id') FROM google_states WHERE expires_at >= ? AND json_extract(payload, '$.client_id') IS NOT NULL)
              AND client_id NOT IN (SELECT client_id FROM consentements_attente WHERE expires_at >= ?)
            ORDER BY created_at ASC, rowid ASC LIMIT ?)`).run(client.client_id, t, t, t, t, trop);
          db.prepare('DELETE FROM consentements WHERE client_id NOT IN (SELECT client_id FROM oauth_clients)').run();
        }
      });
      return client;
    },
  };

  // ALLOWED_EMAILS peut changer après l'émission des jetons : on le recontrôle à chaque usage.
  function compteAutorise(userId) {
    if (!config.emailsAutorises) return true;
    const u = db.prepare('SELECT email FROM users WHERE id=?').get(userId);
    return Boolean(u) && emailAutorise(config, u.email);
  }

  function emettre(userId, clientId, resource) {
    const acces = aleatoire(32);
    const refresh = aleatoire(32);
    const t = maintenant();
    const ins = db.prepare('INSERT INTO tokens (hash,kind,user_id,client_id,resource,expires_at) VALUES (?,?,?,?,?,?)');
    ins.run(sha256(acces), 'access', userId, clientId, resource ?? null, t + DUREE_ACCES);
    ins.run(sha256(refresh), 'refresh', userId, clientId, resource ?? null, t + DUREE_REFRESH);
    return { access_token: acces, token_type: 'Bearer', expires_in: DUREE_ACCES, refresh_token: refresh };
  }

  // Appelé à la fin de la connexion Google d'une autorisation MCP.
  function creerCode(userId, p) {
    const code = aleatoire(32);
    db.prepare('INSERT INTO auth_codes (hash,user_id,client_id,redirect_uri,code_challenge,resource,expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(sha256(code), userId, p.client_id, p.redirect_uri, p.code_challenge, p.resource ?? null, maintenant() + DUREE_CODE);
    return code;
  }

  const provider = {
    clientsStore,
    creerCode,

    async authorize(client, params, res) {
      verifierResource(params.resource);
      await demarrerGoogle(res, {
        kind: 'mcp',
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge,
        state: params.state ?? null,
        resource: params.resource?.href ?? null,
      });
    },

    async challengeForAuthorizationCode(client, code) {
      const r = db.prepare('SELECT client_id, code_challenge, expires_at FROM auth_codes WHERE hash=?').get(sha256(code));
      if (!r || r.client_id !== client.client_id || r.expires_at < maintenant()) throw new InvalidGrantError('Code invalide ou expiré.');
      return r.code_challenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
      verifierResource(resource);
      return transaction(db, () => {
        const h = sha256(code);
        const r = db.prepare('SELECT * FROM auth_codes WHERE hash=?').get(h);
        db.prepare('DELETE FROM auth_codes WHERE hash=?').run(h); // usage unique
        if (!r || r.client_id !== client.client_id || r.expires_at < maintenant()) throw new InvalidGrantError('Code invalide ou expiré.');
        if (!compteAutorise(r.user_id)) throw new InvalidGrantError('Compte non invité.');
        if (redirectUri !== undefined && redirectUri !== r.redirect_uri) throw new InvalidGrantError('redirect_uri différent de la demande.');
        return emettre(r.user_id, client.client_id, r.resource);
      });
    },

    async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
      verifierResource(resource);
      return transaction(db, () => {
        const h = sha256(refreshToken);
        const r = db.prepare("SELECT * FROM tokens WHERE hash=? AND kind='refresh'").get(h);
        if (!r || r.client_id !== client.client_id || r.expires_at < maintenant()) throw new InvalidGrantError('Jeton de rafraîchissement invalide ou expiré.');
        if (!compteAutorise(r.user_id)) throw new InvalidGrantError('Compte non invité.');
        db.prepare('DELETE FROM tokens WHERE hash=?').run(h); // rotation
        return emettre(r.user_id, client.client_id, r.resource);
      });
    },

    async verifyAccessToken(token) {
      const r = db.prepare("SELECT * FROM tokens WHERE hash=? AND kind='access'").get(sha256(token));
      if (!r || r.expires_at < maintenant() || !compteAutorise(r.user_id)) throw new InvalidTokenError('Jeton invalide ou expiré.');
      return {
        token, clientId: r.client_id, scopes: [], expiresAt: r.expires_at,
        resource: r.resource ? new URL(r.resource) : undefined,
        extra: { userId: r.user_id },
      };
    },

    async revokeToken(client, { token }) {
      db.prepare('DELETE FROM tokens WHERE hash=? AND client_id=?').run(sha256(token), client.client_id);
    },
  };
  return provider;
}

export function purger(db) {
  const t = maintenant();
  db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM google_states WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM consentements_attente WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
}
