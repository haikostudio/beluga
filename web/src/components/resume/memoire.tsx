import { BookOpen, Library, PencilLine, Search, ShieldX, Sparkles, Target } from 'lucide-react';
import { partRendue, tauxDAide, type ResumeMemoire } from '@beluga/shared';
import { TableauDeDonnees } from '@/components/ui/tableau-de-donnees';
import { t } from '@/lib/langue';
import {
  CourbeDuResume,
  EtatDeRubrique,
  Section,
  Tuile,
  Tuiles,
  dateCourte,
  dateHeure,
  msEnClair,
  nombre,
  partEnClair,
  somme,
  useResume,
  useTailleDePage,
  type ProprietesDeRubrique,
} from './commun';

/*
 * LA RUBRIQUE « MÉMOIRE ET COMPÉTENCES » : ce que la base de connaissances a
 * appris (unités créées, modifiées, refusées par la porte d'écriture), ce que
 * le pool de compétences a gagné, combien de fois la mémoire a été consultée
 * et ce qui a vraiment servi.
 *
 * DEUX MESURES DE PERTINENCE, définies au cadrage :
 *  - la part RENDUE : blocs réellement servis sur blocs demandés, à chaque
 *    consultation (`partRendue`) ;
 *  - le taux d'AIDE d'une compétence : aidée / (aidée + inutile + contredite)
 *    (`tauxDAide`). Ses compteurs courent depuis la création de la fiche, pas
 *    sur la période : l'écran le dit.
 */

export function RubriqueMemoire({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeMemoire>('memoire', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<Library className="h-3.5 w-3.5" />}
              titre={t('Connaissances apprises')}
              valeur={nombre(d.unitesCreees)}
              dessous={t('{v0} actives en tout', { v0: nombre(d.unitesActives) })}
              repere="unites"
            />
            <Tuile
              icone={<Sparkles className="h-3.5 w-3.5" />}
              titre={t('Compétences créées')}
              valeur={nombre(d.competencesCreees)}
              dessous={t('{v0} compétences en tout', { v0: nombre(d.competences) })}
              repere="competences"
            />
            <Tuile
              icone={<Search className="h-3.5 w-3.5" />}
              titre={t('Consultations')}
              valeur={nombre(d.appels)}
              dessous={t('{v0} en moyenne', { v0: msEnClair(d.dureeMoyenneMs) })}
              repere="appels"
            />
            <Tuile
              icone={<Target className="h-3.5 w-3.5" />}
              titre={t('Pertinence')}
              valeur={partEnClair(partRendue(d.blocsDemandes, d.blocsRendus))}
              dessous={t('des blocs trouvés ont été servis')}
              repere="pertinence"
            />
          </Tuiles>

          <Section
            titre={t('Ce que la mémoire a appris, jour par jour')}
            icone={<BookOpen className="h-3.5 w-3.5 text-faint" />}
            aide={t('Les barres : les connaissances enregistrées chaque jour. La ligne : les consultations de la mémoire par les agents.')}
          >
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Connaissances apprises'), valeurs: d.parJour.unites }}
              ligne={{ libelle: t('Consultations'), valeurs: d.parJour.appels }}
              vide={t("Rien d'enregistré ni de consulté sur la période.")}
            />
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-faint">
              <span className="flex items-center gap-1">
                <PencilLine className="h-3 w-3" />
                {t('{v0} modifications', { v0: nombre(d.modifications) })}
              </span>
              <span className="flex items-center gap-1">
                <ShieldX className="h-3 w-3" />
                {t("{v0} refus de la porte d'écriture", { v0: nombre(d.refus) })}
              </span>
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                {t('{v0} compétences créées', { v0: nombre(somme(d.parJour.competences)) })}
              </span>
            </p>
          </Section>

          <Section
            titre={t('Pertinence des consultations, par sujet')}
            icone={<Target className="h-3.5 w-3.5 text-faint" />}
            aide={t(
              "Pour chaque sujet consulté : le nombre d'appels, leur durée moyenne, et la part des blocs trouvés qui ont réellement été servis à l'agent.",
            )}
          >
            <TableauDeDonnees
              repere="sujets-memoire"
              lignes={d.sujets}
              cle={(s) => s.sujet}
              taille={taille}
              onTaille={setTaille}
              triInitial={{ colonne: 'appels', sens: 'desc' }}
              vide={t('Aucune consultation sur la période.')}
              colonnes={[
                { cle: 'sujet', libelle: t('Sujet'), valeur: (s) => s.sujet },
                { cle: 'appels', libelle: t('Appels'), valeur: (s) => s.appels, droite: true },
                {
                  cle: 'duree',
                  libelle: t('Durée moyenne'),
                  valeur: (s) => s.dureeMoyenneMs,
                  rendu: (s) => msEnClair(s.dureeMoyenneMs),
                  droite: true,
                  masqueSurTelephone: true,
                },
                { cle: 'demandes', libelle: t('Blocs demandés'), valeur: (s) => s.demandes, droite: true, masqueSurTelephone: true },
                { cle: 'rendus', libelle: t('Blocs servis'), valeur: (s) => s.rendus, droite: true, masqueSurTelephone: true },
                {
                  cle: 'pertinence',
                  libelle: t('Pertinence'),
                  valeur: (s) => partRendue(s.demandes, s.rendus),
                  rendu: (s) => partEnClair(partRendue(s.demandes, s.rendus)),
                  droite: true,
                },
              ]}
            />
          </Section>

          <Section
            titre={t('Compétences')}
            icone={<Sparkles className="h-3.5 w-3.5 text-faint" />}
            aide={t(
              'Chaque compétence du pool : quand elle est née, combien de fois elle a été servie, et ce que les agents en ont dit. Ces compteurs courent depuis sa création, pas seulement sur la période.',
            )}
          >
            <TableauDeDonnees
              repere="competences"
              lignes={d.fiches}
              cle={(f) => f.nom}
              taille={taille}
              onTaille={setTaille}
              triInitial={{ colonne: 'creee', sens: 'desc' }}
              vide={t('Aucune compétence dans le pool.')}
              colonnes={[
                { cle: 'nom', libelle: t('Compétence'), valeur: (f) => f.nom, largeur: 'sm:min-w-[200px]' },
                {
                  cle: 'creee',
                  libelle: t('Créée le'),
                  valeur: (f) => f.creeeLe,
                  rendu: (f) => (f.creeeLe ? dateCourte(f.creeeLe) : '—'),
                  droite: true,
                },
                { cle: 'servie', libelle: t('Servie'), valeur: (f) => f.servie, droite: true },
                { cle: 'aidee', libelle: t('Aidée'), valeur: (f) => f.aidee, droite: true, masqueSurTelephone: true },
                { cle: 'inutile', libelle: t('Inutile'), valeur: (f) => f.inutile, droite: true, masqueSurTelephone: true },
                { cle: 'contredite', libelle: t('Contredite'), valeur: (f) => f.contredite, droite: true, masqueSurTelephone: true },
                { cle: 'aide', libelle: t("Taux d'aide"), valeur: (f) => tauxDAide(f), rendu: (f) => partEnClair(tauxDAide(f)), droite: true },
                {
                  cle: 'dernier',
                  libelle: t('Dernier service'),
                  valeur: (f) => f.dernierService,
                  rendu: (f) => dateHeure(f.dernierService),
                  droite: true,
                  masqueSurTelephone: true,
                },
              ]}
            />
            <p className="mt-2 text-[12px] text-faint">{t("Taux d'aide de tout le pool : {v0}", { v0: partEnClair(d.tauxDAide) })}</p>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section titre={t('Connaissances apprises, par type')} icone={<Library className="h-3.5 w-3.5 text-faint" />}>
              <TableauDeDonnees
                repere="types-memoire"
                lignes={d.parType}
                cle={(l) => l.type}
                taille={taille}
                onTaille={setTaille}
                vide={t("Rien d'enregistré sur la période.")}
                colonnes={[
                  { cle: 'type', libelle: t('Type'), valeur: (l) => l.type },
                  { cle: 'nombre', libelle: t('Nombre'), valeur: (l) => l.nombre, droite: true },
                ]}
              />
            </Section>
            <Section titre={t('Connaissances, par projet')} icone={<Library className="h-3.5 w-3.5 text-faint" />}>
              <TableauDeDonnees
                repere="portees-memoire"
                lignes={d.parPortee}
                cle={(l) => l.portee}
                taille={taille}
                onTaille={setTaille}
                vide={t("Rien d'enregistré sur la période.")}
                colonnes={[
                  {
                    cle: 'projet',
                    libelle: t('Projet'),
                    valeur: (l) => (l.portee === 'global' ? t('Commun à tous les projets') : (l.nom ?? t('Projet retiré'))),
                  },
                  { cle: 'creees', libelle: t('Apprises'), valeur: (l) => l.creees, droite: true },
                  { cle: 'actives', libelle: t('Actives'), valeur: (l) => l.actives, droite: true },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </EtatDeRubrique>
  );
}
