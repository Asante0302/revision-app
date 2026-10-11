import { ErreurMetier } from './erreurs.js';
export function nettoyerNom(valeur, etiquette = 'nom', max = 80) {
  const s = String(valeur ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim()
    .slice(0, max)
    .trim();
  if (!s) throw new ErreurMetier(`Le champ « ${etiquette} » est vide ou invalide.`);
  return s;
}
export const normaliser = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
