import fs from 'node:fs';
import path from 'node:path';
import { creerDrive } from '../drive/drive.js';
import { creerEspace, FICHIERS } from '../drive/espace.js';
import { creerVerrous } from '../lib/verrous.js';
import { lireCalendrier, controlesProches } from '../lib/calendrier.js';

export function chargerGabarits(dir) {
  return Object.fromEntries(FICHIERS.map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));
}

// Accès Drive et calendrier pour un compte.
export function creerComptes({ config, db, google, fetchFn }) {
  const verrou = creerVerrous();
  const templates = chargerGabarits(config.templatesDir);
  const TTL_CALENDRIER = 10 * 60 * 1000;

  function espace(userId) {
    const getToken = () => google.accessTokenPour(userId);
    getToken.invalider = () => google.oublier(userId);
    return creerEspace({ drive: creerDrive({ config, getToken, fetchFn }), templates });
  }
  const seul = (userId, fn) => verrou(String(userId), fn);

  function memoriserCalendrier(userId, contenu) {
    db.prepare('INSERT INTO calendrier (user_id,contenu,lu_le) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET contenu=excluded.contenu, lu_le=excluded.lu_le')
      .run(userId, contenu, Date.now());
  }

  async function calendrier(userId) {
    const c = db.prepare('SELECT contenu, lu_le FROM calendrier WHERE user_id=?').get(userId);
    if (c && Date.now() - c.lu_le < TTL_CALENDRIER) return c.contenu;
    try {
      const contenu = await espace(userId).lireCalendrier();
      memoriserCalendrier(userId, contenu);
      return contenu;
    } catch {
      return c?.contenu ?? '';
    }
  }

  async function controles(userId, jours = 14) {
    return controlesProches(lireCalendrier(await calendrier(userId)), config.today(), jours);
  }

  return { espace, seul, calendrier, controles, memoriserCalendrier };
}
