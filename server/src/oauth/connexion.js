import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { sha256, aleatoire } from '../lib/crypto.js';
import { envoyerPage, envoyerConsentement } from '../lib/pages.js';
import { emailAutorise } from '../lib/acces.js';
import { transaction } from '../db/index.js';

const DUREE_STATE = 600;
const DUREE_SESSION = 30 * 24 * 3600;
const maintenant = () => Math.floor(Date.now() / 1000);

// Valeur du cookie `nom`. Null s'il est absent, répété (injection possible) ou mal encodé.
export function lireCookie(req, nom) {
  let trouve = null;
  let n = 0;
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === nom) {
      n++;
      try { trouve = decodeURIComponent(part.slice(i + 1).trim()); } catch { trouve = null; }
    }
  }
  return n === 1 ? trouve : null;
}

// Connexion Google (site et autorisation MCP) et sessions du site.
export function creerConnexion({ config, db, google, provider }) {
  const router = express.Router();
  const secure = config.publicUrl.startsWith('https:');
  // Le préfixe __Host- (Secure, Path=/, sans Domain) n'est valable qu'en https ; en http local de test, nom simple.
  const prefixe = secure ? '__Host-' : '';
  const COOKIE_ETAT = `${prefixe}rev_etat`;
  const COOKIE_ACCORD = `${prefixe}rev_accord`;
  const COOKIE_SESSION = `${prefixe}rev_sess`;
  const poser = (res, nom, valeur, maxAge) => res.append('Set-Cookie', `${nom}=${valeur}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);

  function pageIndisponible(res) {
    envoyerPage(res, 503, 'Connexion Google bientôt disponible', 'La connexion n\'est pas encore ouverte. Reviens un peu plus tard.');
  }

  async function demarrerGoogle(res, payload, { consent = false } = {}) {
    if (!config.googlePret) return pageIndisponible(res);
    const state = aleatoire(32);
    const navigateur = aleatoire(32); // lié au navigateur qui démarre la connexion (cookie rev_etat)
    db.prepare('INSERT INTO google_states (hash,payload,expires_at) VALUES (?,?,?)').run(sha256(state), JSON.stringify({ ...payload, nav: sha256(navigateur) }), maintenant() + DUREE_STATE);
    poser(res, COOKIE_ETAT, navigateur, DUREE_STATE);
    res.set('Cache-Control', 'no-store').redirect(302, google.urlAutorisation(state, consent));
  }

  function creerSession(res, userId) {
    const jeton = aleatoire(32);
    db.prepare('INSERT INTO sessions (hash,user_id,expires_at) VALUES (?,?,?)').run(sha256(jeton), userId, maintenant() + DUREE_SESSION);
    res.append('Set-Cookie', `${COOKIE_SESSION}=${jeton}; Max-Age=${DUREE_SESSION}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }
  const effacerEtat = (res) => poser(res, COOKIE_ETAT, '', 0);
  const effacerAccord = (res) => poser(res, COOKIE_ACCORD, '', 0);
  const effacerCookie = (res) => res.append('Set-Cookie', `${COOKIE_SESSION}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);

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

    if (!id.emailVerifie) {
      return envoyerPage(res, 403, 'E-mail non vérifié', 'Google n\'a pas confirmé l\'adresse e-mail de ce compte. Vérifie-la chez Google puis réessaie.');
    }
    if (!emailAutorise(config, id.email)) {
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
      // Aucun code ne part chez Claude sans l'accord de l'élève pour ce client (confused deputy).
      if (db.prepare('SELECT 1 FROM consentements WHERE user_id=? AND client_id=?').get(user.id, p.client_id)) return envoyerCode(res, user.id, p);
      const jeton = aleatoire(32);
      const navigateur = aleatoire(32);
      db.prepare('INSERT INTO consentements_attente (hash,user_id,client_id,payload,nav,expires_at) VALUES (?,?,?,?,?,?)')
        .run(sha256(jeton), user.id, p.client_id, JSON.stringify(p), sha256(navigateur), maintenant() + DUREE_STATE);
      poser(res, COOKIE_ACCORD, navigateur, DUREE_STATE);
      return envoyerConsentement(res, { hote: new URL(p.redirect_uri).host, jeton }); // nom fixe : client_name est choisi par celui qui s'inscrit
    }
    creerSession(res, user.id);
    res.redirect(302, '/');
  });

  function envoyerCode(res, userId, p) {
    const u = new URL(p.redirect_uri);
    u.searchParams.set('code', provider.creerCode(userId, p));
    if (p.state) u.searchParams.set('state', p.state);
    return res.redirect(302, u.href);
  }

  router.post('/auth/consentement', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const jeton = req.body?.jeton;
    const cookie = lireCookie(req, COOKIE_ACCORD);
    effacerAccord(res);
    const refus = () => envoyerPage(res, 400, 'Lien invalide', 'Cette demande a expiré ou n\'a pas été faite depuis ce navigateur. Reprends depuis Claude.');
    if (typeof jeton !== 'string' || !jeton) return refus();
    const h = sha256(jeton);
    const ligne = transaction(db, () => {
      const l = db.prepare('SELECT user_id, client_id, payload, nav, expires_at FROM consentements_attente WHERE hash=?').get(h);
      db.prepare('DELETE FROM consentements_attente WHERE hash=?').run(h); // usage unique
      return l;
    });
    if (!ligne || ligne.expires_at < maintenant() || !cookie) return refus();
    const attendu = Buffer.from(ligne.nav);
    const recu = Buffer.from(sha256(cookie));
    if (attendu.length !== recu.length || !crypto.timingSafeEqual(attendu, recu)) return refus();
    const p = JSON.parse(ligne.payload);
    if (req.body.decision === 'autoriser') {
      const u = db.prepare('SELECT email FROM users WHERE id=?').get(ligne.user_id);
      if (!u || !emailAutorise(config, u.email)) return envoyerPage(res, 403, 'Compte non invité', 'Ce compte n\'est pas invité.');
      db.prepare('INSERT OR IGNORE INTO consentements (user_id,client_id,created_at) VALUES (?,?,?)').run(ligne.user_id, ligne.client_id, maintenant());
      return envoyerCode(res, ligne.user_id, p);
    }
    const u = new URL(p.redirect_uri);
    u.searchParams.set('error', 'access_denied');
    if (p.state) u.searchParams.set('state', p.state);
    res.redirect(302, u.href);
  });

  router.post('/auth/logout', (req, res) => {
    const j = lireCookie(req, COOKIE_SESSION);
    if (j) db.prepare('DELETE FROM sessions WHERE hash=?').run(sha256(j));
    effacerCookie(res);
    res.json({ ok: true });
  });

  return { router, demarrerGoogle, effacerCookie };
}
