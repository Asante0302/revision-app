import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerBanc } from './aide/banc.js';
import { chiffrer } from '../src/lib/crypto.js';

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

test('DCR : redirection http non locale refusée, localhost accepté', async () => {
  const essai = (uri) => fetch(b.base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [uri], token_endpoint_auth_method: 'none' }) });
  assert.equal((await essai('http://exemple.org/cb')).status, 400);
  assert.equal((await essai('http://localhost:3000/cb')).status, 201);
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
  const r1 = await b.manuel(a);
  const r2 = await b.manuel(r1.headers.get('location'));
  const r3 = await b.manuel(r2.headers.get('location'));
  const code = new URL(r3.headers.get('location')).searchParams.get('code');
  const t = await fetch(b.base + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: 'y'.repeat(50), redirect_uri: 'https://claude.ai/api/mcp/auth_callback' }) });
  assert.equal(t.status, 400);
  assert.equal((await t.json()).error, 'invalid_grant');
});

test('state Google à usage unique ; refresh Google chiffré en base', async () => {
  const r1 = await b.manuel(b.base + '/auth/login');
  const r2 = await b.manuel(r1.headers.get('location'));
  const cb = r2.headers.get('location');
  assert.equal((await b.manuel(cb)).status, 302);
  assert.equal((await b.manuel(cb)).status, 400); // rejoué
  const u = b.db.prepare('SELECT refresh_enc FROM users').all();
  assert.ok(u.length >= 1);
  for (const x of u) { assert.match(x.refresh_enc, /^v1:/); assert.ok(!x.refresh_enc.includes('rt-')); }
  assert.ok(chiffrer(Buffer.alloc(32), 'x') !== chiffrer(Buffer.alloc(32), 'x'));
});
