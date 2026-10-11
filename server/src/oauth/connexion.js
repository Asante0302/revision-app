import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { sha256, aleatoire } from '../lib/crypto.js';
import { envoyerPage } from '../lib/pages.js';
import { transaction } from '../db/index.js';

const DUREE_STATE = 600;
const DUREE_SESSION = 30 * 24 * 3600;
const COOKIE_ETAT = 'rev_etat';
const CHEMIN_ETAT = '/auth/google/callback';
const maintenant = () => Math.floor(Date.now() / 1000);

export function lireCookie(req, nom) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === nom) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Connexion Google (site et autorisation MCP) et sessions du site.
export function creerConnexion({ config, db, google, provider }) {
  const router = express.Router();
  const secure = config.publicUrl.startsWith('https:');

  function pageIndisponible(res) {
    envoyerPage(res, 503, 'Connexion Google bientôt disponible', 'La connexion n\'est pas encore ouverte. Reviens un peu plus tard.');
  }

  async function demarrerGoogle(res, payload, { consent = false } = {}) {
    if (!config.googlePret) return pageIndisponible(res);
    const state = aleatoire(32);
    const navigateur = aleatoire(32); // lié au navigateur qui démarre la connexion (cookie rev_etat)
    db.prepare('INSERT INTO google_states (hash,payload,expires_at) VALUES (?,?,?)').run(sha256(state), JSON.stringify({ ...payload, nav: sha256(navigateur) }), maintenant() + DUREE_STATE);
    res.append('Set-Cookie', `${COOKIE_ETAT}=${navigateur}; Max-Age=${DUREE_STATE}; Path=${CHEMIN_ETAT}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
    res.set('Cache-Control', 'no-store').redirect(302, google.urlAutorisation(state, consent));
  }

  function creerSession(res, userId) {
    const jeton = aleatoire(32);
    db.prepare('INSERT INTO sessions (hash,user_id,expires_at) VALUES (?,?,?)').run(sha256(jeton), userId, maintenant() + DUREE_SESSION);
    res.append('Set-Cookie', `rev_sess=${jeton}; Max-Age=${DUREE_SESSION}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }
  const effacerEtat = (res) => res.append('Set-Cookie', `${COOKIE_ETAT}=; Max-Age=0; Path=${CHEMIN_ETAT}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  const effacerCookie = (res) => res.append('Set-Cookie', `rev_sess=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);

  const limite = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.limiteAuth ?? 60, standardHeaders: true, legacyHeaders: false, message: { erreur: 'Trop de tentatives, réessaie plus tard.' } });
  router.use('/auth', limite);

  router.get('/auth/login', (req, res) => demarrerGoogle(res, { kind: 'site' }));

  router.get('/auth/google/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!config.googlePret) return pageIndisponible(res);
    const { code, state, error } = req.query;
    if (typeof state !== 'string') return envoyerPage(res, 400, 'Lien invalide', 'Recommence la connexion depuis le début.');
    const h = sha256(state);
    const ligne = transaction(db, () => {
      const l = db.prepare('SELECT payload, expires_at FROM google_states WHERE hash=?').get(h);
      db.prepare('DELETE FROM google_states WHERE hash=?').run(h); // usage unique
      return l;
    });
    if (!ligne || ligne.expires_at < maintenant()) return envoyerPage(res, 400, 'Lien expiré', 'Ce lien de connexion a expiré. Recommence depuis le début.');
    const p = JSON.parse(ligne.payload);
    const cookieEtat = lireCookie(req, COOKIE_ETAT);
    effacerEtat(res);
    const attendu = Buffer.from(String(p.nav));
    const recu = Buffer.from(cookieEtat ? sha256(cookieEtat) : '');
    if (attendu.length !== recu.length || !crypto.timingSafeEqual(attendu, recu)) {
      return envoyerPage(res, 400, 'Lien invalide', 'Cette connexion n\'a pas été commencée depuis ce navigateur. Recommence depuis le début.');
    }

    if (error || typeof code !== 'string') {
      if (p.kind === 'mcp') {
        const u = new URL(p.redirect_uri);
        u.searchParams.set('error', 'access_denied');
        if (p.state) u.searchParams.set('state', p.state);
        return res.redirect(302, u.href);
      }
      return envoyerPage(res, 400, 'Connexion annulée', 'Tu as annulé la connexion avec Google.');
    }

    let id;
    try { id = await google.echangerCode(code); } catch { return envoyerPage(res, 502, 'Connexion impossible', 'Google n\'a pas validé la connexion. Réessaie dans un instant.'); }

    if (config.emailsAutorises && !config.emailsAutorises.has(String(id.email ?? '').toLowerCase())) {
      return envoyerPage(res, 403, 'Compte non invité', 'Ce compte n\'est pas invité.');
    }

    // Vérification de place et création du compte sans interruption (même tour d'exécution).
    let user = db.prepare('SELECT id, refresh_enc FROM users WHERE sub=?').get(id.sub);
    if (!user) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      if (n >= config.maxUsers) return envoyerPage(res, 403, 'Places complètes', 'Toutes les places de cette version sont prises. Merci de ton intérêt !');
    }
    if (!id.refreshToken && !user?.refresh_enc) {
      // Google ne renvoie le jeton de rafraîchissement qu'au premier consentement : on le redemande une fois.
      if (p.consentDemande) return envoyerPage(res, 502, 'Connexion incomplète', 'Google n\'a pas donné l\'accès au Drive. Réessaie en acceptant toutes les autorisations.');
      return demarrerGoogle(res, { ...p, consentDemande: true }, { consent: true });
    }
    const iso = new Date().toISOString();
    const enc = id.refreshToken ? google.chiffrerRefresh(id.refreshToken) : user.refresh_enc;
    if (user) {
      db.prepare('UPDATE users SET email=?, nom=?, refresh_enc=?, last_login=? WHERE id=?').run(id.email, id.nom, enc, iso, user.id);
    } else {
      user = { id: Number(db.prepare('INSERT INTO users (sub,email,nom,refresh_enc,created_at,last_login) VALUES (?,?,?,?,?,?)').run(id.sub, id.email, id.nom, enc, iso, iso).lastInsertRowid) };
    }
    google.oublier(user.id);

    if (p.kind === 'mcp') {
      const c = provider.creerCode(user.id, p);
      const u = new URL(p.redirect_uri);
      u.searchParams.set('code', c);
      if (p.state) u.searchParams.set('state', p.state);
      return res.redirect(302, u.href);
    }
    creerSession(res, user.id);
    res.redirect(302, '/');
  });

  router.post('/auth/logout', (req, res) => {
    const j = lireCookie(req, 'rev_sess');
    if (j) db.prepare('DELETE FROM sessions WHERE hash=?').run(sha256(j));
    effacerCookie(res);
    res.json({ ok: true });
  });

  return { router, demarrerGoogle, effacerCookie };
}
