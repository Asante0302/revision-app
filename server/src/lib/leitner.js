import { ajouterJours } from './dates.js';
export const INTERVALLES = [0, 1, 3, 7, 14]; // jours, par boîte 1 à 5
export function apresReponse(boiteActuelle, su, aujourdhui) {
  const boite = su ? Math.min((boiteActuelle || 1) + 1, 5) : 1;
  return { boite, prochaine: ajouterJours(aujourdhui, INTERVALLES[boite - 1]) };
}
