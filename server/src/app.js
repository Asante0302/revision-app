import fs from 'node:fs';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ouvrirBase } from './db/index.js';
import { creerGoogle } from './drive/google.js';
import { creerProvider, purger } from './oauth/provider.js';
import { creerConnexion } from './oauth/connexion.js';
import { creerComptes } from './services/comptes.js';
import { creerLecons } from './services/lecons.js';
import { creerServeurMcp } from './mcp/outils.js';
import { creerApi } from './api/index.js';

const CSP = "default-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

export function creerApp(config, { fetchFn = fetch } = {}) {
  const db = ouvrirBase(config.dbPath);
  purger(db);
  const minuteur = setInterval(() => purger(db), 3600_000);
  minuteur.unref();

  const google = creerGoogle({ config, db, fetchFn });
  const lien = {};
  const provider = creerProvider({ config, db, demarrerGoogle: (...a) => lien.demarrer(...a) });
  const connexion = creerConnexion({ config, db, google, provider });
  lien.demarrer = connexion.demarrerGoogle;
  const comptes = creerComptes({ config, db, google, fetchFn });
  const lecons = creerLecons({ db, aujourdhui: config.today });

  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  if (!config.silencieux) {
    app.use((req, res, next) => {
      res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode}`)); // jamais la query ni les contenus
      next();
    });
  }
  app.use((req, res, next) => {
    res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  // --- MCP ---
  const origines = new Set([config.publicUrl, 'https://claude.ai', 'https://claude.com']);
  const metadonneesUrl = getOAuthProtectedResourceMetadataUrl(new URL(config.mcpUrl));
  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: metadonneesUrl });
  const limiteMcp = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.limiteMcp ?? 300, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `u${req.auth.extra.userId}`, message: { error: 'rate_limited', error_description: 'Trop de requêtes, réessaie dans un moment.' },
  });
  app.all('/mcp', (req, res, next) => {
    if (!config.googlePret) {
      return res.status(503).json({ error: 'service_unavailable', error_description: 'Le connecteur n\'est pas encore ouvert.' });
    }
    if (req.headers.origin && !origines.has(req.headers.origin)) {
      return res.status(403).json({ error: 'forbidden', error_description: 'Origine refusée.' });
    }
    next();
  }, bearer, limiteMcp, (req, res, next) => {
    if (req.method !== 'POST') {
      return res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non autorisée.' }, id: null });
    }
    next();
  }, express.json({ limit: '2mb' }), async (req, res) => {
    const server = creerServeurMcp({ config, userId: req.auth.extra.userId, comptes, lecons });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // --- OAuth (métadonnées, /register, /authorize, /token, /revoke) ---
  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(config.publicUrl),
    resourceServerUrl: new URL(config.mcpUrl),
    resourceName: 'Révision',
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  }));
  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    res.json({ resource: config.mcpUrl, authorization_servers: [new URL(config.publicUrl).href], resource_name: 'Révision' });
  });

  // --- Connexion Google et site ---
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/auth/logout' && req.headers.origin !== config.publicUrl) {
      return res.status(403).json({ erreur: 'Origine refusée.' });
    }
    next();
  });
  app.use(connexion.router);
  app.use('/api', creerApi({ config, db, comptes, lecons, google, effacerCookie: connexion.effacerCookie }));

  if (fs.existsSync(config.webDir)) app.use(express.static(config.webDir, { dotfiles: 'ignore' }));

  app.use((req, res) => res.status(404).type('text/plain').send('Introuvable'));
  app.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    if (e?.type === 'entity.parse.failed' || e?.type === 'entity.too.large') return res.status(400).json({ error: 'invalid_request' });
    console.error('erreur', e?.name);
    res.status(500).json({ error: 'server_error' });
  });

  return { app, db, close: () => { clearInterval(minuteur); db.close(); } };
}
