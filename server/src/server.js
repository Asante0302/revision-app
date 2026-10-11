import { chargerConfig } from './config.js';
import { creerApp } from './app.js';

let config;
try { config = chargerConfig(); } catch (e) { console.error('Configuration invalide :', e.message); process.exit(1); }

const { app, close } = creerApp(config);
if (!config.googlePret) console.warn('GOOGLE_CLIENT_ID absent : le site démarre, la connexion Google et /mcp répondent 503.');

const serveur = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Révision à l'écoute sur 127.0.0.1:${config.port}`);
});
const arret = () => serveur.close(() => { close(); process.exit(0); });
process.on('SIGTERM', arret);
process.on('SIGINT', arret);
