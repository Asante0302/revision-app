import { ErreurMetier } from './erreurs.js';

const estTexte = (v) => typeof v === 'string' && v.trim().length > 0;

// Valide le pack et ajoute les identifiants stables c0.., q0.., e0..
export function validerPack(entree) {
  let p = entree;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch { throw new ErreurMetier('Pack invalide : ce n\'est pas du JSON lisible.'); }
  }
  const err = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ErreurMetier('Pack invalide : il faut un objet avec resume, fiche, cartes, quiz, exercices, lacunes.');

  if (!estTexte(p.resume)) err.push('resume : texte obligatoire');
  else if (p.resume.length > 600) err.push(`resume : ${p.resume.length} caractères, 600 au maximum`);
  if (!estTexte(p.fiche)) err.push('fiche : texte markdown obligatoire');
  else if (p.fiche.length > 60000) err.push('fiche : trop longue (60 000 caractères au maximum)');

  const liste = (nom, max) => {
    const v = p[nom] ?? [];
    if (!Array.isArray(v)) { err.push(`${nom} : doit être une liste`); return []; }
    if (v.length > max) err.push(`${nom} : ${v.length} éléments, ${max} au maximum`);
    return v;
  };
  const cartes = liste('cartes', 200).map((c, i) => {
    if (!c || !estTexte(c.q) || !estTexte(c.r)) { err.push(`cartes[${i}] : q et r (textes non vides) obligatoires`); return null; }
    if (c.q.length > 1000 || c.r.length > 2000) err.push(`cartes[${i}] : texte trop long`);
    return { id: `c${i}`, q: c.q, r: c.r };
  });
  const quiz = liste('quiz', 100).map((q, i) => {
    const bon = q && estTexte(q.question) && Array.isArray(q.choix) && q.choix.length === 4 && q.choix.every(estTexte);
    if (!bon) { err.push(`quiz[${i}] : question et exactement 4 choix (textes non vides) obligatoires`); return null; }
    if (!Number.isInteger(q.bonne) || q.bonne < 0 || q.bonne > 3) { err.push(`quiz[${i}] : bonne doit être un entier de 0 à 3`); return null; }
    if (q.explication != null && typeof q.explication !== 'string') err.push(`quiz[${i}] : explication doit être un texte`);
    return { id: `q${i}`, question: q.question, choix: q.choix, bonne: q.bonne, explication: q.explication ?? '' };
  });
  const exercices = liste('exercices', 50).map((e, i) => {
    if (!e || !estTexte(e.enonce) || !estTexte(e.corrige)) { err.push(`exercices[${i}] : enonce et corrige (textes non vides) obligatoires`); return null; }
    return { id: `e${i}`, enonce: e.enonce, corrige: e.corrige };
  });
  const lacunes = liste('lacunes', 100);
  lacunes.forEach((l, i) => { if (!estTexte(l)) err.push(`lacunes[${i}] : texte non vide attendu`); });
  if (!cartes.length && !quiz.length && !exercices.length) err.push('il faut au moins une carte, une question de quiz ou un exercice');

  if (err.length) throw new ErreurMetier('Pack refusé :\n- ' + err.slice(0, 12).join('\n- '));
  const pack = { resume: p.resume, fiche: p.fiche, cartes, quiz, exercices, lacunes };
  if (Buffer.byteLength(JSON.stringify(pack)) > 500_000) throw new ErreurMetier('Pack refusé : trop volumineux (500 Ko au maximum).');
  return pack;
}
