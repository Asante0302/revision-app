// Erreur dont le message (en français) peut être montré à l'élève ou à Claude.
export class ErreurMetier extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class ErreurGoogle extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export class ReconnexionNecessaire extends ErreurMetier {
  constructor(publicUrl) {
    super(`La connexion à ton Google Drive a expiré. Ouvre ${publicUrl}, reconnecte-toi avec Google, puis réessaie.`, 401);
  }
}
