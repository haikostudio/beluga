import assert from 'node:assert/strict';
import test from 'node:test';
import {
  libelleDOutil,
  libelleLisible,
  ligneDeSuggestion,
  lignesDeSuggestions,
  nomAfficheDOutil,
  nomSansPont,
} from '@beluga/shared';

test('un outil connu porte son nom en français, pont retiré', () => {
  assert.equal(nomSansPont('mcp__beluga__project_memory'), 'project_memory');
  assert.equal(libelleDOutil('mcp__beluga__project_memory'), 'Lecture de la mémoire du projet');
  assert.equal(libelleDOutil('ToolSearch'), 'Recherche d’un outil');
  assert.equal(libelleDOutil('TaskUpdate'), 'Mise à jour de la liste des tâches');
});

test('un outil inconnu garde son nom nu, jamais « Outil mcp__… »', () => {
  assert.equal(libelleDOutil('OutilQuiNExistePas'), undefined);
  assert.equal(nomAfficheDOutil('mcp__autre__machin'), 'machin');
});

test('un libellé technique déjà écrit dans le journal se remplace à l’affichage', () => {
  assert.equal(libelleLisible({ libelle: 'Outil ToolSearch' }), 'Recherche d’un outil');
  assert.equal(libelleLisible({ libelle: 'ToolSearch', outil: 'ToolSearch' }), 'Recherche d’un outil');
  assert.equal(
    libelleLisible({ libelle: 'Mémoire du projet : le détail sur « cartes »', outil: 'project_memory' }),
    'Mémoire du projet : le détail sur « cartes »',
    'un libellé déjà écrit en clair ne se réécrit pas',
  );
});

test('une idée retenue s’écrit en ligne de liste, une seule fois', () => {
  assert.equal(ligneDeSuggestion('Ajouter un filtre'), '- Ajouter un filtre');
  assert.equal(ligneDeSuggestion('- Ajouter un filtre'), '- Ajouter un filtre');
  assert.equal(lignesDeSuggestions(['a', 'b']), '- a\n- b');
});
