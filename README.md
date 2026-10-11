# Révision

Ton assistant de révision : Claude range tes cours dans ton Google Drive, te fait des fiches, des cartes et des quiz, et te dit quoi réviser. Tu révises ensuite sur ton téléphone avec le site [revision.funnelforge.fr](https://revision.funnelforge.fr).

Tu n'as rien à installer. Tu as juste besoin d'un compte Claude (l'offre gratuite suffit pour commencer, Pro conseillé) et d'un compte Google. Attention : les conditions de Claude exigent d'avoir 18 ans ou plus. Moins de 18 ans : n'utilise pas claude.ai, ton compte peut être désactivé.

## Commencer

1. Sur ordinateur, ouvre [claude.ai](https://claude.ai) (la première fois se fait sur ordinateur).
2. Crée une nouvelle conversation.
3. Copie et colle ce message, puis envoie :

```
Lis ce guide et suis-le étape par étape avec moi : https://raw.githubusercontent.com/Asante0302/revision-app/main/ONBOARDING.md
```

Claude t'aide à brancher ton Google Drive (2 minutes), puis te pose 12 questions, une par une. Ça prend environ 15 minutes en tout.

Si Claude répond qu'il n'arrive pas à ouvrir le lien : ouvre [le guide](https://raw.githubusercontent.com/Asante0302/revision-app/main/ONBOARDING.md) toi-même, copie tout le texte de la page, colle-le dans la conversation et envoie.

## Ensuite, chaque jour

- **Un nouveau cours** : sur le site, « Ajouter un cours » et prends-le en photo. Puis dans Claude : « Range mes cours ». Claude en fait une fiche, des cartes, un quiz et des exercices.
- **Réviser** : ouvre le site, page « Aujourd'hui ». Ou dis à Claude « Je veux réviser ».
- **Un exercice à corriger** : bouton « Faire corriger » sur le site, puis colle le message dans Claude.

Astuce : ajoute le site à l'écran d'accueil de ton téléphone.

## État du projet

Version de test, 10 places au plus. Si Google affiche un avertissement « application non vérifiée » ou si le site dit « Places complètes », préviens la personne qui t'a donné ce lien. Sans connecteur, Claude te donne tes fichiers à la fin de l'accueil : garde-les et recolle-les quand tu veux réviser.

## Tes données

- Tes cours et tes fiches sont rangés dans **ton** Google Drive, dossier « Révision ». Le service ne voit que les fichiers qu'il a créés lui-même, rien d'autre de ton Drive.
- Le serveur garde ton adresse e-mail et ton nom Google, ta progression (cartes, quiz), une copie des leçons et de ton calendrier de contrôles pour afficher le site. Tu peux tout effacer depuis la page « Compte » du site.
- Ce que tu écris à Claude est envoyé à Claude (Anthropic), comme toute conversation.
- Ne donne ni ton nom de famille ni le nom de ton école.

Détails : [confidentialité](https://revision.funnelforge.fr/confidentialite.html) et [conditions](https://revision.funnelforge.fr/conditions.html).

## Pour les curieux

Le code est ici : `server/` (connecteur et site, Node), `web/` (le site), `deploy/` (installation sur un serveur), `docs/ARCHITECTURE.md` (fonctionnement).

Licence : MIT.
