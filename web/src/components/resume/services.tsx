import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  Coins,
  Eye,
  Film,
  HardDriveDownload,
  Images,
  Key,
  Mail,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  PencilLine,
  Plus,
  Target,
  Timer,
  UsersRound,
  Archive,
} from 'lucide-react';
import {
  LIBELLES_IMPORTANCE,
  LIBELLE_TYPE_ACCES,
  TITRES_COLONNES_DEMANDE,
  type ResumeBackups,
  type ResumeCoffre,
  type ResumeMarketing,
  type ResumeMessagerie,
  type ResumeNotes,
  type ResumeStatistiques,
  type ResumeStudio,
  type ResumeSurveillance,
} from '@beluga/shared';
import { TableauDeDonnees } from '@/components/ui/tableau-de-donnees';
import { formatRegional, t } from '@/lib/langue';
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
  octetsEnClair,
  ouTiret,
  partEnClair,
  useResume,
  useTailleDePage,
  type ProprietesDeRubrique,
} from './commun';

/*
 * LES RUBRIQUES DES SERVICES DE BELUGA : Surveillance, Studio, Coffre-fort,
 * Backups, Statistiques, Messagerie, Marketing, Notes. Chacune : quatre
 * tuiles, une courbe par jour, puis ses tableaux.
 *
 * LE COFFRE-FORT ne reçoit que des COMPTES (par projet, par type) : le démon
 * ne lit même pas le nom des fiches pour cette rubrique.
 */

/** Un libellé français connu du dictionnaire, ou la valeur brute. */
function libelle<K extends string>(table: Readonly<Record<K, string>>, cle: string): string {
  return cle in table ? t(table[cle as K]) : cle;
}

const dollars = (montant: number) => `${montant.toLocaleString(formatRegional(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const centimes = (montant: number) => (montant / 100).toLocaleString(formatRegional(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------------ */
/* Surveillance                                                        */
/* ------------------------------------------------------------------ */

export function RubriqueSurveillance({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeSurveillance>('surveillance', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<Activity className="h-3.5 w-3.5" />}
              titre={t('Sites surveillés')}
              valeur={nombre(d.sites)}
              dessous={t('{v0} constats WordPress ouverts', { v0: nombre(d.constatsOuverts) })}
              repere="sites"
            />
            <Tuile
              icone={<CheckCircle2 className="h-3.5 w-3.5" />}
              titre={t('Contrôles')}
              valeur={nombre(d.controles)}
              dessous={t('Disponibilité {v0}', { v0: partEnClair(d.controles ? 1 - d.pannes / d.controles : null) })}
              repere="controles"
            />
            <Tuile
              icone={<AlertTriangle className="h-3.5 w-3.5" />}
              titre={t('Pannes constatées')}
              valeur={nombre(d.pannes)}
              dessous={t('contrôles en échec')}
              repere="pannes"
            />
            <Tuile
              icone={<Timer className="h-3.5 w-3.5" />}
              titre={t('Temps de réponse')}
              valeur={msEnClair(d.dureeMoyenneMs)}
              dessous={t('en moyenne, par contrôle')}
              repere="reponse"
            />
          </Tuiles>
          <Section titre={t('Contrôles, jour par jour')} icone={<Activity className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Contrôles'), valeurs: d.parJour.controles }}
              ligne={{ libelle: t('Pannes'), valeurs: d.parJour.pannes }}
              vide={t('Aucun contrôle sur la période.')}
            />
          </Section>
          <Section titre={t('Sites surveillés')} icone={<Activity className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="sites-surveilles"
              lignes={d.lignes}
              cle={(l) => l.id}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucun site surveillé.')}
              colonnes={[
                { cle: 'nom', libelle: t('Site'), valeur: (l) => l.nom, largeur: 'sm:min-w-[180px]' },
                {
                  cle: 'etat',
                  libelle: t('État'),
                  valeur: (l) => l.etat,
                  rendu: (l) => (l.etat === 'ok' ? t('En ligne') : l.etat === 'panne' ? t('En panne') : t('Inconnu')),
                },
                { cle: 'controles', libelle: t('Contrôles'), valeur: (l) => l.controles, droite: true, masqueSurTelephone: true },
                { cle: 'pannes', libelle: t('Pannes'), valeur: (l) => l.pannes, droite: true },
                {
                  cle: 'dispo',
                  libelle: t('Disponibilité'),
                  valeur: (l) => (l.controles ? 1 - l.pannes / l.controles : null),
                  rendu: (l) => partEnClair(l.controles ? 1 - l.pannes / l.controles : null),
                  droite: true,
                },
                {
                  cle: 'reponse',
                  libelle: t('Temps de réponse'),
                  valeur: (l) => l.dureeMoyenneMs || null,
                  rendu: (l) => (l.dureeMoyenneMs ? msEnClair(l.dureeMoyenneMs) : '—'),
                  droite: true,
                  masqueSurTelephone: true,
                },
                {
                  cle: 'constats',
                  libelle: t('Constats WordPress'),
                  valeur: (l) => (l.wordpress ? l.constats : null),
                  droite: true,
                  masqueSurTelephone: true,
                },
                {
                  cle: 'panne',
                  libelle: t('Dernière panne'),
                  valeur: (l) => l.dernierePanne,
                  rendu: (l) => dateHeure(l.dernierePanne),
                  droite: true,
                  masqueSurTelephone: true,
                },
              ]}
            />
          </Section>
        </>
      )}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

export function RubriqueStudio({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeStudio>('studio', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<Clapperboard className="h-3.5 w-3.5" />}
              titre={t('Créations')}
              valeur={nombre(d.creations)}
              dessous={t('commencées sur la période')}
              repere="creations"
            />
            <Tuile
              icone={<Film className="h-3.5 w-3.5" />}
              titre={t('Exports')}
              valeur={nombre(d.exports)}
              dessous={t('{v0} en échec', { v0: nombre(d.exportsEnEchec) })}
              repere="exports"
            />
            <Tuile
              icone={<Images className="h-3.5 w-3.5" />}
              titre={t('Médias ajoutés')}
              valeur={nombre(d.medias)}
              dessous={t('images, sons et vidéos')}
              repere="medias"
            />
            <Tuile
              icone={<Coins className="h-3.5 w-3.5" />}
              titre={t('Dépenses')}
              valeur={dollars(d.depense)}
              dessous={t('facturées par les fournisseurs')}
              repere="depense"
            />
          </Tuiles>
          <Section titre={t('Créations et exports, jour par jour')} icone={<Clapperboard className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Exports'), valeurs: d.parJour.exports }}
              ligne={{ libelle: t('Créations'), valeurs: d.parJour.creations }}
              vide={t('Aucune création ni export sur la période.')}
            />
          </Section>
          <Section titre={t('Créations')} icone={<Clapperboard className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="creations-studio"
              lignes={d.lignes}
              cle={(l) => l.id}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucune création travaillée sur la période.')}
              colonnes={[
                { cle: 'titre', libelle: t('Création'), valeur: (l) => l.titre, largeur: 'sm:min-w-[180px]' },
                { cle: 'projet', libelle: t('Projet'), valeur: (l) => l.projet ?? t('Projet retiré'), masqueSurTelephone: true },
                { cle: 'etat', libelle: t('État'), valeur: (l) => l.etat, rendu: (l) => (l.etat === 'exportee' ? t('Exportée') : t('Brouillon')) },
                { cle: 'exports', libelle: t('Exports'), valeur: (l) => l.exports, droite: true },
                {
                  cle: 'depense',
                  libelle: t('Dépenses'),
                  valeur: (l) => l.depense,
                  rendu: (l) => dollars(l.depense),
                  droite: true,
                  masqueSurTelephone: true,
                },
                {
                  cle: 'creee',
                  libelle: t('Créée le'),
                  valeur: (l) => l.creeLe,
                  rendu: (l) => dateCourte(l.creeLe),
                  droite: true,
                  masqueSurTelephone: true,
                },
                { cle: 'maj', libelle: t('Modifiée le'), valeur: (l) => l.majLe, rendu: (l) => dateHeure(l.majLe), droite: true },
              ]}
            />
          </Section>
        </>
      )}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Coffre-fort                                                          */
/* ------------------------------------------------------------------ */

export function RubriqueCoffre({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeCoffre>('coffre', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<Key className="h-3.5 w-3.5" />}
              titre={t('Accès rangés')}
              valeur={nombre(d.fiches)}
              dessous={t('{v0} projets', { v0: nombre(d.parProjet.length) })}
              repere="fiches"
            />
            <Tuile
              icone={<Plus className="h-3.5 w-3.5" />}
              titre={t('Ajoutés')}
              valeur={nombre(d.creees)}
              dessous={t('sur la période')}
              repere="creees"
            />
            <Tuile
              icone={<PencilLine className="h-3.5 w-3.5" />}
              titre={t('Modifiés')}
              valeur={nombre(d.modifiees)}
              dessous={t('sur la période')}
              repere="modifiees"
            />
            <Tuile
              icone={<Archive className="h-3.5 w-3.5" />}
              titre={t('Archivés')}
              valeur={nombre(d.archivees)}
              dessous={t('sur la période')}
              repere="archivees"
            />
          </Tuiles>
          <Section titre={t('Accès ajoutés et modifiés, jour par jour')} icone={<Key className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Ajoutés'), valeurs: d.parJour.creees }}
              ligne={{ libelle: t('Modifiés'), valeurs: d.parJour.modifiees }}
              vide={t('Aucun accès ajouté ni modifié sur la période.')}
            />
          </Section>
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Section titre={t('Par projet')} icone={<Key className="h-3.5 w-3.5 text-faint" />}>
              <TableauDeDonnees
                repere="coffre-projets"
                lignes={d.parProjet}
                cle={(l) => l.projet ?? '—'}
                taille={taille}
                onTaille={setTaille}
                vide={t('Le coffre est vide.')}
                colonnes={[
                  { cle: 'projet', libelle: t('Projet'), valeur: (l) => (l.projet ? (l.nom ?? t('Projet retiré')) : t('Commun à tous les projets')) },
                  { cle: 'fiches', libelle: t('Accès'), valeur: (l) => l.fiches, droite: true },
                  { cle: 'creees', libelle: t('Ajoutés'), valeur: (l) => l.creees, droite: true, masqueSurTelephone: true },
                  { cle: 'modifiees', libelle: t('Modifiés'), valeur: (l) => l.modifiees, droite: true, masqueSurTelephone: true },
                  {
                    cle: 'derniere',
                    libelle: t('Dernière modification'),
                    valeur: (l) => l.derniereModif,
                    rendu: (l) => dateHeure(l.derniereModif),
                    droite: true,
                  },
                ]}
              />
            </Section>
            <Section titre={t('Par type')} icone={<Key className="h-3.5 w-3.5 text-faint" />}>
              <TableauDeDonnees
                repere="coffre-types"
                lignes={d.parType}
                cle={(l) => l.type}
                taille={taille}
                onTaille={setTaille}
                vide={t('Le coffre est vide.')}
                colonnes={[
                  { cle: 'type', libelle: t('Type'), valeur: (l) => libelle(LIBELLE_TYPE_ACCES, l.type) },
                  { cle: 'fiches', libelle: t('Accès'), valeur: (l) => l.fiches, droite: true },
                  { cle: 'creees', libelle: t('Ajoutés'), valeur: (l) => l.creees, droite: true },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Backups                                                             */
/* ------------------------------------------------------------------ */

export function RubriqueBackups({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeBackups>('backups', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  const statut = (s: string) => (s === 'reussi' ? t('Réussie') : s === 'partiel' ? t('Partielle') : s === 'echec' ? t('En échec') : s);
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile icone={<HardDriveDownload className="h-3.5 w-3.5" />} titre={t('Sites sauvegardés')} valeur={nombre(d.sites)} repere="sites" />
            <Tuile
              icone={<CheckCircle2 className="h-3.5 w-3.5" />}
              titre={t('Sauvegardes prises')}
              valeur={nombre(d.prises)}
              dessous={t('sur la période')}
              repere="prises"
            />
            <Tuile
              icone={<AlertTriangle className="h-3.5 w-3.5" />}
              titre={t('Échecs')}
              valeur={nombre(d.echecs)}
              dessous={t('sauvegardes en échec')}
              repere="echecs"
            />
            <Tuile
              icone={<Archive className="h-3.5 w-3.5" />}
              titre={t('Volume')}
              valeur={octetsEnClair(d.octets)}
              dessous={t('archives prises sur la période')}
              repere="volume"
            />
          </Tuiles>
          <Section titre={t('Sauvegardes, jour par jour')} icone={<HardDriveDownload className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Sauvegardes prises'), valeurs: d.parJour.prises }}
              ligne={{ libelle: t('Échecs'), valeurs: d.parJour.echecs }}
              vide={t('Aucune sauvegarde sur la période.')}
            />
          </Section>
          <Section titre={t('Sites sauvegardés')} icone={<HardDriveDownload className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="backups-sites"
              lignes={d.sitesListe}
              cle={(l) => l.id}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucun site à sauvegarder.')}
              colonnes={[
                { cle: 'nom', libelle: t('Site'), valeur: (l) => l.nom },
                { cle: 'projet', libelle: t('Projet'), valeur: (l) => ouTiret(l.projet), masqueSurTelephone: true },
                { cle: 'actif', libelle: t('État'), valeur: (l) => (l.actif ? t('Actif') : t('En pause')) },
                { cle: 'prises', libelle: t('Prises'), valeur: (l) => l.prises, droite: true },
                { cle: 'echecs', libelle: t('Échecs'), valeur: (l) => l.echecs, droite: true, masqueSurTelephone: true },
                {
                  cle: 'volume',
                  libelle: t('Volume'),
                  valeur: (l) => l.octets,
                  rendu: (l) => octetsEnClair(l.octets),
                  droite: true,
                  masqueSurTelephone: true,
                },
                {
                  cle: 'derniere',
                  libelle: t('Dernière prise'),
                  valeur: (l) => l.dernierePrise,
                  rendu: (l) => dateHeure(l.dernierePrise),
                  droite: true,
                },
              ]}
            />
          </Section>
          <Section titre={t('Sauvegardes prises')} icone={<HardDriveDownload className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="backups-points"
              lignes={d.points}
              cle={(l) => l.id}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucune sauvegarde sur la période.')}
              colonnes={[
                { cle: 'date', libelle: t('Date'), valeur: (l) => l.debut, rendu: (l) => dateHeure(l.debut) },
                { cle: 'site', libelle: t('Site'), valeur: (l) => l.site },
                { cle: 'statut', libelle: t('Statut'), valeur: (l) => statut(l.statut) },
                {
                  cle: 'origine',
                  libelle: t('Origine'),
                  valeur: (l) => (l.origine === 'automatique' ? t('Automatique') : l.origine ? t('À la main') : null),
                  masqueSurTelephone: true,
                },
                {
                  cle: 'duree',
                  libelle: t('Durée'),
                  valeur: (l) => l.dureeMs,
                  rendu: (l) => (l.dureeMs === null ? '—' : msEnClair(l.dureeMs)),
                  droite: true,
                  masqueSurTelephone: true,
                },
                { cle: 'volume', libelle: t('Volume'), valeur: (l) => l.octets, rendu: (l) => octetsEnClair(l.octets), droite: true },
              ]}
            />
          </Section>
        </>
      )}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Statistiques                                                        */
/* ------------------------------------------------------------------ */

export function RubriqueStatistiques({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeStatistiques>('statistiques', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<BarChart3 className="h-3.5 w-3.5" />}
              titre={t('Visites')}
              valeur={nombre(d.visites)}
              dessous={t('{v0} sites suivis', { v0: nombre(d.lignes.length) })}
              repere="visites"
            />
            <Tuile
              icone={<UsersRound className="h-3.5 w-3.5" />}
              titre={t('Visiteurs')}
              valeur={nombre(d.visiteurs)}
              dessous={t('personnes différentes')}
              repere="visiteurs"
            />
            <Tuile icone={<Eye className="h-3.5 w-3.5" />} titre={t('Pages vues')} valeur={nombre(d.pagesVues)} repere="pages" />
            <Tuile
              icone={<Target className="h-3.5 w-3.5" />}
              titre={t('Objectifs')}
              valeur={nombre(d.objectifs)}
              dessous={t('atteints sur la période')}
              repere="objectifs"
            />
          </Tuiles>
          <Section titre={t('Visites, jour par jour')} icone={<BarChart3 className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Visites'), valeurs: d.parJour.visites }}
              ligne={{ libelle: t('Visiteurs'), valeurs: d.parJour.visiteurs }}
              vide={t('Aucune visite sur la période.')}
            />
          </Section>
          <Section titre={t('Sites suivis')} icone={<BarChart3 className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="stats-sites"
              lignes={d.lignes}
              cle={(l) => l.id}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucun site suivi.')}
              colonnes={[
                { cle: 'nom', libelle: t('Site'), valeur: (l) => l.nom, rendu: (l) => (l.autonome ? `${l.nom} · ${t('Site autonome')}` : l.nom) },
                { cle: 'visites', libelle: t('Visites'), valeur: (l) => l.visites, droite: true },
                { cle: 'visiteurs', libelle: t('Visiteurs'), valeur: (l) => l.visiteurs, droite: true },
                { cle: 'pages', libelle: t('Pages vues'), valeur: (l) => l.pagesVues, droite: true, masqueSurTelephone: true },
                { cle: 'objectifs', libelle: t('Objectifs'), valeur: (l) => l.objectifs, droite: true, masqueSurTelephone: true },
              ]}
            />
          </Section>
        </>
      )}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Messagerie                                                          */
/* ------------------------------------------------------------------ */

export function RubriqueMessagerie({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeMessagerie>('messagerie', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<Mail className="h-3.5 w-3.5" />}
              titre={t('Demandes reçues')}
              valeur={nombre(d.demandesCreees)}
              dessous={t('sur la période')}
              repere="demandes"
            />
            <Tuile
              icone={<MessagesSquare className="h-3.5 w-3.5" />}
              titre={t('Messages')}
              valeur={nombre(d.messages)}
              dessous={t('commentaires et discussions')}
              repere="messages"
            />
            <Tuile
              icone={<Timer className="h-3.5 w-3.5" />}
              titre={t('Demandes ouvertes')}
              valeur={nombre(d.demandesOuvertes)}
              dessous={t("à faire ou en cours, aujourd'hui")}
              repere="ouvertes"
            />
            <Tuile
              icone={<CheckCircle2 className="h-3.5 w-3.5" />}
              titre={t('Demandes terminées')}
              valeur={nombre(d.demandesTerminees)}
              dessous={t('parmi celles actives sur la période')}
              repere="terminees"
            />
          </Tuiles>
          <Section titre={t('Demandes et messages, jour par jour')} icone={<MessagesSquare className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Messages'), valeurs: d.parJour.messages }}
              ligne={{ libelle: t('Demandes reçues'), valeurs: d.parJour.demandes }}
              vide={t('Aucune demande ni message sur la période.')}
            />
          </Section>
          <Section titre={t('Demandes actives sur la période')} icone={<Mail className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="demandes"
              lignes={d.lignes}
              cle={(l) => l.id}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucune demande active sur la période.')}
              colonnes={[
                { cle: 'titre', libelle: t('Demande'), valeur: (l) => l.titre, largeur: 'sm:min-w-[180px]' },
                { cle: 'projet', libelle: t('Projet'), valeur: (l) => l.projet ?? t('Projet retiré'), masqueSurTelephone: true },
                { cle: 'colonne', libelle: t('Étape'), valeur: (l) => (l.archivee ? t('Archivée') : libelle(TITRES_COLONNES_DEMANDE, l.colonne)) },
                { cle: 'messages', libelle: t('Messages'), valeur: (l) => l.messages, droite: true },
                {
                  cle: 'creee',
                  libelle: t('Reçue le'),
                  valeur: (l) => l.creeeLe,
                  rendu: (l) => dateCourte(l.creeeLe),
                  droite: true,
                  masqueSurTelephone: true,
                },
                {
                  cle: 'activite',
                  libelle: t('Dernière activité'),
                  valeur: (l) => l.derniereActivite,
                  rendu: (l) => dateHeure(l.derniereActivite),
                  droite: true,
                },
              ]}
            />
          </Section>
        </>
      )}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Marketing                                                           */
/* ------------------------------------------------------------------ */

export function RubriqueMarketing({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeMarketing>('marketing', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<Megaphone className="h-3.5 w-3.5" />}
              titre={t('Contenus préparés')}
              valeur={nombre(d.contenus)}
              dessous={t('sur la période')}
              repere="contenus"
            />
            <Tuile
              icone={<Eye className="h-3.5 w-3.5" />}
              titre={t('Contenus publiés')}
              valeur={nombre(d.publies)}
              dessous={t('sur la période')}
              repere="publies"
            />
            <Tuile
              icone={<CheckCircle2 className="h-3.5 w-3.5" />}
              titre={t('Actions menées')}
              valeur={nombre(d.actionsFaites)}
              dessous={t('sur la période')}
              repere="actions"
            />
            <Tuile
              icone={<Coins className="h-3.5 w-3.5" />}
              titre={t('Ventes')}
              valeur={nombre(d.ventes)}
              dessous={t('{v0} encaissés', { v0: centimes(d.montant) })}
              repere="ventes"
            />
          </Tuiles>
          <Section titre={t('Contenus et actions, jour par jour')} icone={<Megaphone className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Contenus préparés'), valeurs: d.parJour.contenus }}
              ligne={{ libelle: t('Actions menées'), valeurs: d.parJour.actions }}
              vide={t('Aucun contenu ni action sur la période.')}
            />
          </Section>
          <Section titre={t('Par projet')} icone={<Megaphone className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="marketing-projets"
              lignes={d.lignes}
              cle={(l) => l.projectId}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucune activité marketing sur la période.')}
              colonnes={[
                { cle: 'projet', libelle: t('Projet'), valeur: (l) => l.nom },
                { cle: 'contenus', libelle: t('Contenus'), valeur: (l) => l.contenus, droite: true },
                { cle: 'valider', libelle: t('À valider'), valeur: (l) => l.aValider, droite: true },
                { cle: 'publies', libelle: t('Publiés'), valeur: (l) => l.publies, droite: true, masqueSurTelephone: true },
                { cle: 'actions', libelle: t('Actions'), valeur: (l) => l.actions, droite: true, masqueSurTelephone: true },
                { cle: 'ventes', libelle: t('Ventes'), valeur: (l) => l.ventes, droite: true, masqueSurTelephone: true },
                {
                  cle: 'montant',
                  libelle: t('Montant'),
                  valeur: (l) => l.montant,
                  rendu: (l) => centimes(l.montant),
                  droite: true,
                  masqueSurTelephone: true,
                },
              ]}
            />
          </Section>
        </>
      )}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export function RubriqueNotes({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeNotes>('notes', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => (
        <>
          <Tuiles>
            <Tuile
              icone={<NotebookPen className="h-3.5 w-3.5" />}
              titre={t('Notes')}
              valeur={nombre(d.total)}
              dessous={t('en tout')}
              repere="total"
            />
            <Tuile
              icone={<Plus className="h-3.5 w-3.5" />}
              titre={t('Créées')}
              valeur={nombre(d.creees)}
              dessous={t('sur la période')}
              repere="creees"
            />
            <Tuile
              icone={<PencilLine className="h-3.5 w-3.5" />}
              titre={t('Modifiées')}
              valeur={nombre(d.modifiees)}
              dessous={t('sur la période')}
              repere="modifiees"
            />
            <Tuile
              icone={<Timer className="h-3.5 w-3.5" />}
              titre={t('Échéances dépassées')}
              valeur={nombre(d.lignes.filter((n) => n.echeance !== null && n.echeance < Date.now()).length)}
              dessous={t('parmi les notes de la période')}
              repere="echeances"
            />
          </Tuiles>
          <Section titre={t('Notes, jour par jour')} icone={<NotebookPen className="h-3.5 w-3.5 text-faint" />}>
            <CourbeDuResume
              jours={d.jours}
              barres={{ libelle: t('Créées'), valeurs: d.parJour.creees }}
              ligne={{ libelle: t('Modifiées'), valeurs: d.parJour.modifiees }}
              vide={t('Aucune note créée ni modifiée sur la période.')}
            />
          </Section>
          <Section titre={t('Notes de la période')} icone={<NotebookPen className="h-3.5 w-3.5 text-faint" />}>
            <TableauDeDonnees
              repere="notes"
              lignes={d.lignes}
              cle={(l) => l.id}
              taille={taille}
              onTaille={setTaille}
              vide={t('Aucune note créée ni modifiée sur la période.')}
              colonnes={[
                { cle: 'titre', libelle: t('Note'), valeur: (l) => l.titre, largeur: 'sm:min-w-[180px]' },
                { cle: 'projet', libelle: t('Projet'), valeur: (l) => l.projet ?? t('Projet retiré'), masqueSurTelephone: true },
                { cle: 'importance', libelle: t('Importance'), valeur: (l) => libelle(LIBELLES_IMPORTANCE, l.importance) },
                {
                  cle: 'echeance',
                  libelle: t('Échéance'),
                  valeur: (l) => l.echeance,
                  rendu: (l) => (l.echeance ? dateCourte(l.echeance) : '—'),
                  droite: true,
                },
                {
                  cle: 'creee',
                  libelle: t('Créée le'),
                  valeur: (l) => l.creeLe,
                  rendu: (l) => dateCourte(l.creeLe),
                  droite: true,
                  masqueSurTelephone: true,
                },
                { cle: 'modifiee', libelle: t('Modifiée le'), valeur: (l) => l.modifieLe, rendu: (l) => dateHeure(l.modifieLe), droite: true },
              ]}
            />
          </Section>
        </>
      )}
    </EtatDeRubrique>
  );
}
