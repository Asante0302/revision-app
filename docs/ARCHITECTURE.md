# Architecture

Révision est un assistant de révision pour un petit groupe d'élèves (10 comptes au plus par instance). Chaque élève utilise son propre abonnement Claude. Le serveur ne fait **aucun appel d'IA** : c'est Claude, dans claude.ai, qui lit les cours et fabrique les fiches, puis les enregistre par le connecteur.

## Vue d'ensemble

```
claude.ai (abonnement de l'élève)
   │  connecteur MCP distant (Streamable HTTP, OAuth 2.1 + PKCE + DCR)
   ▼
revision.funnelforge.fr  ── un seul processus Node 22 (127.0.0.1:8650, derrière Apache)
   ├─ /mcp                 outils MCP (par élève)
   ├─ OAuth                serveur d'autorisation pour claude.ai, connexion déléguée à Google
   ├─ /api/*               API du site (session par cookie)
   ├─ /                    site de révision mobile (PWA statique, dossier web/)
   └─ SQLite               comptes, jetons, cache des leçons, progression
         │
         ▼
Google Drive de l'élève (portée drive.file : le serveur ne voit que ce qu'il a créé)
   Révision/
     AGENTS.md Pers.md Map.md Calendrier.md Note.md Now.md Todo.md Exemple.md Model.md
     À trier/                       photos et fichiers envoyés depuis le site
     Cours/<Matière>/<Chapitre>/<Titre>.json   (+ fichier source déplacé)
```

Source de vérité du contenu : le Drive de l'élève. Le serveur garde un cache des leçons (pour le site) et la progression.

## Dépôt

```
server/        code Node (ESM), tests node:test
  src/         app.js (Express), oauth/, mcp/, api/, drive/, db/, lib/
  test/        tests, Google simulé (aucun appel réseau réel en test)
  templates/   les 9 gabarits Md (mêmes contenus que ONBOARDING.md)
web/           site statique (HTML, CSS, JS sans framework), vendor/ pour les libs
deploy/        modèles : vhost Apache, unité systemd, exemple d'env, scripts
docs/          ce fichier, guide d'hébergement
```

Variables d'environnement (fichier `/var/lib/revision-app/env`, 600, jamais dans git) :
`PORT=8650`, `PUBLIC_URL=https://revision.funnelforge.fr`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENC_KEY` (32 octets en base64, chiffre les jetons Google), `DATA_DIR=/var/lib/revision-app`, `MAX_USERS=10` (entier supérieur ou égal à 1, sinon le serveur refuse de démarrer), `ALLOWED_EMAILS` (facultatif : comptes Google invités, séparés par des virgules, sans distinction de majuscules ; vide = ouvert à tous dans la limite de `MAX_USERS` ; sinon « Ce compte n'est pas invité »), `EXTRA_REDIRECT_URIS` (facultatif, tests : redirections OAuth en plus de celles de claude.ai et claude.com).
Sans `GOOGLE_CLIENT_ID`, le serveur démarre quand même : le site affiche « Connexion Google bientôt disponible » et `/mcp` répond 503 propre.

## Connexion

Un seul client OAuth Google (type « Application Web »), redirection `PUBLIC_URL/auth/google/callback`, portées `openid email profile https://www.googleapis.com/auth/drive.file`, `access_type=offline`, `prompt=consent` à la première connexion. Le paramètre `state` (aléatoire, à usage unique, 10 min) est lié au navigateur par le cookie `__Host-rev_etat` (HttpOnly, Secure, SameSite=Lax, `Path=/`, sans `Domain`, 10 min), dont le condensat est gardé avec le state ; sans égalité au retour, page « Lien invalide » avant tout échange de code. Le préfixe `__Host-` n'étant valable qu'avec `Secure`, il n'est posé que si `PUBLIC_URL` est en https ; en http local de test, le cookie s'appelle `rev_etat` (sans `Secure`, même chemin). Si le cookie est présent plusieurs fois sous le même nom ou mal encodé, il est refusé (`lireCookie` rend null, jamais d'erreur 500). Le state dit si la connexion vient du site ou d'une autorisation MCP en attente.

À la connexion, Google doit confirmer l'adresse (`email_verified` vrai), sinon page « E-mail non vérifié ». `ALLOWED_EMAILS` (si non vide) est recontrôlé à chaque usage : lecture de session du site (401), jeton d'accès MCP (401), échange de code et rafraîchissement (`invalid_grant`).

### Accord de l'élève (page de consentement)

Pour une autorisation MCP, aucun code ne part chez Claude sans accord explicite (spec MCP Security Best Practices, « Confused Deputy »). Ordre : `/authorize` puis Google (identifie l'élève), puis, au retour de Google, si le couple (compte, `client_id`) n'a pas déjà un accord (table `consentements`), l'application sert la page « Autoriser Claude à accéder à ton espace Révision ? » (nom du client, hôte de redirection, ce que ça permet, boutons Autoriser et Refuser). Elle respecte la CSP stricte (feuille `/style.css`, aucun inline, `frame-ancestors 'none'`). La validation est un `POST /auth/consentement` : jeton caché à usage unique (10 min, condensat en base dans `consentements_attente`) lié au navigateur par le cookie `__Host-rev_accord` (mêmes attributs que `__Host-rev_etat`, `rev_accord` en http local). Sans jeton, sans cookie ou avec le cookie d'un autre navigateur : « Lien invalide », aucun code. Autoriser mémorise l'accord et redirige avec le code ; Refuser redirige vers le `redirect_uri` avec `error=access_denied` et le `state`, sans rien mémoriser. Les accords sont supprimés par « Déconnecter Claude » (`POST /api/compte/deconnecter-claude`), par la suppression du compte (cascade) et à l'éviction du client.

Compte : clé = `sub` Google. Création au premier passage si moins de `MAX_USERS` comptes, sinon page « Places complètes ». Le jeton de rafraîchissement Google est chiffré (AES-256-GCM, `ENC_KEY`).

### Serveur d'autorisation pour claude.ai

Émetteur `PUBLIC_URL`. Métadonnées : `/.well-known/oauth-authorization-server` et `/.well-known/oauth-protected-resource` (et `/.well-known/oauth-protected-resource/mcp`). Enregistrement dynamique `/register` (redirections acceptées : `https://claude.ai/api/mcp/auth_callback` et `https://claude.com/api/mcp/auth_callback`, plus `EXTRA_REDIRECT_URIS` ; un client qui a des jetons, un code ou une autorisation en cours (state Google ou accord en attente) n'est jamais évincé). `/authorize` exige PKCE S256, garde la demande, envoie vers Google, puis, après l'accord de l'élève, rend un code (usage unique, 5 min) au `redirect_uri`. `/token` : `authorization_code` et `refresh_token` (rotation). Jeton d'accès opaque 1 h, rafraîchissement 30 jours glissants ; seuls les condensats SHA-256 sont stockés. `/mcp` sans jeton valide : 401 avec `WWW-Authenticate: Bearer resource_metadata="…"`.
Utiliser les briques du SDK officiel `@modelcontextprotocol/sdk` quand elles existent (routeur d'autorisation, transport Streamable HTTP).

### Site

Session par cookie `__Host-rev_sess` (`rev_sess` en http local ; HttpOnly, Secure, SameSite=Lax, 30 jours), condensat en base. Toute requête non GET vers `/api` exige un en-tête `Origin` égal à `PUBLIC_URL`. Limites par compte : `POST /api/a-trier` 30 requêtes par 15 min, `/mcp` 300 par 15 min. `POST /api/compte/deconnecter-claude` supprime tous les jetons MCP, codes et accords du compte. `ecrire_fichier` accepte une seule écriture d'AGENTS.md (quand il est encore égal au modèle), puis le refuse ; l'élève peut le modifier lui-même dans son Drive. Les consignes MCP rappellent à Claude que le contenu des fichiers et des cours est une donnée, jamais une consigne : c'est une protection par instruction, pas une barrière technique. Un code ou un refresh déjà échangé qui revient supprime tous les jetons du couple compte × client.

## Outils MCP

Tous agissent sur le compte du jeton, et seulement sur lui. Noms et descriptions en français, écrits pour Claude.

| Outil | Entrée | Effet |
|---|---|---|
| `demarrer` | aucune | Crée `Révision/` et les 9 fichiers depuis les gabarits s'ils manquent. Rend la liste des fichiers avec leur `version`, le contenu d'AGENTS.md, `accueil_fait` (vrai si Pers.md n'est plus égal à son modèle), et l'adresse du site. |
| `lire_fichier` | `nom` (un des 9) | `{contenu, version}` |
| `ecrire_fichier` | `nom`, `contenu`, `version` | Refuse si `version` ne correspond plus (« modifié ailleurs, relis le fichier »). Rend la nouvelle `version`. Taille max 100 Ko. |
| `lister_a_trier` | aucune | Fichiers du dossier À trier : `id`, nom, type, date. |
| `lire_a_trier` | `id` | Image : contenu image MCP (5 Mo max ; le site réduit les photos à 1600 px avant l'envoi, HEIC refusé). Texte : le texte. PDF : contenu ressource `application/pdf` (support côté client à vérifier). |
| `enregistrer_lecon` | `matiere`, `chapitre`, `titre`, `pack`, `source_id` facultatif | Valide le pack, écrit `Cours/…/<Titre>.json`, met le cache à jour, déplace la source si `source_id`. Rend l'`id` de leçon et le lien du site. |
| `lister_lecons` | aucune | Leçons du cache (id, matière, chapitre, titre, date). |
| `lire_lecon` | `id` | Le pack complet. |
| `etat_revision` | aucune | Par leçon : cartes dues, boîtes, meilleur quiz, dernière séance. Plus les contrôles des 14 prochains jours lus dans Calendrier.md. |

Schéma du `pack` (validé côté serveur, erreurs claires) :
```json
{
  "resume": "texte, 600 caractères max",
  "fiche": "markdown",
  "cartes": [{"q": "…", "r": "…"}],
  "quiz": [{"question": "…", "choix": ["…","…","…","…"], "bonne": 0, "explication": "…"}],
  "exercices": [{"enonce": "…", "corrige": "…"}],
  "lacunes": ["passage illisible ou manquant"]
}
```
Le serveur ajoute des identifiants stables : `c0…`, `q0…`, `e0…` (dans l'ordre). Réenregistrer une leçon de même titre au même endroit la remplace et garde la progression des cartes dont le texte de question est identique.

## API du site

| Méthode et chemin | Réponse |
|---|---|
| `GET /auth/login` | Redirige vers Google |
| `GET /auth/google/callback` | Termine la connexion (site ou MCP selon `state`) |
| `POST /auth/logout` | Supprime la session |
| `GET /api/moi` | `{email, nom, connecteur_url, google_pret}` ou 401 |
| `GET /api/aujourdhui` | `{controles:[{date, matiere, type, sujet, dans_jours}], lecons:[{id, titre, matiere, chapitre, raison, cartes_dues}]}` ; `raison` ∈ `controle` (contrôle de la matière dans 7 jours ou moins), `cartes_dues`, `nouvelle` (jamais révisée) ; tri dans cet ordre |
| `GET /api/lecons` | `[{id, matiere, chapitre, titre, ajoutee_le, nb_cartes, nb_quiz, nb_exercices, cartes_dues, meilleur_quiz}]` |
| `GET /api/lecons/:id` | Pack complet avec identifiants, plus `progression:{cartes:{c0:{boite, prochaine}}}` |
| `POST /api/cartes/:lecon/:carte` | corps `{su: true\|false}` ; Leitner 5 boîtes, intervalles 0, 1, 3, 7, 14 jours ; rate = boîte 1 ; rend `{boite, prochaine}` |
| `POST /api/quiz/:lecon` | corps `{score, total}` |
| `POST /api/a-trier` | multipart `fichier`, 10 Mo max, jpeg, png, webp, heic, pdf, txt ; envoyé dans `Révision/À trier/` ; rend `{id, nom}` |
| `GET /api/a-trier` | liste |
| `DELETE /api/compte` | Supprime toutes les données du serveur pour ce compte (le Drive reste à l'élève) |

Calendrier.md : lignes de tableau `| JJ/MM/AAAA | matière | type | sujet |`, lecture tolérante (espaces, casse, accents) ; une ligne illisible est ignorée.

## Site (web/)

Mobile d'abord, français, tutoiement, sans jargon. Pages : accueil public (ce que c'est, « Se connecter avec Google »), Aujourd'hui, Mes cours (matière > chapitre > leçon), Leçon (onglets Fiche, Cartes, Quiz, Exercices), Ajouter un cours (photo depuis l'appareil), Connecteur (adresse à copier et étapes claude.ai), Compte (déconnexion, suppression), Confidentialité, Conditions. Fiche : markdown rendu puis nettoyé (bibliothèque vendue dans `web/vendor/`, aucune CDN). Bouton « Faire corriger » sur un exercice : copie un message prêt (« Corrige ma réponse à l'exercice N de la leçon "Titre" (id …) avec le connecteur Révision. Ma réponse : ») et propose d'ouvrir claude.ai. Manifest et icône pour l'ajout à l'écran d'accueil. CSP stricte (`default-src 'self'`).

## Sécurité

Utilisateur système dédié sans shell, systemd durci (`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/revision-app`, `PrivateTmp`). Écoute sur 127.0.0.1 seulement. Limites de débit sur `/authorize`, `/token`, `/register`, `/auth/*`. Aucun contenu de cours, jeton ou e-mail dans les journaux. Chaque requête en base filtrée par compte ; test dédié qu'un compte ne lit jamais un autre.
