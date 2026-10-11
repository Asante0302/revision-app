// Faux serveur pour tester le site sans le vrai serveur. Aucune dépendance.
// Usage : node dev/mock-server.mjs   (PORT=8651 par défaut ; MOCK_GOOGLE=0 pour simuler « pas prêt » ;
//         MOCK_AUTH=1 pour être déjà connecté ; MOCK_VIDE=1 pour un compte sans cours)
// Toutes les données ci-dessous sont inventées.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const PORT = Number(process.env.PORT || 8651);
const GOOGLE = process.env.MOCK_GOOGLE !== '0';
const VIDE = process.env.MOCK_VIDE === '1';
let connecte = process.env.MOCK_AUTH === '1';

const CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

const jour = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const LECONS = {
  l1: {
    id: 'l1', matiere: 'Histoire', chapitre: 'La Révolution', titre: 'Les débuts de 1789',
    resume: 'En 1789, les États généraux se réunissent, le tiers état se proclame Assemblée nationale et la Bastille est prise.',
    fiche: '# Les débuts de 1789\n\n## Les États généraux\nIls sont réunis le **5 mai 1789** à Versailles.\n\n- Trois ordres : clergé, noblesse, tiers état\n- Le tiers état demande le vote par tête\n\n| Date | Événement |\n|---|---|\n| 17 juin | Assemblée nationale |\n| 14 juillet | Prise de la Bastille |\n\n> Une phrase à retenir.\n\n[Un lien](https://example.org)\n\n<script>alert(1)</script><img src=x onerror=alert(2)>',
    cartes: [
      { id: 'c0', q: 'Quand les États généraux se réunissent-ils ?', r: 'Le 5 mai 1789.' },
      { id: 'c1', q: 'Que prend-on le 14 juillet 1789 ?', r: 'La Bastille.' },
      { id: 'c2', q: 'Qui demande le vote par tête ?', r: 'Le tiers état.' }
    ],
    quiz: [
      { id: 'q0', question: 'Où se réunissent les États généraux ?', choix: ['Paris', 'Versailles', 'Lyon', 'Rouen'], bonne: 1, explication: 'Ils se réunissent au château de Versailles.' },
      { id: 'q1', question: 'Combien y a-t-il d’ordres ?', choix: ['Deux', 'Trois', 'Quatre', 'Cinq'], bonne: 1, explication: 'Clergé, noblesse et tiers état.' }
    ],
    exercices: [{ id: 'e0', enonce: 'Explique en **deux phrases** pourquoi le tiers état veut voter par tête.', corrige: 'Le tiers état est le plus nombreux. Voter par tête lui donne plus de poids.' }],
    lacunes: ['Le bas de la page 2 est flou.'],
    progression: { cartes: { c0: { boite: 3, prochaine: jour(5) } } }
  },
  l2: {
    id: 'l2', matiere: 'Maths', chapitre: 'Fractions', titre: 'Additionner des fractions',
    resume: 'Pour additionner, on met au même dénominateur.',
    fiche: '## Règle\nOn met les fractions au même dénominateur.', cartes: [{ id: 'c0', q: '1/2 + 1/4 = ?', r: '3/4' }],
    quiz: [], exercices: [], lacunes: [], progression: { cartes: { c0: { boite: 1, prochaine: jour(-1) } } }
  },
  l3: {
    id: 'l3', matiere: 'Maths', chapitre: 'Géométrie', titre: 'Le théorème de Pythagore',
    resume: 'Dans un triangle rectangle, a² + b² = c².', fiche: '## Énoncé\na² + b² = c²', cartes: [], quiz: [], exercices: [], lacunes: [], progression: { cartes: {} }
  }
};
const quizMeilleur = {};
const aTrier = [{ id: 'f1', nom: 'photo-exemple.jpg', type: 'image/jpeg', date: new Date().toISOString() }];

const resumeLecon = (l) => ({
  id: l.id, matiere: l.matiere, chapitre: l.chapitre, titre: l.titre, ajoutee_le: jour(-3),
  nb_cartes: l.cartes.length, nb_quiz: l.quiz.length, nb_exercices: l.exercices.length,
  cartes_dues: l.cartes.filter((c) => { const p = l.progression.cartes[c.id]; return !p || p.prochaine <= jour(0); }).length,
  meilleur_quiz: quizMeilleur[l.id] ?? null
});

function json(res, code, corps) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP });
  res.end(JSON.stringify(corps));
}
const lireCorps = (req) => new Promise((ok) => { const m = []; req.on('data', (c) => m.push(c)); req.on('end', () => ok(Buffer.concat(m))); });

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (m !== 'GET' && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { erreur: 'Origine refusée.' });
  if (p === '/api/statut') return json(res, 200, { google_pret: GOOGLE, places_libres: 7 });
  if (p === '/api/moi') {
    if (!connecte) return json(res, 401, { erreur: 'Non connecté.', google_pret: GOOGLE });
    return json(res, 200, { email: 'eleve.exemple@example.org', nom: 'Élève Exemple', connecteur_url: `http://${req.headers.host}/mcp`, google_pret: GOOGLE });
  }
  if (!connecte) return json(res, 401, { erreur: 'Non connecté.' });
  const tous = VIDE ? [] : Object.values(LECONS);
  if (p === '/api/aujourdhui' && m === 'GET') {
    if (VIDE) return json(res, 200, { controles: [], lecons: [] });
    return json(res, 200, {
      controles: [{ date: jour(3), matiere: 'Histoire', type: 'contrôle', sujet: 'La Révolution', dans_jours: 3 }, { date: jour(10), matiere: 'Maths', type: 'interro', sujet: 'Fractions', dans_jours: 10 }],
      lecons: [
        { id: 'l1', titre: LECONS.l1.titre, matiere: 'Histoire', chapitre: 'La Révolution', raison: 'controle', cartes_dues: 2 },
        { id: 'l2', titre: LECONS.l2.titre, matiere: 'Maths', chapitre: 'Fractions', raison: 'cartes_dues', cartes_dues: 1 },
        { id: 'l3', titre: LECONS.l3.titre, matiere: 'Maths', chapitre: 'Géométrie', raison: 'nouvelle', cartes_dues: 0 }
      ]
    });
  }
  if (p === '/api/lecons' && m === 'GET') return json(res, 200, tous.map(resumeLecon));
  let r;
  if ((r = p.match(/^\/api\/lecons\/([^/]+)$/)) && m === 'GET') {
    const l = LECONS[r[1]];
    return l && !VIDE ? json(res, 200, l) : json(res, 404, { erreur: 'Leçon introuvable.' });
  }
  if ((r = p.match(/^\/api\/cartes\/([^/]+)\/([^/]+)$/)) && m === 'POST') {
    const l = LECONS[r[1]]; if (!l) return json(res, 404, { erreur: 'Leçon introuvable.' });
    const c = JSON.parse((await lireCorps(req)).toString() || '{}');
    if (typeof c.su !== 'boolean') return json(res, 400, { erreur: 'Corps invalide.' });
    const avant = l.progression.cartes[r[2]]?.boite ?? 1;
    const boite = c.su ? Math.min(5, avant + 1) : 1;
    const prochaine = jour([0, 1, 3, 7, 14][boite - 1]);
    l.progression.cartes[r[2]] = { boite, prochaine };
    return json(res, 200, { boite, prochaine });
  }
  if ((r = p.match(/^\/api\/quiz\/([^/]+)$/)) && m === 'POST') {
    const c = JSON.parse((await lireCorps(req)).toString() || '{}');
    if (!Number.isInteger(c.score) || !Number.isInteger(c.total)) return json(res, 400, { erreur: 'Corps invalide.' });
    quizMeilleur[r[1]] = Math.max(quizMeilleur[r[1]] ?? 0, c.score);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/a-trier' && m === 'GET') return json(res, 200, VIDE ? [] : aTrier);
  if (p === '/api/a-trier' && m === 'POST') {
    const corps = await lireCorps(req);
    const nom = /filename="([^"]*)"/.exec(corps.toString('latin1', 0, Math.min(corps.length, 600)))?.[1] || 'fichier';
    if (!/multipart\/form-data/.test(req.headers['content-type'] || '')) return json(res, 400, { erreur: 'Envoi invalide.' });
    if (corps.length > 10 * 1024 * 1024) return json(res, 413, { erreur: 'Fichier trop gros.' });
    const f = { id: 'f' + (aTrier.length + 1), nom, taille: corps.length, type: 'inconnu', date: new Date().toISOString() };
    aTrier.push(f);
    return json(res, 200, { id: f.id, nom: f.nom });
  }
  if (p === '/api/compte' && m === 'DELETE') { connecte = false; return json(res, 200, { ok: true }); }
  return json(res, 404, { erreur: 'Introuvable.' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/auth/login') {
      if (!GOOGLE) return json(res, 503, { erreur: 'Connexion Google bientôt disponible.' });
      connecte = true; res.writeHead(302, { Location: '/' }); return res.end();
    }
    if (url.pathname === '/auth/logout' && req.method === 'POST') { connecte = false; return json(res, 200, { ok: true }); }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const fichier = path.resolve(RACINE, '.' + rel);
    if (!fichier.startsWith(RACINE + path.sep)) { res.writeHead(404); return res.end('Introuvable'); }
    const data = await readFile(fichier);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(500); res.end('Erreur');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Faux serveur sur http://127.0.0.1:${PORT}`));
