import { normaliser } from './noms.js';
import { joursEntre } from './dates.js';

const RE_DATE = /^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})$/;

// Lecture tolérante de Calendrier.md : une ligne illisible est ignorée.
export function lireCalendrier(texte) {
  const sorties = [];
  for (const brut of String(texte ?? '').split(/\r?\n/)) {
    const ligne = brut.trim();
    if (!ligne.startsWith('|')) continue;
    const cases = ligne.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const m = RE_DATE.exec(cases[0] ?? '');
    if (!m) continue;
    const [j, mo, a] = [+m[1], +m[2], +m[3]];
    const d = new Date(Date.UTC(a, mo - 1, j));
    if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) continue;
    const matiere = cases[1] ?? '';
    if (!matiere || matiere.startsWith('{')) continue;
    sorties.push({
      date: d.toISOString().slice(0, 10),
      matiere,
      type: cases[2] && !cases[2].startsWith('{') ? cases[2] : '',
      sujet: cases[3] && !cases[3].startsWith('{') ? cases[3] : '',
    });
  }
  return sorties;
}

export function controlesProches(entrees, aujourdhui, jours = 14) {
  return entrees
    .map((e) => ({ ...e, dans_jours: joursEntre(aujourdhui, e.date) }))
    .filter((e) => e.dans_jours >= 0 && e.dans_jours <= jours)
    .sort((a, b) => a.dans_jours - b.dans_jours || normaliser(a.matiere).localeCompare(normaliser(b.matiere)));
}
