import net from 'node:net';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { chargerConfig } from '../../src/config.js';
import { creerApp } from '../../src/app.js';
import { demarrerFauxGoogle } from './faux-google.js';

const portLibre = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

export async function demarrerBanc({ maxUsers = 10, google = true, aujourdhui = '2026-10-12', env = {}, surcharges = {} } = {}) {
  const fg = await demarrerFauxGoogle();
  const port = await portLibre();
  const base = `http://127.0.0.1:${port}`;
  const config = chargerConfig({
    PORT: String(port), PUBLIC_URL: base, MAX_USERS: String(maxUsers), ...env,
    ...(google ? { GOOGLE_CLIENT_ID: 'client-test', GOOGLE_CLIENT_SECRET: 'secret-test', ENC_KEY: crypto.randomBytes(32).toString('base64') } : {}),
  }, { dbPath: ':memory:', silencieux: true, today: () => aujourdhui, limiteAuth: 1000, google: fg.config, ...surcharges });
  const inst = creerApp(config);
  const serveur = await new Promise((ok) => { const s = inst.app.listen(port, '127.0.0.1', () => ok(s)); });
  const manuel = (url, opts = {}) => fetch(url, { redirect: 'manual', ...opts });

  // Un navigateur avec ses cookies (seulement rev_etat, envoyé au callback Google comme le ferait un vrai navigateur).
  function navigateur() {
    const jar = new Map();
    return {
      jar,
      async manuel(url, opts = {}) {
        const u = new URL(url);
        const headers = { ...(opts.headers ?? {}) };
        if (u.pathname === '/auth/google/callback' && jar.has('rev_etat')) headers.cookie = `rev_etat=${jar.get('rev_etat')}`;
        const r = await manuel(url, { ...opts, headers });
        for (const c of r.headers.getSetCookie()) {
          const [nv] = c.split(';'); const i = nv.indexOf('=');
          if (nv.slice(0, i) === 'rev_etat') { if (/Max-Age=0/i.test(c)) jar.delete('rev_etat'); else jar.set('rev_etat', nv.slice(i + 1)); }
        }
        return r;
      },
    };
  }

  // Connexion Google côté site : retourne le cookie de session.
  async function connexionSite() {
    const n = navigateur();
    const r1 = await n.manuel(base + '/auth/login');
    const r2 = await n.manuel(r1.headers.get('location'));
    const r3 = await n.manuel(r2.headers.get('location'));
    return { statut: r3.status, cookie: (r3.headers.getSetCookie().find((c) => c.startsWith('rev_sess=')) ?? '').split(';')[0], corps: r3.status === 200 || r3.status >= 400 ? await r3.text() : '' };
  }

  // Parcours OAuth complet d'un client MCP (inscription, autorisation, jeton).
  async function connecterMcp({ redirect = 'https://claude.ai/api/mcp/auth_callback' } = {}) {
    const reg = await (await fetch(base + '/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
    })).json();
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const a = new URL(base + '/authorize');
    a.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'etat-client', resource: base + '/mcp' }).toString();
    const n = navigateur();
    const r1 = await n.manuel(a);
    const r2 = await n.manuel(r1.headers.get('location'));
    const r3 = await n.manuel(r2.headers.get('location'));
    const retour = new URL(r3.headers.get('location'));
    const code = retour.searchParams.get('code');
    const token = (params) => fetch(base + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: reg.client_id, ...params }) });
    const rt = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, resource: base + '/mcp' });
    return { reg, verifier, challenge, retour, code, token, reponseToken: rt, jetons: rt.ok ? await rt.clone().json() : null };
  }

  async function clientMcp(accessToken) {
    const c = new Client({ name: 'test', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
    const appeler = async (name, args = {}) => {
      const r = await c.callTool({ name, arguments: args });
      const t = r.content?.[0]?.type === 'text' ? r.content[0].text : null;
      let data = t; try { data = JSON.parse(t); } catch { /* texte */ }
      return { ...r, data };
    };
    return { c, appeler };
  }

  const api = (cookie, chemin, { method = 'GET', body, headers = {} } = {}) => fetch(base + '/api' + chemin, {
    method, headers: { cookie, ...(method !== 'GET' ? { origin: base } : {}), ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  return {
    base, fg, config, db: inst.db, manuel, navigateur, connexionSite, connecterMcp, clientMcp, api,
    async fermer() { await new Promise((ok) => { serveur.closeAllConnections(); serveur.close(ok); }); inst.close(); await fg.fermer(); },
  };
}

export const PACK = {
  resume: 'Résumé court.', fiche: '# Fiche\nTexte',
  cartes: [{ q: 'Capitale de la France ?', r: 'Paris' }, { q: '2+2 ?', r: '4' }],
  quiz: [{ question: 'Q ?', choix: ['a', 'b', 'c', 'd'], bonne: 1, explication: 'parce que' }],
  exercices: [{ enonce: 'Calcule 1+1', corrige: '2' }], lacunes: ['page 3 illisible'],
};
