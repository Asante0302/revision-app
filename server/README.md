# Serveur Révision

Node 22 (ESM) : Express, SDK MCP officiel, `node:sqlite`. Cahier des charges : `../docs/ARCHITECTURE.md`.

## Lancer

```
npm install
cp ../deploy/env.example ./env     # puis remplir (fichier ignoré par git)
set -a; . ./env; set +a
npm start                       # écoute 127.0.0.1:$PORT (8650 par défaut)
```

Sans `GOOGLE_CLIENT_ID`, le serveur démarre : le site s'affiche, la connexion Google et `/mcp` répondent 503.
Il sert aussi le dossier `../web` en statique. `DATA_DIR` reçoit la base SQLite (par défaut `./data`).

## Tester

```
npm test
```

Aucun appel réseau réel : les tests lancent un faux Google local (OAuth et Drive v3) dans `test/aide/`.

## Déployer

Modèles dans `../deploy/` : unité systemd, vhost Apache, exemple d'environnement.
