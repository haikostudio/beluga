/**
 * DEUX PIÈCES JOINTES DE MÊME NOM, DEUX TAGS DISTINCTS.
 *
 * Deux images collées s'appellent souvent toutes deux « image.png ». Le tag
 * du texte les retrouvait par leur NOM : les deux pastilles montraient
 * « #247c », et l'agent recevait deux fois le même fichier. Le composeur écrit
 * désormais la DÉSIGNATION (« image.png #f0da ») ; ces essais verrouillent la
 * résolution par alias, et le repli par nom des tags d'avant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ancre,
  contenuDuTagDe,
  designationDePiece,
  etiquetteDuTag,
  insereAncre,
  jointesApresFrappe,
  jointesDesTags,
  masquesDuTexte,
  retireAncre,
  sansMasque,
  tagsAvecAlias,
  tagsDuTexte,
  tagsMasques,
  texteAvecEtiquettes,
  texteAvecTagsDesJointes,
  type Attachment,
} from '@beluga/shared';

const premiere = { id: '247c0000-0000-4000-8000-000000000001', name: 'image.png', alias: '247c' };
const seconde = { id: 'f0da0000-0000-4000-8000-000000000002', name: 'image.png', alias: 'f0da' };
const jointes = [premiere, seconde];

function texteAvecDeuxImages(): string {
  let texte = 'la demo';
  texte = insereAncre(texte, designationDePiece(premiere), null).texte;
  texte = `${texte} et corriger ça`;
  return insereAncre(texte, designationDePiece(seconde), null).texte;
}

test('la désignation porte le nom et l’alias ; sans alias, le nom seul', () => {
  assert.equal(designationDePiece(seconde), 'image.png #f0da');
  assert.equal(designationDePiece({ id: 'x', name: 'vieux.png' }), 'vieux.png');
});

test('deux homonymes montrent chacun leur étiquette', () => {
  const tags = tagsDuTexte(texteAvecDeuxImages());
  assert.deepEqual(
    tags.map((tag) => etiquetteDuTag(tag.nom, jointes)),
    ['#247c', '#f0da'],
  );
});

test('ce qui part au moteur désigne chaque fichier, sans alias doublé', () => {
  const texte = texteAvecDeuxImages().replace(/ /g, ' ');
  const envoye = tagsAvecAlias(texte, jointes, tagsDuTexte(texte));
  assert.equal(envoye, 'la demo [fichier: image.png #247c] et corriger ça [fichier: image.png #f0da]');
});

test('un tag d’avant (nom seul) se résout encore par son nom', () => {
  const texte = 'voir [fichier: image.png]';
  assert.equal(etiquetteDuTag('image.png', jointes), '#247c');
  assert.equal(tagsAvecAlias(texte, jointes, tagsDuTexte(texte)), 'voir [fichier: image.png #247c]');
});

test('un alias inconnu ne vise aucune pièce', () => {
  assert.equal(etiquetteDuTag('image.png #beef', jointes), 'image.png #beef');
});

test('le fil montre les deux étiquettes distinctes', () => {
  const texte = texteAvecDeuxImages();
  assert.match(texteAvecEtiquettes(texte, jointes, tagsDuTexte(texte)), /#247c\].*#f0da\]/);
});

test('le masque garde la longueur et se relit à l’identique', () => {
  const texte = texteAvecDeuxImages();
  const masque = tagsMasques(texte, jointes);
  assert.equal(masque.length, texte.length);
  assert.equal(sansMasque(masque, jointes), texte);
  assert.deepEqual(
    masquesDuTexte(masque, jointes).map((tag) => tag.nom),
    ['image.png #247c', 'image.png #f0da'],
  );
  // Un tag d'avant, masqué puis relu, garde son nom seul.
  const ancien = `voir ${ancre('image.png')}`;
  assert.equal(sansMasque(tagsMasques(ancien, jointes), jointes), ancien);
});

test('effacer le second tag ne retire que la seconde pièce', () => {
  const avant = texteAvecDeuxImages();
  const apres = retireAncre(avant, contenuDuTagDe(avant, seconde));
  assert.equal(tagsDuTexte(apres).length, 1);
  assert.deepEqual(jointesApresFrappe(jointes, avant, apres).map((p) => p.alias), ['247c']);
  // Et la première, sans toucher à la seconde.
  const sansPremiere = retireAncre(avant, contenuDuTagDe(avant, premiere));
  assert.deepEqual(jointesApresFrappe(jointes, avant, sansPremiere).map((p) => p.alias), ['f0da']);
});

test('copier puis coller retrouve chaque pièce par son alias', () => {
  const connues = jointes.map((p, i) => ({
    ...p,
    projectId: 'p',
    mime: 'image/png',
    size: 1,
    createdAt: i,
  })) as Attachment[];
  const copie = texteAvecTagsDesJointes('rien', connues);
  assert.equal(copie, 'rien [fichier: image.png #247c] [fichier: image.png #f0da]');
  assert.deepEqual(jointesDesTags(copie, connues).map((p) => p.alias), ['247c', 'f0da']);
  // Le nom seul prend toujours la plus récente.
  assert.deepEqual(jointesDesTags('[fichier: image.png]', connues).map((p) => p.alias), ['f0da']);
});
