import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * AUCUNE BARRE NI BORDURE COLORÉE SUR LE BORD GAUCHE (carte « Ordinateurs : pannes et volets alignés », 22/11/2026).
 * L'utilisateur a rejeté pour de bon le motif « bloc à bord gauche coloré » (volet en panne marqué d'une barre rouge,
 * ligne choisie d'un tableau marquée d'un trait violet, citation marquée d'un trait gris) : l'état se dit par la
 * pastille, le texte et le fond. Ce contrôle relit toute l'interface et refuse le retour du motif. Restent permis : les
 * traits d'ARBRE et de LIGNE DE TEMPS (`border-l` nu, coudés, sans couleur d'état), les graduations, et la séparation
 * de panneau d'un pixel (`inset_1px_0_0`).
 */
const ICI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(ICI, '../../../web/src');

const MOTIFS: { motif: RegExp; pourquoi: string }[] = [
  { motif: /border-l-(?:[2-9]|\[)/, pourquoi: 'bordure gauche épaisse' },
  { motif: /border-s-(?:[2-9]|\[)/, pourquoi: 'bordure de début épaisse' },
  { motif: /inset_[2-9](?:\.\d+)?px_0_0/, pourquoi: 'ombre intérieure qui dessine une barre à gauche' },
  { motif: /border-l\s+border-(?:danger|teinte|coche|accent|ok|attention|succes|erreur|cadre-question|serie-\d)/, pourquoi: 'bordure gauche colorée' },
  {
    motif: /(?=[^"'`]*\binset-y-0\b)(?=[^"'`]*\bleft-0\b)(?=[^"'`]*\bw-(?:\[[1-4]px\]|0\.5|1)(?![\d/.]))[^"'`]*/,
    pourquoi: 'barre posée contre le bord gauche',
  },
  { motif: /border-left\s*:\s*[2-9]/, pourquoi: 'bordure gauche épaisse en CSS' },
];

function fichiers(dossier: string): string[] {
  const sortie: string[] = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, e.name);
    if (e.isDirectory()) sortie.push(...fichiers(chemin));
    else if (/\.(tsx?|css)$/.test(e.name)) sortie.push(chemin);
  }
  return sortie;
}

test('aucune barre ni bordure colorée sur le bord gauche, nulle part dans l’interface', () => {
  const fautes: string[] = [];
  for (const f of fichiers(WEB)) {
    const lignes = fs.readFileSync(f, 'utf8').split('\n');
    lignes.forEach((ligne, i) => {
      for (const { motif, pourquoi } of MOTIFS) {
        if (motif.test(ligne)) fautes.push(`${path.relative(WEB, f)}:${i + 1} — ${pourquoi} : ${ligne.trim().slice(0, 140)}`);
      }
    });
  }
  assert.deepEqual(fautes, [], `le motif « bord gauche coloré » est revenu :\n${fautes.join('\n')}`);
});

test('le contrôle reconnaît bien les trois barres retirées', () => {
  const anciennes = [
    `<span className="absolute inset-y-0 left-0 w-[3px] bg-danger" aria-hidden />`,
    `rang === 0 && choisie && 'shadow-[inset_2px_0_0_hsl(var(--teinte))]',`,
    `@apply my-2 border-l-2 border-faint/60 pl-3 italic text-muted;`,
  ];
  for (const a of anciennes) assert.ok(MOTIFS.some(({ motif }) => motif.test(a)), a);
  /* …et laisse passer les traits d'arbre et la barre de progression. */
  for (const permis of [
    'className={`${trait} rounded-bl-[5px] border-b border-l`}',
    "'absolute inset-y-0 left-0 w-1/3 animate-cadrage-glisse',",
    'shadow-[inset_1px_0_0_hsl(var(--border))]',
  ]) {
    assert.ok(!MOTIFS.some(({ motif }) => motif.test(permis)), permis);
  }
});
