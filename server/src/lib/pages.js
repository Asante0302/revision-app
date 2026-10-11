const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function envoyerPage(res, status, titre, texte) {
  res.status(status)
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre)}</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}a{color:#1a56db}</style></head><body><h1>${esc(titre)}</h1><p>${esc(texte)}</p><p><a href="/">Retour à l'accueil</a></p></body></html>`);
}

// Page d'accord avant d'envoyer un code à Claude. CSP stricte : pas d'inline, feuille /style.css.
export function envoyerConsentement(res, { hote, jeton }) {
  res.status(200)
    .set('Content-Security-Policy', "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'")
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Autoriser Claude ?</title><link rel="stylesheet" href="/style.css"></head><body class="public"><main><h1>Autoriser Claude à accéder à ton espace Révision ?</h1><div class="carte"><p><strong>Claude</strong> demande l'accès depuis <strong>${esc(hote)}</strong>.</p><p><strong>Tu n'as pas cliqué sur « Connect » dans Claude à l'instant ? Alors refuse.</strong></p><p>Si tu autorises, Claude pourra lire et écrire tes fichiers Révision dans ton Drive.</p><p>Tu pourras retirer cet accès à tout moment avec le bouton « Déconnecter Claude » du site.</p></div><form method="post" action="/auth/consentement"><input type="hidden" name="jeton" value="${esc(jeton)}"><p><button class="principal plein" type="submit" name="decision" value="autoriser">Autoriser</button></p><p><button class="plein" type="submit" name="decision" value="refuser">Refuser</button></p></form></main></body></html>`);
}
