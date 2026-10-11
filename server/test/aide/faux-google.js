import http from 'node:http';
import crypto from 'node:crypto';

// Faux Google local : points OAuth (auth, token, revoke) et Drive v3 utilisés par le serveur.
export async function demarrerFauxGoogle() {
  const etat = {
    prochainUtilisateur: { sub: 'sub-a', email: 'a@exemple.test', name: 'Alice' },
    codes: new Map(), refresh: new Map(), acces: new Map(), vus: new Set(),
    fichiers: new Map(), revoques: [], appelsDrive: 0,
    clientId: 'client-test',
  };
  let url = '';

  const lireCorps = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const meta = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, version: String(f.version), modifiedTime: f.modifiedTime, createdTime: f.createdTime, size: String(f.content.length), parents: f.parents });
  const proprietaire = (req) => etat.acces.get((req.headers.authorization ?? '').replace('Bearer ', ''));
  const nouveau = (user, nom, mimeType, parents, content) => {
    const f = { id: 'f' + crypto.randomBytes(5).toString('hex'), owner: user, name: nom, mimeType, parents, content, version: 1, createdTime: new Date().toISOString(), modifiedTime: new Date().toISOString() };
    etat.fichiers.set(f.id, f);
    return f;
  };
  const des = (s) => s.replace(/\\(['\\])/g, '$1');

  function multipart(corps, type) {
    const bord = '--' + /boundary=(.+)$/.exec(type)[1];
    const parts = []; let i = corps.indexOf(bord);
    while (i !== -1) {
      const suite = corps.indexOf(bord, i + bord.length);
      if (suite === -1) break;
      const bloc = corps.subarray(i + bord.length + 2, suite - 2);
      const sep = bloc.indexOf('\r\n\r\n');
      parts.push(bloc.subarray(sep + 4));
      i = suite;
    }
    return parts;
  }

  const serveur = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const corps = await lireCorps(req);
    // --- OAuth ---
    if (u.pathname === '/auth') {
      const code = crypto.randomBytes(8).toString('hex');
      etat.codes.set(code, { user: etat.prochainUtilisateur, consent: u.searchParams.get('prompt') === 'consent' });
      etat.dernierAuth = Object.fromEntries(u.searchParams);
      const r = new URL(u.searchParams.get('redirect_uri'));
      r.searchParams.set('code', code); r.searchParams.set('state', u.searchParams.get('state'));
      res.writeHead(302, { location: r.href }); return res.end();
    }
    if (u.pathname === '/token') {
      const p = new URLSearchParams(corps.toString());
      if (p.get('client_secret') !== 'secret-test' || p.get('client_id') !== etat.clientId) return json(res, 401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const c = etat.codes.get(p.get('code'));
        if (!c) return json(res, 400, { error: 'invalid_grant' });
        etat.codes.delete(p.get('code'));
        const acces = 'ya29.' + crypto.randomBytes(8).toString('hex');
        etat.acces.set(acces, c.user.sub);
        const out = { access_token: acces, expires_in: 3600, token_type: 'Bearer' };
        if (c.consent || !etat.vus.has(c.user.sub)) { out.refresh_token = 'rt-' + crypto.randomBytes(8).toString('hex'); etat.refresh.set(out.refresh_token, c.user.sub); }
        etat.vus.add(c.user.sub);
        const claims = { iss: 'https://accounts.google.com', aud: etat.clientId, sub: c.user.sub, email: c.user.email, name: c.user.name };
        out.id_token = ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
        return json(res, 200, out);
      }
      if (p.get('grant_type') === 'refresh_token') {
        const sub = etat.refresh.get(p.get('refresh_token'));
        if (!sub) return json(res, 400, { error: 'invalid_grant' });
        const acces = 'ya29.' + crypto.randomBytes(8).toString('hex');
        etat.acces.set(acces, sub);
        return json(res, 200, { access_token: acces, expires_in: 3600, token_type: 'Bearer' });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (u.pathname === '/revoke') {
      const t = new URLSearchParams(corps.toString()).get('token');
      etat.revoques.push(t); etat.refresh.delete(t);
      return json(res, 200, {});
    }
    // --- Drive ---
    const user = proprietaire(req);
    if (!user) return json(res, 401, { error: { message: 'unauthorized' } });
    etat.appelsDrive++;
    const chemin = u.pathname;
    const mes = [...etat.fichiers.values()].filter((f) => f.owner === user);
    if (req.method === 'GET' && chemin === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      const parent = /'((?:\\.|[^'\\])*)' in parents/.exec(q)?.[1];
      const nom = /(?:^| and )name='((?:\\.|[^'\\])*)'/.exec(q)?.[1];
      const dossier = / and mimeType='([^']+)'/.exec(q)?.[1];
      const pasDossier = / and mimeType!='([^']+)'/.exec(q)?.[1];
      const files = mes.filter((f) => f.parents.includes(des(parent)) && !f.trashed
        && (nom === undefined || f.name === des(nom)) && (!dossier || f.mimeType === dossier) && (!pasDossier || f.mimeType !== pasDossier));
      return json(res, 200, { files: files.map(meta) });
    }
    if (req.method === 'POST' && chemin === '/drive/v3/files') {
      const b = JSON.parse(corps.toString());
      return json(res, 200, meta(nouveau(user, b.name, b.mimeType, b.parents, Buffer.alloc(0))));
    }
    if (req.method === 'POST' && chemin === '/upload/drive/v3/files') {
      const [m, contenu] = multipart(corps, req.headers['content-type']);
      const b = JSON.parse(m.toString());
      return json(res, 200, meta(nouveau(user, b.name, b.mimeType, b.parents, Buffer.from(contenu))));
    }
    const m = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(chemin);
    if (m) {
      const f = etat.fichiers.get(decodeURIComponent(m[1]));
      if (!f || f.owner !== user) return json(res, 404, { error: { message: 'not found' } });
      if (req.method === 'GET' && u.searchParams.get('alt') === 'media') { res.writeHead(200, { 'content-type': f.mimeType }); return res.end(f.content); }
      if (req.method === 'GET') return json(res, 200, meta(f));
      if (req.method === 'PATCH' && chemin.startsWith('/upload')) { f.content = Buffer.from(corps); f.version++; f.modifiedTime = new Date().toISOString(); return json(res, 200, meta(f)); }
      if (req.method === 'PATCH') {
        f.parents = f.parents.filter((p) => p !== u.searchParams.get('removeParents')).concat(u.searchParams.get('addParents') ?? []);
        f.version++;
        return json(res, 200, meta(f));
      }
    }
    json(res, 404, { error: { message: 'route inconnue ' + req.method + ' ' + chemin } });
  });
  await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${serveur.address().port}`;
  return {
    etat, url,
    config: { authUrl: url + '/auth', tokenUrl: url + '/token', revokeUrl: url + '/revoke', driveUrl: url + '/drive/v3', uploadUrl: url + '/upload/drive/v3' },
    utilisateur: (sub, email, name) => { etat.prochainUtilisateur = { sub, email, name }; },
    fichiersDe: (sub) => [...etat.fichiers.values()].filter((f) => f.owner === sub),
    fermer: () => new Promise((ok) => { serveur.closeAllConnections(); serveur.close(ok); }),
  };
}
