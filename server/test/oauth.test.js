import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerBanc } from './aide/banc.js';
import { chiffrer } from '../src/lib/crypto.js';
import { lireCookie } from '../src/oauth/connexion.js';

let b;
before(async () => { b = await demarrerBanc(); });
after(async () => { await b.fermer(); });

test('métadonnées : resource == PUBLIC_URL/mcp, S256, clients publics, pas de client_id_metadata_document', async () => {
  const as = await (await fetch(b.base + '/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.ok(as.token_endpoint_auth_methods_supported.includes('none'));
  assert.ok(as.registration_endpoint.endsWith('/register'));
  assert.equal(as.client_id_metadata_document_supported, undefined);
  assert.ok(as.grant_types_supported.includes('refresh_token'));
  for (const chemin of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    const pr = await (await fetch(b.base + chemin)).json();
    assert.equal(pr.resource, b.base + '/mcp');
    assert.ok(pr.authorization_servers.length === 1);
  }
});

test('/mcp sans jeton ou avec jeton faux : 401 et WWW-Authenticate', async () => {
  for (const h of [{}, { authorization: 'Bearer nimportequoi' }]) {
    const r = await fetch(b.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: '{}' });
    assert.equal(r.status, 401);
    const w = r.headers.get('www-authenticate');
    assert.match(w, /^Bearer /);
    assert.ok(w.includes(`resource_metadata="${b.base}/.well-known/oauth-protected-resource/mcp"`));
  }
});

test('/mcp refuse une Origin étrangère, même avec un jeton valide', async () => {
  const o = await b.connecterMcp();
  const r = await fetch(b.base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', authorization: `Bearer ${o.jetons.access_token}` }, body: '{}' });
  assert.equal(r.status, 403);
});

test('DCR : seules les redirections de Claude sont acceptées', async () => {
  const essai = (uri) => fetch(b.base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [uri], token_endpoint_auth_method: 'none' }) });
  assert.equal((await essai('http://exemple.org/cb')).status, 400);
  assert.equal((await essai('http://localhost:3000/cb')).status, 400);
  assert.equal((await essai('https://attaquant.example/cb')).status, 400);
  assert.equal((await essai('https://claude.ai/api/mcp/auth_callback/../autre')).status, 400);
  assert.equal((await essai('https://claude.ai/api/mcp/auth_callback')).status, 201);
  assert.equal((await essai('https://claude.com/api/mcp/auth_callback')).status, 201);
});

test('parcours complet : register, authorize, callback, token (form-urlencoded), outil, refresh avec rotation', async () => {
  b.fg.utilisateur('sub-a', 'a@exemple.test', 'Alice');
  const o = await b.connecterMcp();
  assert.equal(o.retour.searchParams.get('state'), 'etat-client');
  assert.ok(o.code);
  assert.equal(o.reponseToken.status, 200);
  assert.equal(o.jetons.token_type, 'Bearer');
  assert.equal(o.jetons.expires_in, 3600);
  assert.equal(b.fg.etat.dernierAuth.access_type, 'offline');
  assert.match(b.fg.etat.dernierAuth.scope, /drive\.file/);
  const { appeler } = await b.clientMcp(o.jetons.access_token);
  const d = await appeler('demarrer');
  assert.equal(d.data.fichiers.length, 9);
  assert.equal(d.data.accueil_fait, false);
  assert.match(d.data.agents, /Assistant de révision/);
  // rotation
  const r = await o.token({ grant_type: 'refresh_token', refresh_token: o.jetons.refresh_token });
  assert.equal(r.status, 200);
  const n = await r.json();
  assert.notEqual(n.refresh_token, o.jetons.refresh_token);
  assert.equal((await o.token({ grant_type: 'refresh_token', refresh_token: o.jetons.refresh_token })).status, 400);
  const c2 = await b.clientMcp(n.access_token);
  assert.equal((await c2.appeler('lister_lecons')).data.length, 0);
  // seuls les condensats sont stockés
  const lignes = b.db.prepare('SELECT hash FROM tokens').all().map((x) => x.hash);
  assert.ok(!lignes.includes(n.access_token) && !lignes.includes(n.refresh_token));
});

test('code à usage unique, PKCE vérifié, resource contrôlé', async () => {
  const o = await b.connecterMcp();
  const rejoue = await o.token({ grant_type: 'authorization_code', code: o.code, code_verifier: o.verifier, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
  assert.equal(rejoue.status, 400);
  // resource étranger à /authorize : redirection d'erreur
  const reg = await (await fetch(b.base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }) })).json();
  const a = new URL(b.base + '/authorize');
  a.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: 'https://autre.example/mcp' }).toString();
  const r = await b.manuel(a);
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).searchParams.get('error'), 'invalid_target');
  // PKCE obligatoire en S256
  a.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'abc', code_challenge_method: 'plain' }).toString();
  assert.match((await b.manuel(a)).headers.get('location'), /error=invalid_request/);
});

test('mauvais code_verifier refusé', async () => {
  const reg = await (await fetch(b.base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }) })).json();
  const a = new URL(b.base + '/authorize');
  a.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' }).toString();
  const n = b.navigateur();
  const r1 = await n.manuel(a);
  const r2 = await n.manuel(r1.headers.get('location'));
  let r3 = await n.manuel(r2.headers.get('location'));
  if (r3.status === 200) r3 = await n.decider(n.jetonConsentement(await r3.text()));
  const code = new URL(r3.headers.get('location')).searchParams.get('code');
  const t = await fetch(b.base + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: 'y'.repeat(50), redirect_uri: 'https://claude.ai/api/mcp/auth_callback' }) });
  assert.equal(t.status, 400);
  assert.equal((await t.json()).error, 'invalid_grant');
});

test('state Google à usage unique ; refresh Google chiffré en base', async () => {
  const n = b.navigateur();
  const r1 = await n.manuel(b.base + '/auth/login');
  const r2 = await n.manuel(r1.headers.get('location'));
  const cb = r2.headers.get('location');
  assert.equal((await n.manuel(cb)).status, 302);
  assert.equal((await n.manuel(cb)).status, 400); // rejoué
  const u = b.db.prepare('SELECT refresh_enc FROM users').all();
  assert.ok(u.length >= 1);
  for (const x of u) { assert.match(x.refresh_enc, /^v1:/); assert.ok(!x.refresh_enc.includes('rt-')); }
  assert.ok(chiffrer(Buffer.alloc(32), 'x') !== chiffrer(Buffer.alloc(32), 'x'));
});

test('DCR : redirection tierce refusée à /register, EXTRA_REDIRECT_URIS l\'autorise', async () => {
  const essai = (base, uri) => fetch(base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [uri], token_endpoint_auth_method: 'none' }) });
  const r = await essai(b.base, 'https://attaquant.example/cb');
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_client_metadata');
  assert.equal(b.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients WHERE json LIKE '%attaquant%'").get().n, 0);
  const b2 = await demarrerBanc({ env: { EXTRA_REDIRECT_URIS: 'http://localhost:3000/cb, https://test.example/cb' } });
  try {
    assert.equal((await essai(b2.base, 'http://localhost:3000/cb')).status, 201);
    assert.equal((await essai(b2.base, 'https://test.example/cb')).status, 201);
    assert.equal((await essai(b2.base, 'https://attaquant.example/cb')).status, 400);
  } finally { await b2.fermer(); }
});

test('éviction DCR : un client qui a des jetons vivants n\'est jamais supprimé', async () => {
  const o = await b.connecterMcp();
  const ins = b.db.prepare('INSERT INTO oauth_clients (client_id,json,created_at) VALUES (?,?,?)');
  for (let i = 0; i < 1005; i++) ins.run('spam' + i, '{}', 1);
  const { creerProvider } = await import('../src/oauth/provider.js');
  const p = creerProvider({ config: b.config, db: b.db, demarrerGoogle: () => {} });
  p.clientsStore.registerClient({ client_id: 'nouveau', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
  assert.ok(p.clientsStore.getClient(o.reg.client_id));
  assert.ok(p.clientsStore.getClient('nouveau'));
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get().n, 1000);
});

test('state Google lié au navigateur : sans le cookie rev_etat, « Lien invalide » et aucune session', async () => {
  const att = b.navigateur();
  const r1 = await att.manuel(b.base + '/auth/login');
  assert.match(r1.headers.get('set-cookie'), /rev_etat=[^;]+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax/);
  const urlPiege = (await att.manuel(r1.headers.get('location'))).headers.get('location');
  const victime = b.navigateur();
  const v = await victime.manuel(urlPiege);
  assert.equal(v.status, 400);
  assert.match(await v.text(), /Lien invalide/);
  assert.ok(!(v.headers.get('set-cookie') ?? '').includes('rev_sess'));
  // un autre cookie rev_etat ne convient pas non plus
  const r2 = await att.manuel(b.base + '/auth/login');
  const url2 = (await att.manuel(r2.headers.get('location'))).headers.get('location');
  const v2 = await b.manuel(url2, { headers: { cookie: 'rev_etat=autre' } });
  assert.equal(v2.status, 400);
  // le parcours MCP est protégé de la même façon
  const reg = await (await fetch(b.base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }) })).json();
  const a = new URL(b.base + '/authorize');
  a.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' }).toString();
  const m1 = await b.manuel(a);
  const m2 = await b.manuel(m1.headers.get('location'));
  const m3 = await b.manuel(m2.headers.get('location')); // sans cookie
  assert.equal(m3.status, 400);
  assert.ok(!(m3.headers.get('location') ?? ''));
});

// --- Page d'accord (confused deputy) ---
const CB = 'https://claude.ai/api/mcp/auth_callback';
async function demande(banc, reg, state = 'etat-x') {
  const a = new URL(banc.base + '/authorize');
  a.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CB, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state }).toString();
  const n = banc.navigateur();
  const r1 = await n.manuel(a);
  const r2 = await n.manuel(r1.headers.get('location'));
  return { n, r3: await n.manuel(r2.headers.get('location')) };
}
const enregistrer = async (banc) => (await fetch(banc.base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude <b>', redirect_uris: [CB], token_endpoint_auth_method: 'none' }) })).json();

test('accord : sans accord préalable la page s\'affiche et aucun code n\'est émis', async () => {
  const reg = await enregistrer(b);
  const { r3 } = await demande(b, reg);
  assert.equal(r3.status, 200);
  assert.equal(r3.headers.get('location'), null);
  const html = await r3.text();
  assert.match(html, /Autoriser Claude à accéder à ton espace Révision \?/);
  assert.match(html, /claude\.ai/);
  assert.match(html, /Claude &lt;b&gt;/);
  assert.ok(!html.includes('<b>') && !html.includes('—') && !/<style|style=|<script|onclick/i.test(html));
  assert.match(r3.headers.get('content-security-policy'), /style-src 'self'/);
  assert.match(r3.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(r3.headers.getSetCookie().join('|'), /rev_accord=[^;]+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax/);
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM auth_codes WHERE client_id=?').get(reg.client_id).n, 0);
});

test('accord : POST sans jeton, sans cookie ou depuis un autre navigateur refusé, jeton à usage unique', async () => {
  const reg = await enregistrer(b);
  const { n, r3 } = await demande(b, reg);
  const jeton = n.jetonConsentement(await r3.text());
  assert.equal((await n.decider(null)).status, 400);
  assert.equal((await b.navigateur().decider(jeton)).status, 400); // autre navigateur, sans cookie
  const autre = b.navigateur(); autre.jar.set('rev_accord', 'autre');
  assert.equal((await autre.decider(jeton)).status, 400); // autre cookie
  // le jeton est brûlé par les essais ci-dessus : le vrai navigateur doit en obtenir un nouveau
  assert.equal((await n.decider(jeton)).status, 400);
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM auth_codes WHERE client_id=?').get(reg.client_id).n, 0);
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM consentements WHERE client_id=?').get(reg.client_id).n, 0);
});

test('accord : Autoriser émet le code, mémorisé ; le deuxième passage se fait sans page ; jeton non rejouable', async () => {
  const reg = await enregistrer(b);
  const { n, r3 } = await demande(b, reg, 'S1');
  const jeton = n.jetonConsentement(await r3.text());
  const ok = await n.decider(jeton, 'autoriser');
  assert.equal(ok.status, 302);
  const l = new URL(ok.headers.get('location'));
  assert.equal(l.origin + l.pathname, CB);
  assert.ok(l.searchParams.get('code'));
  assert.equal(l.searchParams.get('state'), 'S1');
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM consentements WHERE client_id=?').get(reg.client_id).n, 1);
  const { r3: r3b } = await demande(b, reg, 'S2');
  assert.equal(r3b.status, 302);
  assert.ok(new URL(r3b.headers.get('location')).searchParams.get('code'));
  assert.equal((await n.decider(jeton, 'autoriser')).status, 400); // rejeu
  // un autre client doit passer par la page
  const reg2 = await enregistrer(b);
  assert.equal((await demande(b, reg2)).r3.status, 200);
});

test('accord : Refuser renvoie access_denied avec le state, sans code ni mémorisation', async () => {
  const reg = await enregistrer(b);
  const { n, r3 } = await demande(b, reg, 'S9');
  const r = await n.decider(n.jetonConsentement(await r3.text()), 'refuser');
  assert.equal(r.status, 302);
  const l = new URL(r.headers.get('location'));
  assert.equal(l.searchParams.get('error'), 'access_denied');
  assert.equal(l.searchParams.get('state'), 'S9');
  assert.ok(!l.searchParams.has('code'));
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM auth_codes WHERE client_id=?').get(reg.client_id).n, 0);
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM consentements WHERE client_id=?').get(reg.client_id).n, 0);
});

test('accord : « Déconnecter Claude » supprime aussi les accords', async () => {
  const o = await b.connecterMcp();
  assert.ok(b.db.prepare('SELECT COUNT(*) AS n FROM consentements WHERE client_id=?').get(o.reg.client_id).n >= 1);
  const { cookie } = await b.connexionSite();
  assert.equal((await b.api(cookie, '/compte/deconnecter-claude', { method: 'POST' })).status, 200);
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM consentements WHERE client_id=?').get(o.reg.client_id).n, 0);
  assert.equal((await demande(b, o.reg)).r3.status, 200); // la page revient
});

test('cookie d\'état : __Host- seulement en https (Secure, Path=/), nom simple en http local', async () => {
  const r = await b.manuel(b.base + '/auth/login');
  assert.match(r.headers.get('set-cookie'), /^rev_etat=/);
  assert.ok(!/Secure/.test(r.headers.get('set-cookie')));
  const h = await demarrerBanc({ surcharges: { publicUrl: 'https://revision.exemple.test' } });
  try {
    const c = (await h.manuel(h.base + '/auth/login')).headers.get('set-cookie');
    assert.match(c, /^__Host-rev_etat=[^;]+; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  } finally { await h.fermer(); }
});

test('cookies : lireCookie ignore un encodage invalide et refuse un nom répété', async () => {
  const req = (cookie) => ({ headers: { cookie } });
  assert.equal(lireCookie(req('rev_etat=%E0%A4%A'), 'rev_etat'), null);
  assert.equal(lireCookie(req('a=1; rev_etat=abc'), 'rev_etat'), 'abc');
  assert.equal(lireCookie(req('rev_etat=a; rev_etat=b'), 'rev_etat'), null);
  assert.equal(lireCookie(req('rev_etat=a; rev_etat=a'), 'rev_etat'), null);
  assert.equal(lireCookie({ headers: {} }, 'rev_etat'), null);
  const n = b.navigateur();
  const r1 = await n.manuel(b.base + '/auth/login');
  const cb = (await n.manuel(r1.headers.get('location'))).headers.get('location');
  assert.equal((await b.manuel(cb, { headers: { cookie: 'rev_etat=%E0%A4%A' } })).status, 400);
  const v = await b.manuel(cb, { headers: { cookie: `rev_etat=${n.jar.get('rev_etat')}; rev_etat=${'x'.repeat(43)}` } });
  assert.equal(v.status, 400);
  assert.ok(!(v.headers.getSetCookie().join('|')).includes('rev_sess=') || /rev_sess=;/.test(v.headers.getSetCookie().join('|')));
});

test('ALLOWED_EMAILS recontrôlé : jeton d\'accès, refresh et session du site ; e-mail non vérifié refusé', async () => {
  const bb = await demarrerBanc();
  try {
    bb.fg.utilisateur('sub-l', 'liste@exemple.test', 'Léa');
    const o = await bb.connecterMcp();
    const { cookie } = await bb.connexionSite();
    const mcp = () => fetch(bb.base + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + o.jetons.access_token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal((await bb.api(cookie, '/moi')).status, 200);
    assert.equal((await mcp()).status, 200);
    bb.config.emailsAutorises = new Set(['autre@exemple.test']);
    assert.equal((await mcp()).status, 401);
    assert.equal((await bb.api(cookie, '/moi')).status, 401);
    const rf = await o.token({ grant_type: 'refresh_token', refresh_token: o.jetons.refresh_token });
    assert.equal(rf.status, 400);
    assert.equal((await rf.json()).error, 'invalid_grant');
    bb.config.emailsAutorises = new Set(['LISTE@exemple.test'.toLowerCase()]);
    assert.equal((await mcp()).status, 200);
    bb.config.emailsAutorises = null;
    bb.fg.utilisateur('sub-nv', 'nv@exemple.test', 'Non vérifié', false);
    const nv = await bb.connexionSite();
    assert.equal(nv.statut, 403);
    assert.match(nv.corps, /non vérifié/);
    assert.equal(bb.db.prepare("SELECT COUNT(*) AS n FROM users WHERE sub='sub-nv'").get().n, 0);
  } finally { await bb.fermer(); }
});

test('éviction DCR : un client avec une autorisation en cours (state ou accord en attente) est épargné', async () => {
  const b = await demarrerBanc(); // /register est limité par IP : banc dédié
  try {
  const attente = await enregistrer(b);
  const au = new URL(b.base + '/authorize');
  au.search = new URLSearchParams({ response_type: 'code', client_id: attente.client_id, redirect_uri: CB, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' }).toString();
  await b.manuel(au); // state Google en attente
  const accord = await enregistrer(b);
  await demande(b, accord); // accord en attente
  b.db.prepare('UPDATE oauth_clients SET created_at=1 WHERE client_id IN (?,?)').run(attente.client_id, accord.client_id);
  const ins = b.db.prepare('INSERT INTO oauth_clients (client_id,json,created_at) VALUES (?,?,?)');
  for (let i = 0; i < 1005; i++) ins.run('spam-e' + i, '{}', 2);
  const { creerProvider } = await import('../src/oauth/provider.js');
  const p = creerProvider({ config: b.config, db: b.db, demarrerGoogle: () => {} });
  p.clientsStore.registerClient({ client_id: 'nouveau-e', redirect_uris: [CB] });
  assert.ok(p.clientsStore.getClient(attente.client_id));
  assert.ok(p.clientsStore.getClient(accord.client_id));
  assert.ok(p.clientsStore.getClient('nouveau-e'));
  } finally { await b.fermer(); }
});
