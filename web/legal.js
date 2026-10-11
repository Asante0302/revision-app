/* Remplit l'adresse de contact des pages Confidentialité et Conditions (depuis config.js). */
(function () {
  'use strict';
  var c = (window.CONTACT || '').trim();
  document.querySelectorAll('[data-contact]').forEach(function (el) {
    if (!c) { el.textContent = 'l’adresse de contact indiquée dans le dépôt du projet (à renseigner)'; return; }
    if (c.indexOf('@') > 0 && c.indexOf(' ') < 0) {
      var a = document.createElement('a'); a.href = 'mailto:' + c; a.textContent = c; el.textContent = ''; el.appendChild(a);
    } else if (/^https:\/\//.test(c)) {
      var l = document.createElement('a'); l.href = c; l.textContent = c; l.rel = 'noopener'; el.textContent = ''; el.appendChild(l);
    } else el.textContent = c;
  });
})();
