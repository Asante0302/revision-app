import crypto from 'node:crypto';
import { transaction } from '../db/index.js';
import { apresReponse } from '../lib/leitner.js';
import { normaliser } from '../lib/noms.js';
import { ErreurMetier } from '../lib/erreurs.js';

// Leçons en cache, progression Leitner, scores de quiz. Toute requête est filtrée par userId.
export function creerLecons({ db, aujourdhui }) {
  function enregistrer(userId, { matiere, chapitre, titre, pack, fileId }) {
    return transaction(db, () => {
      const maintenant = new Date().toISOString();
      const exist = db.prepare('SELECT id FROM lecons WHERE user_id=? AND matiere=? AND chapitre=? AND titre=?').get(userId, matiere, chapitre, titre);
      const id = exist?.id ?? 'l' + crypto.randomBytes(6).toString('hex');
      const json = JSON.stringify(pack);
      if (exist) {
        const anciennes = db.prepare('SELECT question, boite, prochaine, derniere FROM cartes WHERE lecon_id=? AND user_id=?').all(id, userId);
        db.prepare('UPDATE lecons SET file_id=?, pack=?, nb_cartes=?, nb_quiz=?, nb_exercices=? WHERE id=? AND user_id=?')
          .run(fileId, json, pack.cartes.length, pack.quiz.length, pack.exercices.length, id, userId);
        db.prepare('DELETE FROM cartes WHERE lecon_id=? AND user_id=?').run(id, userId);
        const parQuestion = new Map(anciennes.map((a) => [a.question, a]));
        for (const c of pack.cartes) {
          const a = parQuestion.get(c.q);
          if (a) db.prepare('INSERT INTO cartes (lecon_id,user_id,carte_id,question,boite,prochaine,derniere) VALUES (?,?,?,?,?,?,?)').run(id, userId, c.id, c.q, a.boite, a.prochaine, a.derniere);
        }
      } else {
        db.prepare('INSERT INTO lecons (id,user_id,matiere,chapitre,titre,file_id,pack,nb_cartes,nb_quiz,nb_exercices,added_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, userId, matiere, chapitre, titre, fileId, json, pack.cartes.length, pack.quiz.length, pack.exercices.length, maintenant);
      }
      return { id, remplacee: Boolean(exist) };
    });
  }

  function etatToutes(userId) {
    const jour = aujourdhui();
    const lecons = db.prepare('SELECT id,matiere,chapitre,titre,added_at,nb_cartes,nb_quiz,nb_exercices FROM lecons WHERE user_id=? ORDER BY matiere, chapitre, titre').all(userId);
    const cartes = db.prepare('SELECT lecon_id, boite, prochaine, derniere FROM cartes WHERE user_id=?').all(userId);
    const quiz = db.prepare('SELECT lecon_id, score, total, date FROM quiz_scores WHERE user_id=? ORDER BY id').all(userId);
    return lecons.map((l) => {
      const cs = cartes.filter((c) => c.lecon_id === l.id);
      const qs = quiz.filter((q) => q.lecon_id === l.id);
      const nouvelles = Math.max(l.nb_cartes - cs.length, 0);
      const boites = [1, 2, 3, 4, 5].map((b) => cs.filter((c) => c.boite === b).length + (b === 1 ? nouvelles : 0));
      let meilleur = null;
      for (const q of qs) if (!meilleur || q.score / q.total >= meilleur.score / meilleur.total) meilleur = { score: q.score, total: q.total };
      const dates = [...cs.map((c) => c.derniere), ...qs.map((q) => q.date)].sort();
      return {
        ...l,
        cartes_dues: cs.filter((c) => c.prochaine <= jour).length + nouvelles,
        boites,
        meilleur_quiz: meilleur,
        derniere_seance: dates.length ? dates[dates.length - 1] : null,
        jamais_revisee: cs.length === 0 && qs.length === 0,
      };
    });
  }

  function lire(userId, id) {
    const l = db.prepare('SELECT * FROM lecons WHERE id=? AND user_id=?').get(String(id), userId);
    if (!l) throw new ErreurMetier('Leçon introuvable.', 404);
    return { lecon: l, pack: JSON.parse(l.pack) };
  }

  function progression(userId, id) {
    const cartes = {};
    for (const c of db.prepare('SELECT carte_id, boite, prochaine FROM cartes WHERE lecon_id=? AND user_id=?').all(id, userId)) {
      cartes[c.carte_id] = { boite: c.boite, prochaine: c.prochaine };
    }
    return { cartes };
  }

  function carteRevue(userId, leconId, carteId, su) {
    const { pack } = lire(userId, leconId);
    const carte = pack.cartes.find((c) => c.id === carteId);
    if (!carte) throw new ErreurMetier('Carte introuvable.', 404);
    const actuelle = db.prepare('SELECT boite FROM cartes WHERE lecon_id=? AND user_id=? AND carte_id=?').get(leconId, userId, carteId);
    const r = apresReponse(actuelle?.boite ?? 1, su, aujourdhui());
    db.prepare(`INSERT INTO cartes (lecon_id,user_id,carte_id,question,boite,prochaine,derniere) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(lecon_id,carte_id) DO UPDATE SET boite=excluded.boite, prochaine=excluded.prochaine, derniere=excluded.derniere`)
      .run(leconId, userId, carteId, carte.q, r.boite, r.prochaine, new Date().toISOString());
    return r;
  }

  function quizScore(userId, leconId, score, total) {
    lire(userId, leconId);
    if (!Number.isInteger(score) || !Number.isInteger(total) || total < 1 || total > 500 || score < 0 || score > total) {
      throw new ErreurMetier('Score invalide.');
    }
    db.prepare('INSERT INTO quiz_scores (lecon_id,user_id,score,total,date) VALUES (?,?,?,?,?)').run(leconId, userId, score, total, new Date().toISOString());
  }

  // Leçons à travailler aujourd'hui, selon les contrôles proches.
  function aujourdhuiLecons(userId, controles) {
    const sortie = [];
    for (const l of etatToutes(userId)) {
      const proches = controles.filter((c) => normaliser(c.matiere) === normaliser(l.matiere) && c.dans_jours <= 7);
      let raison = null;
      if (proches.length) raison = 'controle';
      else if (l.jamais_revisee) raison = 'nouvelle';
      else if (l.cartes_dues > 0) raison = 'cartes_dues';
      if (!raison) continue;
      sortie.push({ id: l.id, titre: l.titre, matiere: l.matiere, chapitre: l.chapitre, raison, cartes_dues: l.cartes_dues, _j: proches.length ? Math.min(...proches.map((c) => c.dans_jours)) : 0 });
    }
    const rang = { controle: 0, cartes_dues: 1, nouvelle: 2 };
    sortie.sort((a, b) => rang[a.raison] - rang[b.raison] || a._j - b._j || b.cartes_dues - a.cartes_dues);
    return sortie.map(({ _j, ...r }) => r);
  }

  return { enregistrer, etatToutes, lire, progression, carteRevue, quizScore, aujourdhuiLecons };
}
