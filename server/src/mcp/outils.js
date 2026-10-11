import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ErreurMetier, ErreurGoogle } from '../lib/erreurs.js';
import { nettoyerNom } from '../lib/noms.js';
import { validerPack } from '../lib/pack.js';
import { nomFichierValide, FICHIERS } from '../drive/espace.js';

const TAILLE_IMAGE_MAX = 5 * 1024 * 1024;

// Consignes lues par Claude à chaque conversation où le connecteur est actif.
export const INSTRUCTIONS = `Révision : l'espace de révision d'un élève, rangé dans son Google Drive.
1. Au début d'une conversation sur les cours ou la révision, appelle demarrer, puis suis AGENTS.md. Si accueil_fait est faux, fais d'abord l'accueil : questions une par une, puis ecrire_fichier pour chaque fichier rempli.
2. Parle en français, tutoie, phrases courtes, aucun mot technique. Une question à la fois.
3. « Range mes cours » : lister_a_trier, puis pour chaque fichier lire_a_trier, fabrique la leçon et appelle enregistrer_lecon avec source_id, puis mets Map.md à jour (lire_fichier puis ecrire_fichier). Un cours peut aussi arriver en photo ou en texte directement dans la conversation.
4. Fabriquer une leçon : reste fidèle au cours, n'invente aucun fait, aucune date, aucune formule. Ce qui est illisible ou manque va dans lacunes, pas dans la fiche. Fiche au format de Model.md et dans le style d'Exemple.md. 10 à 20 cartes, 5 à 10 questions de quiz (4 choix, une bonne réponse), 3 exercices du plus simple au plus dur. Pour une valeur raturée ou douteuse, ne devine pas : signale-la dans lacunes.
5. « Je veux réviser » : etat_revision, puis propose 1 à 3 leçons (contrôle proche d'abord, puis cartes dues), et le lien du site pour les cartes et le quiz.
6. Corriger : lire_lecon pour retrouver l'exercice et son corrigé, compare avec la réponse de l'élève, explique l'erreur simplement, sans donner la solution avant qu'il ait essayé.
7. Après une séance, propose de mettre à jour Now.md, Todo.md et Note.md. Ne demande jamais de nom de famille, d'établissement, d'adresse ou de mot de passe.`;
const texte = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const echec = (m) => ({ isError: true, content: [{ type: 'text', text: m }] });

// Construit un serveur MCP lié à un compte : aucun outil ne reçoit d'identifiant de compte.
export function creerServeurMcp({ config, userId, comptes, lecons }) {
  const server = new McpServer({ name: 'revision', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const espace = () => comptes.espace(userId);

  const outil = (nom, description, schema, lecture, fn) => server.registerTool(nom, {
    description,
    inputSchema: schema,
    annotations: { readOnlyHint: lecture, openWorldHint: false },
  }, async (args) => {
    try {
      return await fn(args ?? {});
    } catch (e) {
      if (e instanceof ErreurMetier) return echec(e.message);
      if (e instanceof ErreurGoogle) return echec(`${e.message} Réessaie dans un instant.`);
      console.error('erreur outil', nom, e?.name);
      return echec('Une erreur inattendue est survenue. Réessaie dans un instant.');
    }
  });

  outil('demarrer',
    'À appeler en premier. Crée le dossier « Révision » dans le Google Drive de l\'élève et les 9 fichiers de base s\'ils manquent. Rend la liste des fichiers avec leur version, le contenu d\'AGENTS.md (tes consignes : lis-le et suis-le), accueil_fait (faux = Pers.md est encore le modèle vide : fais d\'abord l\'accueil en posant les questions une par une) et l\'adresse du site de révision.',
    {}, false,
    () => comptes.seul(userId, async () => {
      const r = await espace().demarrer();
      return texte({ ...r, site: config.publicUrl });
    }));

  outil('lire_fichier',
    `Lit un des fichiers de l'élève (${FICHIERS.join(', ')}). Rend le contenu et la version à donner à ecrire_fichier.`,
    { nom: z.string().describe('Nom du fichier, par exemple Pers.md') }, true,
    async ({ nom }) => texte(await espace().lireFichier(nomFichierValide(nom))));

  outil('ecrire_fichier',
    'Remplace entièrement un des 9 fichiers. Donne la version obtenue à la dernière lecture : si le fichier a changé entre-temps, l\'écriture est refusée et tu dois le relire. 100 Ko au maximum. Rend la nouvelle version.',
    {
      nom: z.string().describe('Nom du fichier, par exemple Now.md'),
      contenu: z.string().describe('Nouveau contenu complet du fichier'),
      version: z.string().describe('Version lue avec lire_fichier ou demarrer'),
    }, false,
    ({ nom, contenu, version }) => comptes.seul(userId, async () => {
      const n = nomFichierValide(nom);
      const r = await espace().ecrireFichier(n, contenu, version);
      if (n === 'Calendrier.md') comptes.memoriserCalendrier(userId, contenu);
      return texte(r);
    }));

  outil('lister_a_trier',
    'Liste les photos et fichiers que l\'élève a envoyés depuis le site dans le dossier « À trier » (id, nom, type, date).',
    {}, true,
    async () => texte(await espace().listerATrier()));

  outil('lire_a_trier',
    'Ouvre un fichier du dossier « À trier » : une image (tu la vois), un texte, ou un PDF.',
    { id: z.string().describe('Identifiant donné par lister_a_trier') }, true,
    async ({ id }) => {
      const { meta, donnees } = await espace().lireATrier(id);
      const type = meta.mimeType;
      if (type === 'application/pdf') {
        return { content: [{ type: 'resource', resource: { uri: `revision://a-trier/${encodeURIComponent(meta.id)}`, mimeType: type, blob: donnees.toString('base64') } }] };
      }
      if (type.startsWith('text/')) return texte(donnees.toString('utf8').slice(0, 100_000));
      if (['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
        if (donnees.length > TAILLE_IMAGE_MAX) return echec('Cette image est trop lourde pour que je la lise (5 Mo au maximum). Demande à l\'élève de la renvoyer en plus petit.');
        return { content: [{ type: 'image', data: donnees.toString('base64'), mimeType: type }] };
      }
      return echec(`Ce format (${type}) ne peut pas être lu. Demande à l'élève de renvoyer une photo en JPEG ou PNG.`);
    });

  outil('enregistrer_lecon',
    'Enregistre une leçon préparée : la fiche, les cartes, le quiz et les exercices. Elle apparaît sur le site de l\'élève. Réenregistrer une leçon de même titre au même endroit la remplace et garde la progression des cartes dont la question est identique. Rend l\'id de la leçon et son lien.',
    {
      matiere: z.string().describe('Matière, par exemple Histoire'),
      chapitre: z.string().describe('Chapitre, par exemple La Révolution française'),
      titre: z.string().describe('Titre de la leçon'),
      pack: z.any().describe('Objet : {resume (600 caractères max), fiche (markdown), cartes:[{q,r}], quiz:[{question, choix:[4 textes], bonne:0 à 3, explication}], exercices:[{enonce, corrige}], lacunes:[passages illisibles ou manquants]}'),
      source_id: z.string().optional().describe('Identifiant du fichier de « À trier » à ranger avec la leçon'),
    }, false,
    ({ matiere, chapitre, titre, pack, source_id }) => comptes.seul(userId, async () => {
      const m = nettoyerNom(matiere, 'matiere');
      const c = nettoyerNom(chapitre, 'chapitre');
      const t = nettoyerNom(titre, 'titre', 120);
      const p = validerPack(pack);
      const { fileId, sourceDeplacee } = await espace().ecrireLecon(m, c, t, JSON.stringify(p, null, 1), source_id);
      const { id, remplacee } = lecons.enregistrer(userId, { matiere: m, chapitre: c, titre: t, pack: p, fileId });
      return texte({
        id, remplacee, lien: `${config.publicUrl}/#/lecon/${id}`,
        ...(source_id ? { source_deplacee: sourceDeplacee } : {}),
      });
    }));

  outil('lister_lecons', 'Liste les leçons enregistrées (id, matière, chapitre, titre, date).', {}, true,
    async () => texte(lecons.etatToutes(userId).map((l) => ({ id: l.id, matiere: l.matiere, chapitre: l.chapitre, titre: l.titre, date: l.added_at }))));

  outil('lire_lecon', 'Rend le pack complet d\'une leçon (fiche, cartes, quiz, exercices, lacunes).',
    { id: z.string().describe('Identifiant de la leçon') }, true,
    async ({ id }) => {
      const { lecon, pack } = lecons.lire(userId, id);
      return texte({ id: lecon.id, matiere: lecon.matiere, chapitre: lecon.chapitre, titre: lecon.titre, pack });
    });

  outil('etat_revision',
    'État de la révision : pour chaque leçon, les cartes dues, le nombre de cartes par boîte (1 à 5), le meilleur quiz et la dernière séance ; plus les contrôles des 14 prochains jours lus dans Calendrier.md. Sers-t\'en pour dire quoi réviser aujourd\'hui.',
    {}, true,
    async () => {
      const controles = await comptes.controles(userId, 14);
      return texte({
        lecons: lecons.etatToutes(userId).map((l) => ({
          id: l.id, matiere: l.matiere, chapitre: l.chapitre, titre: l.titre,
          cartes_dues: l.cartes_dues, boites: l.boites, meilleur_quiz: l.meilleur_quiz, derniere_seance: l.derniere_seance,
        })),
        controles,
      });
    });

  return server;
}
