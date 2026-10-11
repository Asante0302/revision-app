// Liste d'invités (ALLOWED_EMAILS) : vide ou absente = ouvert.
export const emailAutorise = (config, email) =>
  !config.emailsAutorises || config.emailsAutorises.has(String(email ?? '').toLowerCase());
