import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerBanc, PACK } from './aide/banc.js';

let b, A, B;
before(async () => {
  b = await demarrerBanc();
  b.fg.utilisateur('sub-a', 'a@exemple.test', 'Alice');
  A = await b.clientMcp((await b.connecterMcp()).jetons.access_token);
  b.fg.utilisateur('sub-b', 'b@exemple.test', 'Bob');
  B = await b.clientMcp((await b.connecterMcp()).jetons.access_token);
});
after(async () => { await b.fermer(); });

test('neuf outils exposés', async () => {
  const { tools } = await A.c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['demarrer', 'ecrire_fichier', 'enregistrer_lecon', 'etat_revision', 'lire_a_trier', 'lire_fichier', 'lire_lecon', 'lister_a_trier', 'lister_lecons']);
});

test('fichiers : lecture, écriture, conflit de version, nom inconnu, taille', async () => {
  const d = await A.appeler('demarrer');
  const v0 = d.data.fichiers.find((f) => f.nom === 'Now.md').version;
  const l = await A.appeler('lire_fichier', { nom: 'Now.md' });
  assert.equal(l.data.version, v0);
  assert.match(l.data.contenu, /^# Now/);
  const w = await A.appeler('ecrire_fichier', { nom: 'Now.md', contenu: '# Now\nMaths', version: v0 });
  assert.ok(!w.isError);
  assert.notEqual(w.data.version, v0);
  const conflit = await A.appeler('ecrire_fichier', { nom: 'Now.md', contenu: 'autre', version: v0 });
  assert.equal(conflit.isError, true);
  assert.match(conflit.data, /modifié ailleurs/);
  assert.equal((await A.appeler('lire_fichier', { nom: 'Now' })).data.contenu, '# Now\nMaths'); // sans .md
  assert.equal((await A.appeler('lire_fichier', { nom: '../secret' })).isError, true);
  const gros = await A.appeler('ecrire_fichier', { nom: 'Now.md', contenu: 'x'.repeat(100 * 1024 + 1), version: w.data.version });
  assert.equal(gros.isError, true);
  assert.match(gros.data, /100 Ko/);
  // accueil_fait passe à vrai quand Pers.md n'a plus d'accolade
  const pv = (await A.appeler('lire_fichier', { nom: 'Pers.md' })).data.version;
  await A.appeler('ecrire_fichier', { nom: 'Pers.md', contenu: '# Pers\n- Prénom : Alice', version: pv });
  assert.equal((await A.appeler('demarrer')).data.accueil_fait, true);
  // demarrer est idempotent : pas de doublon dans le Drive
  assert.equal(b.fg.fichiersDe('sub-a').filter((f) => f.name === 'Pers.md').length, 1);
});

test('validation du pack : erreurs claires, rien d\'enregistré', async () => {
  const mauvais = [
    [{ ...PACK, resume: 'x'.repeat(601) }, /resume.*600/],
    [{ ...PACK, quiz: [{ question: 'Q', choix: ['a', 'b'], bonne: 0, explication: '' }] }, /quiz\[0\].*4 choix/],
    [{ ...PACK, quiz: [{ question: 'Q', choix: ['a', 'b', 'c', 'd'], bonne: 4, explication: '' }] }, /bonne/],
    [{ ...PACK, cartes: [{ q: 'seule' }] }, /cartes\[0\]/],
    [{ ...PACK, fiche: '' }, /fiche/],
    ['pas du json', /JSON/],
    [{ resume: 'r', fiche: 'f' }, /au moins une/],
  ];
  for (const [pack, re] of mauvais) {
    const r = await A.appeler('enregistrer_lecon', { matiere: 'Maths', chapitre: 'Algèbre', titre: 'Test', pack });
    assert.equal(r.isError, true);
    assert.match(r.data, re);
  }
  assert.equal((await A.appeler('lister_lecons')).data.length, 0);
});

test('enregistrer_lecon : identifiants, Drive, remplacement avec progression conservée', async () => {
  const r = await A.appeler('enregistrer_lecon', { matiere: 'Maths', chapitre: 'Algèbre / bases', titre: 'Équations', pack: PACK });
  assert.ok(r.data.id && r.data.lien.startsWith(b.base));
  const lu = await A.appeler('lire_lecon', { id: r.data.id });
  assert.deepEqual(lu.data.pack.cartes.map((c) => c.id), ['c0', 'c1']);
  assert.equal(lu.data.pack.quiz[0].id, 'q0');
  assert.equal(lu.data.pack.exercices[0].id, 'e0');
  const noms = b.fg.fichiersDe('sub-a').map((f) => f.name);
  assert.ok(noms.includes('Équations.json') && noms.includes('Algèbre bases') && noms.includes('Cours'));
  // progression sur la carte "2+2 ?" puis remplacement avec ordre inversé
  b.fg.utilisateur('sub-a', 'a@exemple.test', 'Alice');
  const cookie = (await b.connexionSite()).cookie;
  assert.equal((await b.api(cookie, `/cartes/${r.data.id}/c1`, { method: 'POST', body: { su: true } })).status, 200);
  const pack2 = { ...PACK, cartes: [{ q: 'Nouvelle ?', r: 'x' }, PACK.cartes[1]] };
  const r2 = await A.appeler('enregistrer_lecon', { matiere: 'Maths', chapitre: 'Algèbre / bases', titre: 'Équations', pack: pack2 });
  assert.equal(r2.data.id, r.data.id);
  assert.equal(r2.data.remplacee, true);
  assert.equal((await A.appeler('lister_lecons')).data.length, 1);
  const prog = await (await b.api(cookie, `/lecons/${r.data.id}`)).json();
  assert.deepEqual(prog.progression.cartes, { c1: { boite: 2, prochaine: '2026-10-13' } });
  assert.equal(b.fg.fichiersDe('sub-a').filter((f) => f.name === 'Équations.json').length, 1);
});

test('isolation : un compte ne lit jamais les données d\'un autre', async () => {
  const [la] = (await A.appeler('lister_lecons')).data;
  assert.ok(la);
  assert.equal((await B.appeler('lister_lecons')).data.length, 0);
  const vol = await B.appeler('lire_lecon', { id: la.id });
  assert.equal(vol.isError, true);
  assert.deepEqual((await B.appeler('etat_revision')).data.lecons, []);
  // fichiers : chaque compte a les siens
  await B.appeler('demarrer');
  const pb = await B.appeler('lire_fichier', { nom: 'Pers.md' });
  assert.match(pb.data.contenu, /\{prénom\}/); // gabarit de Bob, pas celui rempli d'Alice
  // API du site
  b.fg.utilisateur('sub-b', 'b@exemple.test', 'Bob');
  const cb = (await b.connexionSite()).cookie;
  assert.deepEqual(await (await b.api(cb, '/lecons')).json(), []);
  assert.equal((await b.api(cb, `/lecons/${la.id}`)).status, 404);
  assert.equal((await b.api(cb, `/cartes/${la.id}/c0`, { method: 'POST', body: { su: true } })).status, 404);
  assert.equal((await b.api(cb, `/quiz/${la.id}`, { method: 'POST', body: { score: 1, total: 1 } })).status, 404);
  // fichier de À trier d'un autre compte
  const env = new FormData();
  env.append('fichier', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'cours.pdf');
  b.fg.utilisateur('sub-a', 'a@exemple.test', 'Alice');
  const ca = (await b.connexionSite()).cookie;
  const up = await (await b.api(ca, '/a-trier', { method: 'POST', body: env })).json();
  assert.equal((await B.appeler('lire_a_trier', { id: up.id })).isError, true);
});

test('À trier : envoi depuis le site, liste, lecture image/texte/pdf, rangement avec la leçon', async () => {
  const ca = (await b.connexionSite()).cookie; // sub-a (dernier utilisateur choisi)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const envoi = async (buf, type, nom) => { const f = new FormData(); f.append('fichier', new Blob([buf], { type }), nom); return b.api(ca, '/a-trier', { method: 'POST', body: f }); };
  const r1 = await envoi(png, 'image/png', 'photo cours.png');
  assert.equal(r1.status, 201);
  const { id, nom } = await r1.json();
  assert.match(nom, /^\d{14}-photo cours\.png$/);
  const r2 = await envoi(Buffer.from('bonjour'), 'text/plain', 'notes.txt');
  assert.equal(r2.status, 201);
  assert.equal((await envoi(Buffer.from('MZ\x00\x00exe'), 'application/octet-stream', 'virus.exe')).status, 415);
  assert.equal((await envoi(Buffer.alloc(10 * 1024 * 1024 + 10, 1), 'image/png', 'gros.png')).status, 413);
  const liste = (await A.appeler('lister_a_trier')).data;
  assert.equal(liste.length, 3); // png, txt, et le pdf envoyé par le test d'isolation
  assert.equal((await (await b.api(ca, '/a-trier')).json()).length, 3);
  const pdf = liste.find((f) => f.type === 'application/pdf');
  const rp = await A.c.callTool({ name: 'lire_a_trier', arguments: { id: pdf.id } });
  assert.equal(rp.content[0].type, 'resource');
  assert.equal(rp.content[0].resource.mimeType, 'application/pdf');
  const img = await A.c.callTool({ name: 'lire_a_trier', arguments: { id } });
  assert.equal(img.content[0].type, 'image');
  assert.equal(img.content[0].mimeType, 'image/png');
  const txt = liste.find((f) => f.type === 'text/plain');
  assert.equal((await A.appeler('lire_a_trier', { id: txt.id })).data, 'bonjour');
  const l = await A.appeler('enregistrer_lecon', { matiere: 'Histoire', chapitre: 'Guerre', titre: 'Cours 1', pack: PACK, source_id: id });
  assert.equal(l.data.source_deplacee, true);
  assert.equal((await A.appeler('lister_a_trier')).data.length, 2);
  // un fichier hors de À trier n'est pas lisible par lire_a_trier
  const f = b.fg.fichiersDe('sub-a').find((x) => x.name === 'Cours 1.json');
  assert.equal((await A.appeler('lire_a_trier', { id: f.id })).isError, true);
});
