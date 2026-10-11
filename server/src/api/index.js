import express from 'express';
import Busboy from 'busboy';
import rateLimit from 'express-rate-limit';
import { sha256 } from '../lib/crypto.js';
import { ErreurMetier, ErreurGoogle } from '../lib/erreurs.js';
import { nettoyerNom } from '../lib/noms.js';
import { lireCookie } from '../oauth/connexion.js';
import { emailAutorise } from '../lib/acces.js';

const MAX_UPLOAD = 10 * 1024 * 1024;

function detecterType(buf, declare, nom) {
  const b = buf;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return ['image/webp', 'webp'];
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return ['application/pdf', 'pdf'];
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(b.toString('latin1', 8, 12))) return ['image/heic', 'heic'];
  if ((declare === 'text/plain' || /\.txt$/i.test(nom)) && !b.subarray(0, 4096).includes(0)) return ['text/plain', 'txt'];
  return null;
}

function lireUpload(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD, fields: 5, parts: 8 } }); } catch { return reject(new ErreurMetier('Envoi invalide : fichier attendu.')); }
    let fichier = null, trop = false;
    bb.on('file', (champ, flux, info) => {
      if (champ !== 'fichier') { flux.resume(); return; }
      const morceaux = [];
      flux.on('data', (d) => morceaux.push(d));
      flux.on('limit', () => { trop = true; });
      flux.on('end', () => { fichier = { buf: Buffer.concat(morceaux), nom: info.filename || 'photo', declare: info.mimeType }; });
    });
    bb.on('error', () => reject(new ErreurMetier('Envoi invalide.')));
    bb.on('close', () => {
      if (trop) return reject(new ErreurMetier('Fichier trop gros : 10 Mo au maximum.', 413));
      if (!fichier || !fichier.buf.length) return reject(new ErreurMetier('Aucun fichier reçu.'));
      resolve(fichier);
    });
    req.pipe(bb);
  });
}

export function creerApi({ config, db, comptes, lecons, google, effacerCookie }) {
  const router = express.Router();
  const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

  router.get('/statut', (req, res) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    res.json({ google_pret: config.googlePret, places_libres: n < config.maxUsers });
  });

  // Origine : toute requête non GET doit venir du site.
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== config.publicUrl) {
      return res.status(403).json({ erreur: 'Origine refusée.' });
    }
    next();
  });

  router.use((req, res, next) => {
    const j = lireCookie(req, config.publicUrl.startsWith('https:') ? '__Host-rev_sess' : 'rev_sess');
    const u = j && db.prepare(`SELECT u.id, u.email, u.nom, u.refresh_enc FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash=? AND s.expires_at > ?`).get(sha256(j), Math.floor(Date.now() / 1000));
    if (!u || !emailAutorise(config, u.email)) return res.status(401).json({ erreur: 'Connecte-toi avec Google.', google_pret: config.googlePret });
    req.user = u;
    next();
  });

  router.get('/moi', (req, res) => {
    const u = req.user;
    res.json({ email: u.email, nom: u.nom, connecteur_url: config.mcpUrl, google_pret: config.googlePret && Boolean(u.refresh_enc) });
  });

  router.get('/aujourdhui', async (req, res) => {
    const controles = await comptes.controles(req.user.id, 14);
    res.json({ controles, lecons: lecons.aujourdhuiLecons(req.user.id, controles) });
  });

  router.get('/lecons', (req, res) => {
    res.json(lecons.etatToutes(req.user.id).map((l) => ({
      id: l.id, matiere: l.matiere, chapitre: l.chapitre, titre: l.titre, ajoutee_le: l.added_at,
      nb_cartes: l.nb_cartes, nb_quiz: l.nb_quiz, nb_exercices: l.nb_exercices,
      cartes_dues: l.cartes_dues, meilleur_quiz: l.meilleur_quiz,
    })));
  });

  router.get('/lecons/:id', (req, res) => {
    const { lecon, pack } = lecons.lire(req.user.id, req.params.id);
    res.json({ id: lecon.id, matiere: lecon.matiere, chapitre: lecon.chapitre, titre: lecon.titre, ajoutee_le: lecon.added_at, ...pack, progression: lecons.progression(req.user.id, lecon.id) });
  });

  router.post('/cartes/:lecon/:carte', express.json({ limit: '1kb' }), (req, res) => {
    if (typeof req.body?.su !== 'boolean') throw new ErreurMetier('Le corps doit être {"su": true ou false}.');
    res.json(lecons.carteRevue(req.user.id, req.params.lecon, req.params.carte, req.body.su));
  });

  router.post('/quiz/:lecon', express.json({ limit: '1kb' }), (req, res) => {
    lecons.quizScore(req.user.id, req.params.lecon, req.body?.score, req.body?.total);
    res.json({ ok: true });
  });

  const limiteTri = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.limiteTri ?? 30, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `u${req.user.id}`, message: { erreur: 'Trop d\'envois, réessaie dans un moment.' },
  });
  router.post('/a-trier', limiteTri, async (req, res) => {
    const f = await lireUpload(req);
    const type = detecterType(f.buf, f.declare, f.nom);
    if (!type) throw new ErreurMetier('Format non accepté. Envoie une photo (jpeg, png, webp, heic), un PDF ou un fichier texte.', 415);
    const base = nettoyerNom(f.nom.replace(/\.[^.]*$/, ''), 'nom', 60);
    const nom = `${stamp()}-${base}.${type[1]}`;
    res.status(201).json(await comptes.seul(req.user.id, () => comptes.espace(req.user.id).envoyerATrier(nom, type[0], f.buf)));
  });

  router.get('/a-trier', async (req, res) => {
    res.json(await comptes.espace(req.user.id).listerATrier());
  });

  router.post('/compte/deconnecter-claude', (req, res) => {
    db.prepare('DELETE FROM tokens WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM auth_codes WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM consentements WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM consentements_attente WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  });

  router.delete('/compte', async (req, res) => {
    await google.revoquer(req.user.id);
    db.prepare('DELETE FROM users WHERE id=?').run(req.user.id); // supprime en cascade sessions, jetons, leçons, progression
    google.oublier(req.user.id);
    effacerCookie(res);
    res.json({ ok: true });
  });

  router.use((req, res) => res.status(404).json({ erreur: 'Introuvable.' }));
  router.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    if (e instanceof ErreurMetier) return res.status(e.status).json({ erreur: e.message });
    if (e instanceof ErreurGoogle) return res.status(502).json({ erreur: e.message });
    if (e?.type === 'entity.parse.failed' || e?.type === 'entity.too.large') return res.status(400).json({ erreur: 'Requête invalide.' });
    console.error('erreur api', e?.name);
    res.status(500).json({ erreur: 'Erreur inattendue.' });
  });
  return router;
}
