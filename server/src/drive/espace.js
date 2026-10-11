import { DOSSIER } from './drive.js';
import { ErreurMetier } from '../lib/erreurs.js';
import { nettoyerNom, normaliser } from '../lib/noms.js';

export const FICHIERS = ['AGENTS.md', 'Pers.md', 'Map.md', 'Calendrier.md', 'Note.md', 'Now.md', 'Todo.md', 'Exemple.md', 'Model.md'];
export const TAILLE_MAX_FICHIER = 100 * 1024;
export const NOM_RACINE = 'Révision';
export const NOM_A_TRIER = 'À trier';

export function nomFichierValide(nom) {
  let n = String(nom ?? '').trim();
  if (n && !/\.md$/i.test(n)) n += '.md';
  const trouve = FICHIERS.find((f) => normaliser(f) === normaliser(n));
  if (!trouve) throw new ErreurMetier(`Fichier inconnu : « ${nom} ». Les fichiers possibles sont : ${FICHIERS.join(', ')}.`);
  return trouve;
}

// L'espace Révision/ dans le Drive d'un élève.
export function creerEspace({ drive, templates }) {
  async function dossier(nom, parentId, creer = true) {
    const [existant] = await drive.lister(parentId, { dossier: true, nom });
    if (existant) return existant.id;
    if (!creer) return null;
    return (await drive.creerDossier(nom, parentId)).id;
  }
  const racine = (creer = true) => dossier(NOM_RACINE, 'root', creer);
  async function aTrier(creer = true) {
    const r = await racine(creer);
    return r ? dossier(NOM_A_TRIER, r, creer) : null;
  }
  async function fichierRacine(nom) {
    const r = await racine(false);
    if (!r) return null;
    const [f] = await drive.lister(r, { dossier: false, nom });
    return f ?? null;
  }

  return {
    async demarrer() {
      const r = await racine(true);
      await aTrier(true);
      await dossier('Cours', r, true);
      const presents = new Map((await drive.lister(r, { dossier: false })).map((f) => [f.name, f]));
      for (const nom of FICHIERS) {
        if (!presents.has(nom)) presents.set(nom, await drive.creerFichier(nom, r, 'text/markdown', templates[nom]));
      }
      const fichiers = FICHIERS.map((nom) => ({ nom, version: String(presents.get(nom).version) }));
      const agents = (await drive.telecharger(presents.get('AGENTS.md').id)).toString('utf8');
      const pers = (await drive.telecharger(presents.get('Pers.md').id)).toString('utf8');
      return { fichiers, agents, accueil_fait: !pers.includes('{') };
    },

    async lireFichier(nom) {
      const f = await fichierRacine(nom);
      if (!f) throw new ErreurMetier(`« ${nom} » n'existe pas encore. Appelle d'abord l'outil demarrer.`, 404);
      return { contenu: (await drive.telecharger(f.id)).toString('utf8'), version: String(f.version) };
    },

    async ecrireFichier(nom, contenu, version) {
      if (typeof contenu !== 'string') throw new ErreurMetier('Le contenu doit être un texte.');
      if (Buffer.byteLength(contenu) > TAILLE_MAX_FICHIER) throw new ErreurMetier('Fichier trop gros : 100 Ko au maximum.', 413);
      const f = await fichierRacine(nom);
      if (!f) throw new ErreurMetier(`« ${nom} » n'existe pas encore. Appelle d'abord l'outil demarrer.`, 404);
      if (String(f.version) !== String(version)) {
        throw new ErreurMetier(`« ${nom} » a été modifié ailleurs depuis ta lecture. Relis le fichier avec lire_fichier, puis refais ta modification.`, 409);
      }
      const maj = await drive.remplacer(f.id, 'text/markdown', contenu);
      return { version: String(maj.version) };
    },

    async listerATrier() {
      const id = await aTrier(false);
      if (!id) return [];
      return (await drive.lister(id, { dossier: false }))
        .map((f) => ({ id: f.id, nom: f.name, type: f.mimeType, date: f.createdTime ?? f.modifiedTime }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    },

    async fichierATrier(id) {
      const dossierId = await aTrier(false);
      const m = await drive.meta(id).catch(() => null);
      if (!dossierId || !m || m.mimeType === DOSSIER || !(m.parents ?? []).includes(dossierId)) {
        throw new ErreurMetier('Fichier introuvable dans « À trier ».', 404);
      }
      return m;
    },

    async lireATrier(id) {
      const m = await this.fichierATrier(id);
      return { meta: m, donnees: await drive.telecharger(id) };
    },

    async envoyerATrier(nom, mimeType, donnees) {
      const dossierId = await aTrier(true);
      const f = await drive.creerFichier(nom, dossierId, mimeType, donnees);
      return { id: f.id, nom: f.name };
    },

    async ecrireLecon(matiere, chapitre, titre, contenu, sourceId) {
      const r = await racine(true);
      const cours = await dossier('Cours', r, true);
      const dm = await dossier(matiere, cours, true);
      const dc = await dossier(chapitre, dm, true);
      const nom = `${titre}.json`;
      const [existant] = await drive.lister(dc, { dossier: false, nom });
      const f = existant ? await drive.remplacer(existant.id, 'application/json', contenu) : await drive.creerFichier(nom, dc, 'application/json', contenu);
      let sourceDeplacee = null;
      if (sourceId) {
        try {
          const m = await this.fichierATrier(sourceId);
          await drive.deplacer(sourceId, dc, (m.parents ?? [])[0]);
          sourceDeplacee = true;
        } catch { sourceDeplacee = false; }
      }
      return { fileId: existant?.id ?? f.id, sourceDeplacee };
    },

    async lireCalendrier() {
      const f = await fichierRacine('Calendrier.md');
      return f ? (await drive.telecharger(f.id)).toString('utf8') : '';
    },
  };
}
export { nettoyerNom };
