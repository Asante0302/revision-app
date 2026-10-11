import { ErreurGoogle } from '../lib/erreurs.js';

export const DOSSIER = 'application/vnd.google-apps.folder';
const CHAMPS = 'id,name,mimeType,version,modifiedTime,createdTime,size,parents';

const echapper = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Client Drive v3 minimal, pour un compte (portée drive.file).
export function creerDrive({ config, getToken, fetchFn = fetch }) {
  const { driveUrl, uploadUrl } = config.google;

  async function appel(url, opts = {}, nouvelEssai = true) {
    const token = await getToken();
    const r = await fetchFn(url, {
      ...opts,
      headers: { ...(opts.headers ?? {}), authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (r.status === 401 && nouvelEssai) { getToken.invalider?.(); return appel(url, opts, false); }
    if (!r.ok) {
      await r.arrayBuffer().catch(() => {});
      throw new ErreurGoogle(r.status === 404 ? 'Fichier introuvable dans Google Drive.' : `Google Drive a répondu une erreur (${r.status}).`, r.status === 404 ? 404 : 502);
    }
    return r;
  }
  const json = async (url, opts) => (await appel(url, opts)).json();

  async function lister(parentId, { dossier, nom } = {}) {
    const q = [`'${echapper(parentId)}' in parents`, 'trashed=false'];
    if (nom) q.push(`name='${echapper(nom)}'`);
    if (dossier === true) q.push(`mimeType='${DOSSIER}'`);
    if (dossier === false) q.push(`mimeType!='${DOSSIER}'`);
    const sortie = [];
    let page;
    do {
      const u = new URL(driveUrl + '/files');
      u.search = new URLSearchParams({ q: q.join(' and '), fields: `nextPageToken,files(${CHAMPS})`, pageSize: '200', ...(page ? { pageToken: page } : {}) }).toString();
      const j = await json(u);
      sortie.push(...(j.files ?? []));
      page = j.nextPageToken;
    } while (page && sortie.length < 2000);
    return sortie;
  }

  const meta = (id) => json(`${driveUrl}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(CHAMPS)}`);

  const creerDossier = (nom, parentId) => json(`${driveUrl}/files?fields=${encodeURIComponent(CHAMPS)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: nom, mimeType: DOSSIER, parents: [parentId] }),
  });

  function creerFichier(nom, parentId, mimeType, contenu) {
    const bord = 'rev' + Math.random().toString(36).slice(2);
    const tete = Buffer.from(`--${bord}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nom, parents: [parentId], mimeType })}\r\n--${bord}\r\ncontent-type: ${mimeType}\r\n\r\n`);
    const corps = Buffer.concat([tete, Buffer.from(contenu), Buffer.from(`\r\n--${bord}--`)]);
    return json(`${uploadUrl}/files?uploadType=multipart&fields=${encodeURIComponent(CHAMPS)}`, {
      method: 'POST', headers: { 'content-type': `multipart/related; boundary=${bord}` }, body: corps,
    });
  }

  const remplacer = (id, mimeType, contenu) => json(`${uploadUrl}/files/${encodeURIComponent(id)}?uploadType=media&fields=${encodeURIComponent(CHAMPS)}`, {
    method: 'PATCH', headers: { 'content-type': mimeType }, body: Buffer.from(contenu),
  });

  async function telecharger(id) {
    const r = await appel(`${driveUrl}/files/${encodeURIComponent(id)}?alt=media`);
    return Buffer.from(await r.arrayBuffer());
  }

  const deplacer = (id, versId, depuisId) => json(`${driveUrl}/files/${encodeURIComponent(id)}?addParents=${encodeURIComponent(versId)}&removeParents=${encodeURIComponent(depuisId)}&fields=${encodeURIComponent(CHAMPS)}`, { method: 'PATCH' });

  return { lister, meta, creerDossier, creerFichier, remplacer, telecharger, deplacer };
}
