const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function envoyerPage(res, status, titre, texte) {
  res.status(status)
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre)}</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}a{color:#1a56db}</style></head><body><h1>${esc(titre)}</h1><p>${esc(texte)}</p><p><a href="/">Retour à l'accueil</a></p></body></html>`);
}
