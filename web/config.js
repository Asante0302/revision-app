/* Réglages faciles à corriger. Aucun secret ici : ce fichier est public. */

/* Adresse de contact pour les questions et la suppression de données.
   À remplir avant de publier (exigé par Google pour la page Confidentialité). */
window.CONTACT = 'https://github.com/Asante0302/revision-app/issues';

/* Libellés de claude.ai, à garder à jour si l'interface change.
   Une seule place à corriger : chaque ligne devient une étape dans la page Connecteur. */
window.CLAUDE_ETAPES = [
  'Sur ordinateur (l\u2019ajout ne se fait pas depuis le téléphone), ouvre claude.ai, puis « Customize » > « Connectors ».',
  'Clique « Add custom connector ».',
  'Si on te demande un nom, écris Révision. Dans « MCP server URL », colle l\u2019adresse copiée ci-dessus. Ne touche pas aux options avancées.',
  'Clique « Add », puis « Connect » et connecte-toi avec Google.',
  'Dans une conversation : bouton « + » en bas à gauche > « Connectors », et vérifie que Révision est activé. Ensuite, ça marche aussi dans l\u2019application Claude du téléphone.'
];
/* Vérifié le 11/10/2026 d'après la documentation d'Anthropic. Possible avec l'offre gratuite (un seul connecteur personnalisé), Pro ou Max. */

/* Phrase affichée après l'envoi d'un cours. */
window.PHRASE_RANGER = 'Range mes cours';
