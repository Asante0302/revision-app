// File d'attente par clé : une seule opération à la fois par compte.
export function creerVerrous() {
  const chaines = new Map();
  return (cle, fn) => {
    const prec = chaines.get(cle) ?? Promise.resolve();
    const run = prec.then(fn);
    const queue = run.catch(() => {});
    chaines.set(cle, queue);
    queue.then(() => { if (chaines.get(cle) === queue) chaines.delete(cle); });
    return run;
  };
}
