import crypto from 'node:crypto';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const aleatoire = (n = 32) => crypto.randomBytes(n).toString('base64url');
export function chiffrer(cle, texte) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle, iv);
  const ct = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function dechiffrer(cle, valeur) {
  if (!valeur?.startsWith('v1:')) throw new Error('format inconnu');
  const b = Buffer.from(valeur.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', cle, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
