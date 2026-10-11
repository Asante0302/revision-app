import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerBanc, PACK } from './aide/banc.js';
import { lireCalendrier, controlesProches } from '../src/lib/calendrier.js';
import { apresReponse } from '../src/lib/leitner.js';
import { chargerConfig } from '../src/config.js';
import { FICHIERS } from '../src/drive/espace.js';

const ici = path.dirname(fileURLToPath(import.meta.url));

test('gabarits : les 9 fichiers sont identiques à la section « Les modèles » de ONBOARDING.md', () => {
  const md = fs.readFileSync(path.join(ici, '../../ONBOARDING.md'), 'utf8');
  const sec = md.slice(md.indexOf('## Les modèles'));
  assert.equal(FICHIERS.length, 9);
  for (const nom of FICHIERS) {
    const m = new RegExp(`### ${nom.replace('.', '\\.')}\\n\\n\`\`\`\`markdown\\n([\\s\\S]*?)\\n\`\`\`\``).exec(sec);
    assert.ok(m, nom);
    assert.equal(fs.readFileSync(path.join(ici, '../templates', nom), 'utf8'), m[1] + '\n', nom);
  }
});

test('Leitner : boîtes 1 à 5, intervalles 0, 1, 3, 7, 14 jours, raté = boîte 1', () => {
  let etat = apresReponse(1, true, '2026-10-12');
  assert.deepEqual(etat, { boite: 2, prochaine: '2026-10-13' });
  etat = apresReponse(etat.boite, true, '2026-10-13'); assert.deepEqual(etat, { boite: 3, prochaine: '2026-10-16' });
  etat = apresReponse(etat.boite, true, '2026-10-16'); assert.deepEqual(etat, { boite: 4, prochaine: '2026-10-23' });
  etat = apresReponse(etat.boite, true, '2026-10-23'); assert.deepEqual(etat, { boite: 5, prochaine: '2026-11-06' });
  etat = apresReponse(etat.boite, true, '2026-11-06'); assert.deepEqual(etat, { boite: 5, prochaine: '2026-11-20' });
  assert.deepEqual(apresReponse(4, false, '2026-10-12'), { boite: 1, prochaine: '2026-10-12' });
});

test('calendrier : lecture tolérante, lignes illisibles ignorées', () => {
  const texte = `# Calendrier

| Date | Matière | Type | Sujet |
|---|---|---|---|
| {JJ/MM/AAAA} | {matière} | {contrôle} | {sujet} |
|15/10/2026|  MATHS |Contrôle|Équations|
| 3.11.2026 | Français | oral | |
| 31/02/2026 | Maths | contrôle | date impossible |
| demain | Maths | contrôle | pas une date |
| 20-10-2026 | Histoire |
texte libre | 25/10/2026 | x | y | z |
`;
  const e = lireCalendrier(texte);
  assert.deepEqual(e.map((x) => [x.date, x.matiere]), [['2026-10-15', 'MATHS'], ['2026-11-03', 'Français'], ['2026-10-20', 'Histoire']]);
  const p = controlesProches(e, '2026-10-12', 14);
  assert.deepEqual(p.map((x) => x.dans_jours), [3, 8]);
});

test('Leitner et calendrier de bout en bout : API du site et etat_revision', async () => {
  const b = await demarrerBanc();
  try {
    const { jetons } = await b.connecterMcp();
    const { appeler } = await b.clientMcp(jetons.access_token);
    await appeler('demarrer');
    const cal = (await appeler('lire_fichier', { nom: 'Calendrier.md' })).data;
    await appeler('ecrire_fichier', { nom: 'Calendrier.md', version: cal.version, contenu: `# Calendrier\n\n| Date | Matière | Type | Sujet |\n|---|---|---|---|\n| 15/10/2026 | maths | contrôle | Équations |\n| 28/10/2026 | Anglais | oral | lointain |\n| ??? | x | y | z |\n| 01/10/2026 | Maths | contrôle | passé |\n` });
    const m = (await appeler('enregistrer_lecon', { matiere: 'Maths', chapitre: 'Algèbre', titre: 'Équations', pack: PACK })).data;
    const h = (await appeler('enregistrer_lecon', { matiere: 'Histoire', chapitre: 'XXe', titre: 'Guerres', pack: PACK })).data;
    const e = (await appeler('etat_revision')).data;
    assert.deepEqual(e.controles.map((c) => [c.matiere, c.dans_jours]), [['maths', 3]]);
    assert.equal(e.lecons.find((l) => l.id === m.id).cartes_dues, 2);

    const { cookie } = await b.connexionSite();
    let j = await (await b.api(cookie, '/aujourdhui')).json();
    assert.deepEqual(j.lecons.map((l) => [l.id, l.raison]), [[m.id, 'controle'], [h.id, 'nouvelle']]);
    assert.equal(j.controles[0].sujet, 'Équations');

    // Cartes : su -> boîte 2, prochaine demain ; raté -> boîte 1, due aujourd'hui
    let r = await (await b.api(cookie, `/cartes/${h.id}/c0`, { method: 'POST', body: { su: true } })).json();
    assert.deepEqual(r, { boite: 2, prochaine: '2026-10-13' });
    await b.api(cookie, `/cartes/${h.id}/c1`, { method: 'POST', body: { su: false } });
    r = await (await b.api(cookie, `/cartes/${h.id}/c0`, { method: 'POST', body: { su: true } })).json();
    assert.deepEqual(r, { boite: 3, prochaine: '2026-10-15' });
    j = await (await b.api(cookie, '/aujourdhui')).json();
    const hist = j.lecons.find((l) => l.id === h.id);
    assert.deepEqual([hist.raison, hist.cartes_dues], ['cartes_dues', 1]); // c1 ratée = due
    assert.equal((await b.api(cookie, `/cartes/${h.id}/c9`, { method: 'POST', body: { su: true } })).status, 404);
    assert.equal((await b.api(cookie, `/cartes/${h.id}/c0`, { method: 'POST', body: { su: 'oui' } })).status, 400);

    assert.equal((await b.api(cookie, `/quiz/${h.id}`, { method: 'POST', body: { score: 3, total: 5 } })).status, 200);
    await b.api(cookie, `/quiz/${h.id}`, { method: 'POST', body: { score: 4, total: 5 } });
    await b.api(cookie, `/quiz/${h.id}`, { method: 'POST', body: { score: 2, total: 5 } });
    assert.equal((await b.api(cookie, `/quiz/${h.id}`, { method: 'POST', body: { score: 9, total: 5 } })).status, 400);
    const liste = await (await b.api(cookie, '/lecons')).json();
    assert.deepEqual(liste.find((l) => l.id === h.id).meilleur_quiz, { score: 4, total: 5 });
    assert.equal(liste.find((l) => l.id === h.id).nb_cartes, 2);
    const e2 = (await appeler('etat_revision')).data.lecons.find((l) => l.id === h.id);
    assert.deepEqual(e2.boites, [1, 0, 1, 0, 0]);
    assert.ok(e2.derniere_seance);
  } finally { await b.fermer(); }
});

test('site : session par cookie, Origin exigée hors GET, déconnexion', async () => {
  const b = await demarrerBanc();
  try {
    const non = await fetch(b.base + '/api/moi');
    assert.equal(non.status, 401);
    assert.equal((await non.json()).google_pret, true);
    assert.equal((await (await fetch(b.base + '/api/statut')).json()).google_pret, true);
    const s = await b.connexionSite();
    assert.equal(s.statut, 302);
    const sc = (await b.manuel(b.base + '/auth/login')); // pour lire l'attribut du cookie
    assert.ok(sc.status === 302);
    const r = await fetch(b.base + '/api/moi', { headers: { cookie: s.cookie } });
    const moi = await r.json();
    assert.deepEqual(moi, { email: 'a@exemple.test', nom: 'Alice', connecteur_url: b.base + '/mcp', google_pret: true });
    // cookie : HttpOnly + SameSite=Lax (Secure seulement en https)
    const nav = b.navigateur();
    const r1 = await nav.manuel(b.base + '/auth/login'); const r2 = await nav.manuel(r1.headers.get('location')); const r3 = await nav.manuel(r2.headers.get('location'));
    assert.match(r3.headers.get('set-cookie'), /rev_sess=.+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax/);
    // Origin
    for (const headers of [{}, { origin: 'https://evil.example' }]) {
      const x = await fetch(b.base + '/api/quiz/l1', { method: 'POST', headers: { cookie: s.cookie, 'content-type': 'application/json', ...headers }, body: '{}' });
      assert.equal(x.status, 403);
    }
    assert.equal((await fetch(b.base + '/auth/logout', { method: 'POST', headers: { cookie: s.cookie } })).status, 403);
    const out = await fetch(b.base + '/auth/logout', { method: 'POST', headers: { cookie: s.cookie, origin: b.base } });
    assert.equal(out.status, 200);
    assert.equal((await fetch(b.base + '/api/moi', { headers: { cookie: s.cookie } })).status, 401);
  } finally { await b.fermer(); }
});

test('MAX_USERS : au-delà, page « Places complètes » ; un compte existant se reconnecte', async () => {
  const b = await demarrerBanc({ maxUsers: 1 });
  try {
    assert.equal((await b.connexionSite()).statut, 302);
    b.fg.utilisateur('sub-z', 'z@exemple.test', 'Zoé');
    const plein = await b.connexionSite();
    assert.equal(plein.statut, 403);
    assert.match(plein.corps, /Places complètes/);
    assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
    assert.equal((await (await fetch(b.base + '/api/statut')).json()).places_libres, false);
    b.fg.utilisateur('sub-a', 'a@exemple.test', 'Alice');
    assert.equal((await b.connexionSite()).statut, 302);
    // Autorisation MCP d'un nouveau compte refusée aussi
    b.fg.utilisateur('sub-z', 'z@exemple.test', 'Zoé');
    const o = await b.connecterMcp().catch((e) => e);
    assert.ok(o instanceof Error || !o.code);
  } finally { await b.fermer(); }
});

test('suppression de compte : données du serveur effacées, Drive intact, jeton Google révoqué, re-consentement', async () => {
  const b = await demarrerBanc();
  try {
    const o = await b.connecterMcp();
    const { appeler } = await b.clientMcp(o.jetons.access_token);
    await appeler('demarrer');
    await appeler('enregistrer_lecon', { matiere: 'M', chapitre: 'C', titre: 'T', pack: PACK });
    const { cookie } = await b.connexionSite();
    assert.equal((await b.api(cookie, '/compte', { method: 'DELETE', headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await b.api(cookie, '/compte', { method: 'DELETE' })).status, 200);
    for (const t of ['users', 'sessions', 'tokens', 'lecons', 'cartes', 'calendrier', 'auth_codes']) {
      assert.equal(b.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
    }
    assert.equal(b.fg.etat.revoques.length, 1);
    assert.ok(b.fg.fichiersDe('sub-a').length > 9); // le Drive reste à l'élève
    assert.equal((await fetch(b.base + '/api/moi', { headers: { cookie } })).status, 401);
    const r = await fetch(b.base + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${o.jetons.access_token}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401);
    // Reconnexion : Google ne redonne pas de refresh_token sans consentement, le serveur redemande prompt=consent
    const nav = b.navigateur();
    const r1 = await nav.manuel(b.base + '/auth/login');
    const r2 = await nav.manuel(r1.headers.get('location'));
    assert.equal(b.fg.etat.dernierAuth.prompt, undefined);
    const r3 = await nav.manuel(r2.headers.get('location')); // pas de refresh_token : retour vers Google avec consentement
    const r4 = await nav.manuel(r3.headers.get('location'));
    assert.equal(b.fg.etat.dernierAuth.prompt, 'consent');
    const r5 = await nav.manuel(r4.headers.get('location'));
    assert.equal(r5.headers.get('location'), '/');
    assert.match(r5.headers.get('set-cookie'), /rev_sess=/);
  } finally { await b.fermer(); }
});

test('sans GOOGLE_CLIENT_ID : démarre, métadonnées 200, /mcp et connexion en 503', async () => {
  const b = await demarrerBanc({ google: false });
  try {
    assert.equal((await fetch(b.base + '/.well-known/oauth-authorization-server')).status, 200);
    const m = await fetch(b.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(m.status, 503);
    assert.equal((await m.json()).error, 'service_unavailable');
    const l = await fetch(b.base + '/auth/login', { redirect: 'manual' });
    assert.equal(l.status, 503);
    assert.match(await l.text(), /bientôt disponible/);
    assert.equal((await (await fetch(b.base + '/api/statut')).json()).google_pret, false);
    assert.equal((await fetch(b.base + '/api/moi')).status, 401);
  } finally { await b.fermer(); }
});

test('jeton Google refusé (invalid_grant) : message de reconnexion, refresh effacé', async () => {
  const b = await demarrerBanc();
  try {
    const o = await b.connecterMcp();
    const { appeler } = await b.clientMcp(o.jetons.access_token);
    b.fg.etat.refresh.clear();
    const r = await appeler('demarrer');
    assert.equal(r.isError, true);
    assert.match(r.data, /reconnecte-toi/);
    assert.equal(b.db.prepare('SELECT refresh_enc FROM users').get().refresh_enc, null);
  } finally { await b.fermer(); }
});

test('Déconnecter Claude : supprime les jetons MCP du compte, Origin exigée', async () => {
  const b = await demarrerBanc();
  try {
    const o = await b.connecterMcp();
    const { cookie } = await b.connexionSite();
    assert.equal((await fetch(b.base + '/api/compte/deconnecter-claude', { method: 'POST', headers: { cookie } })).status, 403);
    assert.ok(b.db.prepare('SELECT COUNT(*) AS n FROM tokens').get().n >= 2);
    assert.equal((await b.api(cookie, '/compte/deconnecter-claude', { method: 'POST' })).status, 200);
    assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM tokens').get().n, 0);
    const r = await fetch(b.base + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${o.jetons.access_token}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401);
    assert.equal((await b.api(cookie, '/moi')).status, 200); // la session du site reste
  } finally { await b.fermer(); }
});

test('MAX_USERS invalide : erreur au démarrage', () => {
  for (const v of ['dix', '0', '-3', '2.5', '1e1']) assert.throws(() => chargerConfig({ MAX_USERS: v }, { dbPath: ':memory:' }), /MAX_USERS/, v);
  assert.equal(chargerConfig({ MAX_USERS: '3' }, { dbPath: ':memory:' }).maxUsers, 3);
  assert.equal(chargerConfig({}, { dbPath: ':memory:' }).maxUsers, 10);
});

test('ALLOWED_EMAILS : liste insensible à la casse, vide = ouvert, sinon refus poli', async () => {
  const b = await demarrerBanc({ env: { ALLOWED_EMAILS: ' A@Exemple.test, autre@exemple.test ' } });
  try {
    assert.equal((await b.connexionSite()).statut, 302);
    b.fg.utilisateur('sub-z', 'z@exemple.test', 'Zoé');
    const non = await b.connexionSite();
    assert.equal(non.statut, 403);
    assert.match(non.corps, /Ce compte n&#39;est pas invité|Ce compte n'est pas invité/);
    assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  } finally { await b.fermer(); }
  const ouvert = await demarrerBanc({ env: { ALLOWED_EMAILS: '' } });
  try {
    ouvert.fg.utilisateur('sub-z', 'z@exemple.test', 'Zoé');
    assert.equal((await ouvert.connexionSite()).statut, 302);
  } finally { await ouvert.fermer(); }
});

test('limites par compte : /api/a-trier et /mcp', async () => {
  const b = await demarrerBanc({ surcharges: { limiteTri: 2, limiteMcp: 3 } });
  try {
    const { cookie } = await b.connexionSite();
    const envoi = () => { const f = new FormData(); f.append('fichier', new Blob(['bonjour'], { type: 'text/plain' }), 'a.txt'); return b.api(cookie, '/a-trier', { method: 'POST', body: f }); };
    assert.equal((await envoi()).status, 201);
    assert.equal((await envoi()).status, 201);
    assert.equal((await envoi()).status, 429);
    const o = await b.connecterMcp();
    const appel = () => fetch(b.base + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${o.jetons.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await appel()).status);
    assert.equal(codes[3], 429);
    assert.notEqual(codes[0], 429);
  } finally { await b.fermer(); }
});
