/* Révision : site de révision (sans framework, sans build).
   Aucun script ni style en ligne : compatible CSP "default-src 'self'". */
(function () {
  'use strict';

  var main = document.getElementById('contenu');
  var nav = document.getElementById('nav');
  var annonce = document.getElementById('annonce');
  var etat = { moi: null, googlePret: null, jeton: 0 };

  /* ---------- Outils DOM ---------- */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'texte') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) ajouterUn(el, arguments[i]);
    return el;
  }
  function ajouter(el) {
    for (var i = 1; i < arguments.length; i++) ajouterUn(el, arguments[i]);
  }
  function ajouterUn(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { ajouterUn(el, x); }); return; }
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function vider(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function afficher() {
    vider(main);
    for (var i = 0; i < arguments.length; i++) ajouter(main, arguments[i]);
    window.scrollTo(0, 0);
  }
  function dire(texte) { annonce.textContent = ''; setTimeout(function () { annonce.textContent = texte; }, 30); }
  function titrePage(t) { document.title = t ? t + ' · Révision' : 'Révision'; }

  var ICONES = {
    soleil: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    livres: 'M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h6',
    plus: 'M12 5v14M5 12h14',
    compte: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.5-6 8-6s8 2 8 6'
  };
  function icone(nom) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONES[nom]);
    svg.appendChild(p);
    return svg;
  }

  /* ---------- Réseau ---------- */

  function ErreurApi(status, corps) {
    this.status = status;
    this.corps = corps || null;
    var m = corps && (corps.erreur || corps.error || corps.message);
    this.message = typeof m === 'string' ? m : '';
  }
  function messageErreur(e) {
    if (e instanceof ErreurApi) {
      if (e.message) return e.message;
      if (e.status === 429) return 'Trop de demandes d’un coup. Attends une minute et réessaie.';
      if (e.status === 413) return 'Ce fichier est trop gros (10 Mo au maximum).';
      if (e.status === 415) return 'Ce type de fichier n’est pas accepté. Choisis une photo, un PDF ou un fichier texte.';
      if (e.status === 503) return 'Le service est indisponible pour le moment. Réessaie un peu plus tard.';
      return 'Un problème est survenu (code ' + e.status + '). Réessaie dans un instant.';
    }
    return 'Pas de connexion au serveur. Vérifie ton réseau puis réessaie.';
  }
  function api(chemin, options) {
    options = options || {};
    var init = { method: options.method || 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (options.corps !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.corps);
    }
    return fetch(chemin, init).then(function (r) {
      return r.text().then(function (t) {
        var json = null;
        try { json = t ? JSON.parse(t) : null; } catch (x) { json = null; }
        if (r.status === 401) { var e401 = new ErreurApi(401, json); throw e401; }
        if (!r.ok) throw new ErreurApi(r.status, json);
        return json;
      });
    }, function () { throw new Error('reseau'); });
  }

  /* ---------- Textes utiles ---------- */

  function jourRelatif(n) {
    if (n === 0) return 'Aujourd’hui';
    if (n === 1) return 'Demain';
    if (n < 0) return 'Il y a ' + (-n) + ' jours';
    return 'Dans ' + n + ' jours';
  }
  function pluriel(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un); }
  function dateCourte(d) {
    var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(d));
    var x = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
    return isNaN(x) ? '' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  }
  function typeControle(t) { return t ? String(t) : 'contrôle'; }

  function copier(texte) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texte).then(function () { return true; }, function () { return copierAncien(texte); });
    }
    return Promise.resolve(copierAncien(texte));
  }
  function copierAncien(texte) {
    var t = h('textarea', { 'aria-hidden': 'true', readonly: true, class: 'sr-only' });
    t.value = texte;
    document.body.appendChild(t);
    t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(t);
    return ok;
  }

  function md(texte) {
    var brut = window.marked.parse(String(texte || ''), { async: false, gfm: true, breaks: false });
    return window.DOMPurify.sanitize(brut, {
      FORBID_TAGS: ['style', 'img', 'form', 'input', 'button', 'iframe', 'svg', 'math'],
      FORBID_ATTR: ['style'],
      USE_PROFILES: { html: true }
    });
  }
  function bloc(texte, classe) {
    var d = h('div', { class: classe || 'fiche' });
    d.innerHTML = md(texte);
    d.querySelectorAll('a[href]').forEach(function (a) { a.setAttribute('rel', 'noopener noreferrer'); a.setAttribute('target', '_blank'); });
    return d;
  }

  /* ---------- Cadre : navigation, erreurs ---------- */

  var NAV = [
    { href: '#/', nom: 'Aujourd’hui', icone: 'soleil', cle: 'aujourdhui' },
    { href: '#/cours', nom: 'Mes cours', icone: 'livres', cle: 'cours' },
    { href: '#/ajouter', nom: 'Ajouter', icone: 'plus', cle: 'ajouter' },
    { href: '#/compte', nom: 'Compte', icone: 'compte', cle: 'compte' }
  ];
  function dessinerNav(cle) {
    vider(nav);
    NAV.forEach(function (n) {
      nav.appendChild(h('a', { href: n.href, 'aria-current': n.cle === cle ? 'page' : null }, icone(n.icone), h('span', { texte: n.nom })));
    });
    nav.classList.remove('cache');
    document.body.classList.remove('public');
  }
  function modePublic() {
    nav.classList.add('cache');
    document.body.classList.add('public');
  }

  function erreurReseau(e, reessayer) {
    if (e instanceof ErreurApi && e.status === 401) { etat.moi = null; etat.googlePret = e.corps && e.corps.google_pret === false ? false : etat.googlePret; return accueilPublic(); }
    afficher(h('div', { class: 'boite erreur', role: 'alert' },
      h('p', { texte: messageErreur(e) }),
      reessayer ? h('button', { type: 'button', class: 'principal', onclick: reessayer, texte: 'Réessayer' }) : null));
  }

  /* ---------- Accueil public ---------- */

  function accueilPublic() {
    modePublic();
    if (etat.statut === undefined) {
      etat.statut = null;
      api('/api/statut').then(function (st) {
        etat.statut = st || null;
        if (st && typeof st.google_pret === 'boolean') etat.googlePret = st.google_pret;
        if (!etat.moi) accueilPublic();
      }).catch(function () { return null; });
    }
    titrePage('');
    var pasPret = etat.googlePret === false;
    var complet = !pasPret && etat.statut && etat.statut.places_libres === 0;
    afficher(
      h('div', { class: 'hero' },
        h('img', { src: '/icons/icon-192.png', alt: '', width: '88', height: '88' }),
        h('h1', { texte: 'Révision' }),
        h('p', { class: 'doux', texte: 'Révise tes cours sur ton téléphone, sans te prendre la tête.' })),
      h('div', { class: 'carte' },
        h('h2', { texte: 'Comment ça marche' }),
        h('ol', { class: 'liste-claire' },
          h('li', { texte: 'Tu prends tes cours en photo avec ton téléphone.' }),
          h('li', { texte: 'Tu demandes à Claude de les ranger. Il fabrique pour toi une fiche, des cartes, un quiz et des exercices.' }),
          h('li', { texte: 'Tu révises ici, un peu chaque jour. Le site te rappelle ce qui est à revoir avant tes contrôles.' })),
        h('p', { class: 'doux petit', texte: 'Tes cours restent dans ton propre Google Drive. Il te faut un compte Google et ton abonnement Claude. Réservé aux personnes de 18 ans ou plus.' })),
      pasPret
        ? h('div', { class: 'boite info', role: 'status' }, h('strong', { texte: 'Connexion bientôt disponible' }), h('p', { texte: 'Reviens dans quelques jours, on prépare encore l’ouverture.' }))
        : h('a', { class: 'btn principal plein', href: '/auth/login', texte: 'Se connecter avec Google' }),
      complet ? h('p', { class: 'doux petit', role: 'status', texte: 'Il n\u2019y a plus de place pour de nouveaux comptes pour le moment. Si tu as déjà un compte, tu peux te connecter.' }) : null,
      h('p', { class: 'pied' },
        h('a', { href: '/confidentialite.html', texte: 'Confidentialité' }), ' · ',
        h('a', { href: '/conditions.html', texte: 'Conditions' }))
    );
  }

  /* ---------- Aujourd'hui ---------- */

  function raisonTexte(l) {
    if (l.raison === 'controle') return h('span', { class: 'badge alerte', texte: 'Contrôle bientôt' });
    if (l.raison === 'cartes_dues') return h('span', { class: 'badge', texte: pluriel(l.cartes_dues || 0, 'carte à revoir', 'cartes à revoir') });
    return h('span', { class: 'badge ok', texte: 'Nouvelle' });
  }
  function carteLecon(l) {
    return h('a', { class: 'carte', href: '#/lecon/' + encodeURIComponent(l.id) + '/fiche' },
      h('strong', { texte: l.titre }),
      h('span', { class: 'doux petit', texte: [l.matiere, l.chapitre].filter(Boolean).join(' · ') }),
      h('div', null, l.raison ? raisonTexte(l) : null,
        (l.raison === 'controle' && l.cartes_dues) ? h('span', { class: 'badge', texte: pluriel(l.cartes_dues, 'carte à revoir', 'cartes à revoir') }) : null));
  }

  function vueAujourdhui() {
    dessinerNav('aujourdhui'); titrePage('Aujourd’hui');
    afficher(h('p', { class: 'chargement', texte: 'Chargement…' }));
    return api('/api/aujourdhui').then(function (d) {
      var controles = d.controles || [], lecons = d.lecons || [];
      var vide = !controles.length && !lecons.length;
      afficher(
        h('h1', { texte: 'Aujourd’hui' }),
        controles.length ? h('section', null,
          h('h2', { texte: 'Tes prochains contrôles' }),
          controles.map(function (c) {
            return h('div', { class: 'carte' },
              h('strong', { texte: jourRelatif(c.dans_jours) + ' : ' + c.matiere }),
              h('div', { class: 'doux', texte: [typeControle(c.type), c.sujet].filter(Boolean).join(' · ') }),
              h('div', { class: 'doux petit', texte: dateCourte(c.date) }));
          })) : null,
        lecons.length ? h('section', null,
          h('h2', { texte: 'À réviser maintenant' }),
          lecons.map(carteLecon)) : null,
        vide ? h('div', { class: 'carte' },
          h('h2', { texte: 'Rien à réviser pour le moment' }),
          h('p', { texte: 'Quand tu auras ajouté des cours, ils apparaîtront ici avec ce qu’il faut revoir.' }),
          h('div', { class: 'rangee' },
            h('a', { class: 'btn principal', href: '#/ajouter', texte: 'Ajouter un cours' }),
            h('a', { class: 'btn', href: '#/connecteur', texte: 'Relier Claude' }))) : null
      );
    }).catch(function (e) { erreurReseau(e, vueAujourdhui); });
  }

  /* ---------- Mes cours ---------- */

  function vueCours() {
    dessinerNav('cours'); titrePage('Mes cours');
    afficher(h('p', { class: 'chargement', texte: 'Chargement…' }));
    return api('/api/lecons').then(function (liste) {
      liste = liste || [];
      if (!liste.length) {
        afficher(h('h1', { texte: 'Mes cours' }), h('div', { class: 'carte' },
          h('p', { texte: 'Tu n’as pas encore de cours ici.' }),
          h('a', { class: 'btn principal', href: '#/ajouter', texte: 'Ajouter un cours' })));
        return;
      }
      var arbre = {};
      liste.forEach(function (l) {
        var m = l.matiere || 'Sans matière', c = l.chapitre || 'Sans chapitre';
        (arbre[m] = arbre[m] || {})[c] = (arbre[m][c] || []).concat([l]);
      });
      afficher(h('h1', { texte: 'Mes cours' }),
        Object.keys(arbre).sort().map(function (m) {
          var total = 0;
          Object.keys(arbre[m]).forEach(function (c) { arbre[m][c].forEach(function (l) { total += l.cartes_dues || 0; }); });
          return h('details', { open: Object.keys(arbre).length === 1 },
            h('summary', null, m, total ? h('span', { class: 'badge alerte', texte: ' ' + total + ' à revoir' }) : null),
            h('div', { class: 'dedans' }, Object.keys(arbre[m]).sort().map(function (c) {
              return h('details', { open: true },
                h('summary', { texte: c }),
                h('div', { class: 'dedans' }, arbre[m][c].map(function (l) {
                  return h('a', { class: 'carte', href: '#/lecon/' + encodeURIComponent(l.id) + '/fiche' },
                    h('strong', { texte: l.titre }),
                    h('span', { class: 'doux petit', texte: pluriel(l.nb_cartes || 0, 'carte', 'cartes') + ' · ' + pluriel(l.nb_quiz || 0, 'question', 'questions') + ' · ' + pluriel(l.nb_exercices || 0, 'exercice', 'exercices') }),
                    h('div', null,
                      l.cartes_dues ? h('span', { class: 'badge alerte', texte: pluriel(l.cartes_dues, 'carte à revoir', 'cartes à revoir') }) : null,
                      (l.meilleur_quiz !== null && l.meilleur_quiz !== undefined) ? h('span', { class: 'badge ok', texte: 'Meilleur quiz : ' + formatScore(l.meilleur_quiz, l.nb_quiz) }) : null));
                })));
            })));
        }));
    }).catch(function (e) { erreurReseau(e, vueCours); });
  }
  function formatScore(m, total) {
    if (m && typeof m === 'object') return m.score + '/' + m.total;
    if (typeof m === 'number' && total && m <= total) return m + '/' + total;
    return String(m);
  }

  /* ---------- Leçon ---------- */

  var ONGLETS = [['fiche', 'Fiche'], ['cartes', 'Cartes'], ['quiz', 'Quiz'], ['exercices', 'Exercices']];

  function vueLecon(id, onglet) {
    dessinerNav('cours');
    if (!ONGLETS.some(function (o) { return o[0] === onglet; })) onglet = 'fiche';
    afficher(h('p', { class: 'chargement', texte: 'Chargement…' }));
    return api('/api/lecons/' + encodeURIComponent(id)).then(function (l) {
      titrePage(l.titre);
      var corps = h('div');
      afficher(
        h('a', { class: 'retour', href: '#/cours', texte: '← Mes cours' }),
        h('h1', { texte: l.titre || 'Leçon' }),
        h('p', { class: 'doux petit', texte: [l.matiere, l.chapitre].filter(Boolean).join(' · ') }),
        h('nav', { class: 'onglets', 'aria-label': 'Parties de la leçon' }, ONGLETS.map(function (o) {
          return h('a', { href: '#/lecon/' + encodeURIComponent(id) + '/' + o[0], 'aria-current': o[0] === onglet ? 'page' : null, texte: o[1] });
        })),
        corps);
      ({ fiche: ongletFiche, cartes: ongletCartes, quiz: ongletQuiz, exercices: ongletExercices })[onglet](corps, l, id);
    }).catch(function (e) {
      if (e instanceof ErreurApi && e.status === 404) {
        afficher(h('a', { class: 'retour', href: '#/cours', texte: '← Mes cours' }), h('div', { class: 'boite erreur' }, h('p', { texte: 'Cette leçon n’existe pas ou plus.' })));
        return;
      }
      erreurReseau(e, function () { vueLecon(id, onglet); });
    });
  }

  function ongletFiche(corps, l) {
    ajouter(corps,
      l.resume ? h('div', { class: 'boite info' }, h('strong', { texte: 'En bref' }), h('p', { texte: l.resume })) : null,
      l.fiche ? bloc(l.fiche) : h('p', { class: 'doux', texte: 'Pas de fiche pour cette leçon.' }),
      (l.lacunes && l.lacunes.length) ? h('div', { class: 'boite' },
        h('strong', { texte: 'Passages à vérifier' }),
        h('p', { class: 'doux petit', texte: 'Claude n’a pas pu lire ces passages sur tes photos. Vérifie-les dans ton cours.' }),
        h('ul', { class: 'liste-claire' }, l.lacunes.map(function (x) { return h('li', { texte: x }); }))) : null);
  }

  function finDeJour() { var d = new Date(); d.setHours(23, 59, 59, 999); return d; }
  function estDue(prog, carte) {
    var p = prog && prog.cartes && prog.cartes[carte.id];
    if (!p || !p.prochaine) return true;
    var d = new Date(p.prochaine);
    return isNaN(d) || d <= finDeJour();
  }

  function ongletCartes(corps, l, idLecon) {
    var cartes = (l.cartes || []).map(function (c, i) { c.id = c.id || 'c' + i; return c; });
    if (!cartes.length) { ajouter(corps, h('p', { class: 'doux', texte: 'Pas de cartes pour cette leçon.' })); return; }
    var dues = cartes.filter(function (c) { return estDue(l.progression, c); });
    var file, pos, su, total, retourne;
    function demarrer(liste) { file = liste.slice(); total = file.length; pos = 0; su = 0; retourne = false; dessiner(); }
    function dessiner() {
      vider(corps);
      if (!file.length) {
        ajouter(corps, h('div', { class: 'boite ok' }, h('strong', { texte: 'Tout est à jour' }), h('p', { texte: 'Aucune carte à revoir aujourd’hui. Reviens demain, ou refais-les toutes si tu veux.' })),
          h('button', { type: 'button', class: 'plein', onclick: function () { demarrer(cartes); }, texte: 'Revoir toutes les cartes' }));
        return;
      }
      if (pos >= file.length) {
        ajouter(corps, h('div', { class: 'boite ok', role: 'status' }, h('strong', { texte: 'Série terminée' }),
          h('p', { texte: 'Tu savais ' + su + ' carte' + (su > 1 ? 's' : '') + ' sur ' + total + '.' })),
          h('div', { class: 'rangee' },
            h('button', { type: 'button', onclick: function () { demarrer(cartes); }, texte: 'Tout refaire' }),
            h('a', { class: 'btn principal', href: '#/cours', texte: 'Retour aux cours' })));
        dire('Série terminée');
        return;
      }
      var c = file[pos];
      ajouter(corps,
        h('p', { class: 'doux petit', texte: 'Carte ' + (pos + 1) + ' sur ' + total }),
        h('progress', { max: String(total), value: String(pos), 'aria-label': 'Avancement' }),
        h('button', { type: 'button', class: 'recto' + (retourne ? ' retourne' : ''), 'aria-label': retourne ? 'Réponse : ' + c.r : 'Question : ' + c.q + '. Touche pour voir la réponse.', onclick: function () { retourne = !retourne; dessiner(); } },
          h('span', { class: 'etiquette', texte: retourne ? 'Réponse' : 'Question' }),
          h('span', { texte: retourne ? c.r : c.q })),
        retourne
          ? h('div', { class: 'rangee' },
              h('button', { type: 'button', class: 'danger', onclick: function () { repondre(c, false); }, texte: 'Je ne savais pas' }),
              h('button', { type: 'button', class: 'principal', onclick: function () { repondre(c, true); }, texte: 'Je savais' }))
          : h('p', { class: 'doux petit', texte: 'Touche la carte pour voir la réponse.' }));
    }
    function repondre(c, ok) {
      var boutons = corps.querySelectorAll('button'); boutons.forEach(function (b) { b.disabled = true; });
      api('/api/cartes/' + encodeURIComponent(idLecon) + '/' + encodeURIComponent(c.id), { method: 'POST', corps: { su: ok } })
        .then(function () { if (ok) su++; pos++; retourne = false; dessiner(); })
        .catch(function (e) {
          if (e instanceof ErreurApi && e.status === 401) return erreurReseau(e);
          dessiner();
          corps.insertBefore(h('div', { class: 'boite erreur', role: 'alert', texte: messageErreur(e) }), corps.firstChild);
        });
    }
    demarrer(dues);
  }

  function ongletQuiz(corps, l, idLecon) {
    var qs = l.quiz || [];
    if (!qs.length) { ajouter(corps, h('p', { class: 'doux', texte: 'Pas de quiz pour cette leçon.' })); return; }
    var pos = 0, score = 0;
    function dessiner() {
      vider(corps);
      if (pos >= qs.length) return fin();
      var q = qs[pos], repondu = false;
      var zoneExpl = h('div', { 'aria-live': 'polite' });
      var boutons = (q.choix || []).map(function (texte, i) {
        var b = h('button', { type: 'button', onclick: function () {
          if (repondu) return;
          repondu = true;
          var bon = i === q.bonne;
          if (bon) score++;
          boutons.forEach(function (x, j) { x.disabled = true; if (j === q.bonne) x.classList.add('bon'); else if (j === i) x.classList.add('mauvais'); });
          ajouter(zoneExpl,
            h('div', { class: 'boite ' + (bon ? 'ok' : 'erreur') },
              h('strong', { texte: bon ? 'Bien joué !' : 'Pas tout à fait.' }),
              q.explication ? h('p', { texte: q.explication }) : null),
            h('button', { type: 'button', class: 'principal plein', onclick: function () { pos++; dessiner(); }, texte: pos + 1 < qs.length ? 'Question suivante' : 'Voir mon score' }));
        } }, h('span', { texte: String.fromCharCode(65 + i) + '. ' + texte }));
        return b;
      });
      ajouter(corps,
        h('p', { class: 'doux petit', texte: 'Question ' + (pos + 1) + ' sur ' + qs.length }),
        h('progress', { max: String(qs.length), value: String(pos), 'aria-label': 'Avancement' }),
        h('h2', { texte: q.question }),
        h('div', { class: 'choix' }, boutons),
        zoneExpl);
    }
    function fin() {
      var zone = h('div', { 'aria-live': 'polite' }, h('p', { class: 'doux', texte: 'Enregistrement du score…' }));
      ajouter(corps,
        h('div', { class: 'boite ' + (score >= qs.length / 2 ? 'ok' : 'info') },
          h('h2', { texte: 'Ton score : ' + score + ' sur ' + qs.length })),
        zone,
        h('div', { class: 'rangee' },
          h('button', { type: 'button', onclick: function () { pos = 0; score = 0; dessiner(); }, texte: 'Recommencer' }),
          h('a', { class: 'btn principal', href: '#/lecon/' + encodeURIComponent(idLecon) + '/cartes', texte: 'Réviser les cartes' })));
      envoyer();
      function envoyer() {
        api('/api/quiz/' + encodeURIComponent(idLecon), { method: 'POST', corps: { score: score, total: qs.length } })
          .then(function () { vider(zone); ajouter(zone, h('p', { class: 'doux petit', texte: 'Score enregistré.' })); })
          .catch(function (e) {
            if (e instanceof ErreurApi && e.status === 401) return erreurReseau(e);
            vider(zone);
            ajouter(zone, h('div', { class: 'boite erreur', role: 'alert' }, h('p', { texte: 'Ton score n’a pas pu être enregistré. ' + messageErreur(e) }),
              h('button', { type: 'button', onclick: function () { vider(zone); ajouter(zone, h('p', { class: 'doux', texte: 'Nouvel essai…' })); envoyer(); }, texte: 'Réessayer' })));
          });
      }
    }
    dessiner();
  }

  function ongletExercices(corps, l, idLecon) {
    var exos = l.exercices || [];
    if (!exos.length) { ajouter(corps, h('p', { class: 'doux', texte: 'Pas d’exercice pour cette leçon.' })); return; }
    exos.forEach(function (ex, i) {
      var retour = h('div', { 'aria-live': 'polite' });
      var n = i + 1;
      var message = 'Corrige ma réponse à l’exercice ' + n + ' de la leçon "' + l.titre + '" (id ' + idLecon + ') avec le connecteur Révision. Ma réponse : ';
      ajouter(corps, h('section', { class: 'carte' },
        h('h2', { texte: 'Exercice ' + n }),
        bloc(ex.enonce, 'fiche'),
        h('details', null, h('summary', { texte: 'Voir le corrigé' }), h('div', { class: 'dedans' }, bloc(ex.corrige, 'fiche'))),
        h('button', { type: 'button', class: 'plein', onclick: function () {
          copier(message).then(function (ok) {
            vider(retour);
            ajouter(retour, h('div', { class: ok ? 'boite ok' : 'boite' },
              h('p', { texte: ok ? 'Message copié.' : 'Copie ce message à la main :' }),
              ok ? null : h('textarea', { readonly: true, rows: '4', 'aria-label': 'Message à copier', texte: message }),
              h('p', { texte: 'Ouvre Claude, colle le message, puis écris ta réponse à la fin.' }),
              h('a', { class: 'btn principal plein', href: 'https://claude.ai', target: '_blank', rel: 'noopener noreferrer', texte: 'Ouvrir Claude' })));
          });
        }, texte: 'Faire corriger' }),
        retour));
    });
  }

  /* ---------- Ajouter un cours ---------- */

  function vueAjouter() {
    dessinerNav('ajouter'); titrePage('Ajouter un cours');
    var etatEnvoi = h('div', { 'aria-live': 'polite' });
    var liste = h('div');
    var photo = h('input', { type: 'file', id: 'f-photo', class: 'entree-fichier', accept: 'image/*', capture: 'environment' });
    var fichier = h('input', { type: 'file', id: 'f-fichier', class: 'entree-fichier', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain,.heic,.pdf,.txt' });
    photo.addEventListener('change', function () { choisi(photo); });
    fichier.addEventListener('change', function () { choisi(fichier); });

    afficher(
      h('h1', { texte: 'Ajouter un cours' }),
      h('p', { texte: 'Prends ton cours en photo, ou choisis un fichier (photo, PDF ou texte, 10 Mo au maximum).' }),
      h('div', { class: 'rangee' },
        photo, h('label', { class: 'btn principal', for: 'f-photo', texte: 'Prendre une photo' }),
        fichier, h('label', { class: 'btn', for: 'f-fichier', texte: 'Choisir un fichier' })),
      etatEnvoi,
      h('div', { class: 'boite info' },
        h('strong', { texte: 'Et ensuite ?' }),
        h('p', { texte: 'Ouvre Claude et dis : « ' + (window.PHRASE_RANGER || 'Range mes cours') + ' ».' }),
        h('p', { class: 'petit doux' }, 'Claude lit ce qui attend ci-dessous et fabrique tes fiches. Il faut avoir relié Claude au site une fois : ', h('a', { href: '#/connecteur', texte: 'voir comment faire' }), '.')),
      h('h2', { texte: 'En attente d’être rangé' }),
      liste);
    chargerListe();

    function chargerListe() {
      return api('/api/a-trier').then(function (items) {
        vider(liste);
        items = items || [];
        if (!items.length) { ajouter(liste, h('p', { class: 'doux', texte: 'Rien en attente pour le moment.' })); return; }
        ajouter(liste, items.map(function (it) {
          return h('div', { class: 'carte' }, h('strong', { texte: it.nom || 'Fichier' }), it.date ? h('div', { class: 'doux petit', texte: 'Envoyé le ' + dateCourte(it.date) }) : null);
        }));
      }).catch(function (e) {
        if (e instanceof ErreurApi && e.status === 401) return erreurReseau(e);
        vider(liste);
        ajouter(liste, h('div', { class: 'boite erreur', role: 'alert' }, h('p', { texte: messageErreur(e) }), h('button', { type: 'button', onclick: chargerListe, texte: 'Réessayer' })));
      });
    }

    function choisi(input) {
      var f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      if (f.size > 40 * 1024 * 1024) {
        vider(etatEnvoi);
        ajouter(etatEnvoi, h('div', { class: 'boite erreur', role: 'alert', texte: 'Ce fichier est beaucoup trop gros (10 Mo au maximum).' }));
        return;
      }
      envoyer(f);
    }

    var AIDE_JPEG = 'Si Claude n\u2019arrive pas à la lire, reprends la photo en JPEG (réglage Appareil photo > Formats > Le plus compatible).';
    function reduire(f) {
      /* Images : 1600 px max sur le grand côté, JPEG qualité 0,85. Sinon : fichier tel quel. */
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return Promise.resolve({ fichier: f, tel_quel: false });
      /* createImageBitmap plutôt qu'une image blob: (bloquée par la CSP default-src 'self'). */
      if (!window.createImageBitmap) return Promise.resolve({ fichier: f, tel_quel: true });
      var abandon = new Promise(function (ok) { setTimeout(function () { ok({ fichier: f, tel_quel: true }); }, 20000); });
      return Promise.race([abandon, window.createImageBitmap(f).then(function (img) {
        var l = img.width, hh = img.height;
        var k = Math.min(1, 1600 / Math.max(l, hh));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(l * k)); c.height = Math.max(1, Math.round(hh * k));
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        if (img.close) img.close();
        return new Promise(function (ok) {
          c.toBlob(function (bl) {
            if (!bl) return ok({ fichier: f, tel_quel: true });
            ok({ fichier: new File([bl], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }), tel_quel: false });
          }, 'image/jpeg', 0.85);
        });
      }, function () { return { fichier: f, tel_quel: true }; })]);
    }
    function envoyer(origine) {
      vider(etatEnvoi); ajouter(etatEnvoi, h('div', { class: 'carte' }, h('p', { class: 'doux', texte: 'Préparation de ' + origine.name + '…' })));
      reduire(origine).then(function (r) {
        if (r.fichier.size > 10 * 1024 * 1024) {
          vider(etatEnvoi);
          ajouter(etatEnvoi, h('div', { class: 'boite erreur', role: 'alert', texte: 'Ce fichier est trop gros (10 Mo au maximum).' }));
          return;
        }
        transmettre(r.fichier, r.tel_quel, origine);
      });
    }
    function transmettre(f, telQuel, origine) {
      var barre = h('progress', { max: '100', value: '0', 'aria-label': 'Envoi en cours' });
      var texte = h('p', { class: 'doux', texte: 'Envoi de ' + f.name + '…' });
      vider(etatEnvoi); ajouter(etatEnvoi, h('div', { class: 'carte' }, texte, barre));
      var fd = new FormData();
      fd.append('fichier', f, f.name);
      var x = new XMLHttpRequest();
      x.open('POST', '/api/a-trier');
      x.withCredentials = true;
      x.upload.addEventListener('progress', function (ev) {
        if (ev.lengthComputable) barre.value = Math.round(ev.loaded / ev.total * 100);
      });
      x.addEventListener('load', function () {
        var json = null; try { json = JSON.parse(x.responseText); } catch (e) { json = null; }
        vider(etatEnvoi);
        if (x.status === 401) { etat.moi = null; return accueilPublic(); }
        if (x.status >= 200 && x.status < 300) {
          ajouter(etatEnvoi, h('div', { class: 'boite ok', role: 'status' }, h('p', { texte: 'C’est envoyé. Tu peux en ajouter d’autres.' }), telQuel ? h('p', { class: 'petit', texte: AIDE_JPEG }) : null));
          chargerListe();
        } else {
          ajouter(etatEnvoi, h('div', { class: 'boite erreur', role: 'alert', texte: messageErreur(new ErreurApi(x.status, json)) }));
        }
      });
      x.addEventListener('error', function () {
        vider(etatEnvoi);
        ajouter(etatEnvoi, h('div', { class: 'boite erreur', role: 'alert' }, h('p', { texte: messageErreur(new Error('reseau')) }), h('button', { type: 'button', onclick: function () { envoyer(origine); }, texte: 'Réessayer' })));
      });
      x.send(fd);
    }
  }

  /* ---------- Connecteur ---------- */

  function vueConnecteur() {
    dessinerNav('compte'); titrePage('Relier Claude');
    var adresse = (etat.moi && etat.moi.connecteur_url) || (location.origin + '/mcp');
    var retour = h('div', { 'aria-live': 'polite' });
    afficher(
      h('a', { class: 'retour', href: '#/compte', texte: '← Compte' }),
      h('h1', { texte: 'Relier Claude' }),
      h('p', { texte: 'Pour que Claude puisse lire tes cours et fabriquer tes fiches, il faut l’autoriser une seule fois. Voici l’adresse à lui donner.' }),
      h('div', { class: 'adresse', id: 'adresse-connecteur', texte: adresse }),
      h('button', { type: 'button', class: 'principal plein', onclick: function () {
        copier(adresse).then(function (ok) {
          vider(retour);
          ajouter(retour, h('p', { class: 'doux', role: 'status', texte: ok ? 'Adresse copiée.' : 'Copie impossible ici : sélectionne l’adresse à la main.' }));
        });
      }, texte: 'Copier l’adresse' }),
      retour,
      h('h2', { texte: 'Les étapes dans Claude' }),
      h('ol', { class: 'etapes' }, (window.CLAUDE_ETAPES || []).map(function (e) { return h('li', { texte: e }); })),
      h('a', { class: 'btn plein', href: 'https://claude.ai', target: '_blank', rel: 'noopener noreferrer', texte: 'Ouvrir Claude' }),
      h('p', { class: 'doux petit', texte: 'Les noms des boutons peuvent changer un peu dans Claude. Si tu ne trouves pas un libellé, cherche le mot « Connectors ». Ça marche avec l\u2019offre gratuite de Claude (un seul connecteur personnalisé), Pro ou Max.' }));
  }

  /* ---------- Compte ---------- */

  function vueCompte() {
    dessinerNav('compte'); titrePage('Compte');
    var zone = h('div', { 'aria-live': 'polite' });
    var retourClaude = h('div', { 'aria-live': 'polite' });
    afficher(
      h('h1', { texte: 'Compte' }),
      h('div', { class: 'carte' },
        h('strong', { texte: (etat.moi && etat.moi.nom) || 'Ton compte' }),
        h('div', { class: 'doux', texte: (etat.moi && etat.moi.email) || '' })),
      h('a', { class: 'carte', href: '#/connecteur' }, h('strong', { texte: 'Relier Claude' }), h('span', { class: 'doux petit', texte: 'L’adresse à copier et les étapes.' })),
      h('div', { class: 'rangee' },
        h('button', { type: 'button', onclick: deconnexion, texte: 'Se déconnecter' }),
        h('button', { type: 'button', onclick: deconnecterClaude, texte: 'Déconnecter Claude' })),
      retourClaude,
      h('h2', { texte: 'Supprimer mon compte' }),
      h('p', { class: 'doux', texte: 'Cela efface tout ce que le site garde sur toi : ton compte, tes leçons en copie et ta progression. Tes fichiers dans ton Google Drive ne sont pas touchés.' }),
      zone,
      h('p', { class: 'pied' },
        h('a', { href: '/confidentialite.html', texte: 'Confidentialité' }), ' · ',
        h('a', { href: '/conditions.html', texte: 'Conditions' })));
    boutonSuppr();
    function boutonSuppr() {
      vider(zone);
      ajouter(zone, h('button', { type: 'button', class: 'danger plein', onclick: confirmer, texte: 'Supprimer mon compte' }));
    }
    function confirmer() {
      vider(zone);
      ajouter(zone, h('div', { class: 'boite erreur', role: 'alert' },
        h('p', { texte: 'Tu es sûr·e ? Cette action est définitive.' }),
        h('div', { class: 'rangee' },
          h('button', { type: 'button', onclick: boutonSuppr, texte: 'Non, je garde' }),
          h('button', { type: 'button', class: 'danger', onclick: supprimer, texte: 'Oui, tout supprimer' }))));
    }
    function supprimer() {
      vider(zone); ajouter(zone, h('p', { class: 'doux', texte: 'Suppression…' }));
      api('/api/compte', { method: 'DELETE' }).then(function () {
        etat.moi = null; location.hash = '#/'; accueilPublic();
        ajouter(main, h('div', { class: 'boite ok', role: 'status', texte: 'Ton compte est supprimé.' }));
      }).catch(function (e) {
        if (e instanceof ErreurApi && e.status === 401) return erreurReseau(e);
        vider(zone);
        ajouter(zone, h('div', { class: 'boite erreur', role: 'alert' }, h('p', { texte: messageErreur(e) }), h('button', { type: 'button', onclick: confirmer, texte: 'Réessayer' })));
      });
    }
    function deconnecterClaude() {
      vider(retourClaude);
      api('/api/compte/deconnecter-claude', { method: 'POST' }).then(function () {
        ajouter(retourClaude, h('div', { class: 'boite ok', role: 'status', texte: 'Claude est déconnecté. Pour le relier de nouveau, ajoute le connecteur dans Claude.' }));
      }).catch(function (e) {
        if (e instanceof ErreurApi && e.status === 401) return erreurReseau(e);
        ajouter(retourClaude, h('div', { class: 'boite erreur', role: 'alert', texte: messageErreur(e) }));
      });
    }
    function deconnexion() {
      fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () { return null; }).then(function () {
        etat.moi = null; location.hash = '#/'; accueilPublic();
      });
    }
  }

  /* ---------- Routeur ---------- */

  function route() {
    var jeton = ++etat.jeton;
    var morceaux = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    var page = morceaux[0] || '';
    var suite;
    if (!etat.moi) {
      suite = api('/api/moi').then(function (m) { etat.moi = m; etat.googlePret = m.google_pret; }).catch(function (e) {
        if (e instanceof ErreurApi && e.status === 401) {
          etat.moi = null;
          if (e.corps && typeof e.corps.google_pret === 'boolean') etat.googlePret = e.corps.google_pret;
          return 'public';
        }
        throw e;
      });
    } else suite = Promise.resolve();
    suite.then(function (r) {
      if (jeton !== etat.jeton) return;
      if (r === 'public' || !etat.moi) return accueilPublic();
      switch (page) {
        case 'cours': return vueCours();
        case 'ajouter': return vueAjouter();
        case 'connecteur': return vueConnecteur();
        case 'compte': return vueCompte();
        case 'lecon': return vueLecon(morceaux[1], morceaux[2]);
        default: return vueAujourdhui();
      }
    }).catch(function (e) { if (jeton === etat.jeton) { dessinerNav(''); erreurReseau(e, route); } });
  }

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () { return null; }); });
  }
})();
