/**
 * LES OPTIONS D'UNE DEMANDE — UN SEUL ACCORDÉON, DEUX ÉCRANS.
 *
 * Importance, dates, étiquettes : les mêmes réglages servent à la FICHE
 * d'une demande et au FORMULAIRE qui en crée une. Ils étaient écrits deux fois
 * — quatre champs dans la fiche, un seul rang de boutons à la création —, si
 * bien qu'on ne pouvait pas poser d'échéance en déposant une demande, et qu'il
 * fallait la rouvrir pour l'ajouter.
 *
 * L'ACCORDÉON tient la hauteur : une section ouverte à la fois, et chaque
 * section fermée DIT SA VALEUR sur sa ligne. On lit d'un regard ce que porte la
 * demande, on n'ouvre que ce qu'on veut changer.
 *
 * IL N'Y A PLUS QU'UNE PRÉSENTATION. La fiche feuilletait ces mêmes réglages
 * dans un CARROUSEL paginé : il fallait tourner trois pages pour voir la
 * quatrième option, et rien ne disait ce qu'on n'avait pas encore atteint. Les
 * sections s'empilent donc dans les deux écrans.
 *
 * LE TYPE (anomalie, évolution…) A DISPARU : personne ne le posait, et sa
 * section ne faisait qu'allonger l'accordéon. Il reste trois sections.
 *
 * CE COMPOSANT NE PARLE À PERSONNE. Il ne connaît ni le serveur ni le canal :
 * il reçoit des valeurs, il rend un patch. La fiche l'enregistre aussitôt,
 * le formulaire le garde jusqu'au dépôt.
 */
import * as React from 'react';
import { Calendar, Clock, Tag, X } from 'lucide-react';
import { Accordeon, Button, Input, type SectionAccordeon } from '@/components/ui';
import { t } from '@/lib/langue';
import {
  IMPORTANCES,
  TITRES_IMPORTANCE,
  etiquettesNettoyees,
  type ImportanceDemande,
} from '@beluga/shared';
import { jourDe } from './formats';

/** Ce que l'accordéon montre. */
export interface ValeursDOptions {
  importance: ImportanceDemande;
  echeance?: number | null;
  /** Réservée à Haiko : c'est un ENGAGEMENT, un client ne l'écrit jamais. */
  livraisonAnnoncee?: number | null;
  etiquettes: string[];
}

/** Ce qu'il rend — les noms du serveur, pour n'avoir rien à traduire ensuite. */
export interface PatchDOptions {
  importance?: ImportanceDemande;
  echeance?: number | null;
  livraisonAnnoncee?: number | null;
  etiquettes?: string[];
}

/** La date d'un champ `<input type="date">`, et l'inverse. */
export function enChampDate(at: number | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function depuisChampDate(valeur: string): number | null {
  if (!valeur) return null;
  const at = new Date(`${valeur}T12:00:00`).getTime();
  return Number.isNaN(at) ? null : at;
}

/**
 * CE QUE CE COMPTE PEUT CHANGER, CHAMP PAR CHAMP. Un verrou global bloquait
 * tout pour un client sur une demande de Haiko, alors que le serveur lui ouvre
 * l'importance, l'échéance et les étiquettes (`champsModifiables`). La
 * livraison annoncée, elle, reste un engagement de Haiko (`estAdmin`).
 */
export interface DroitsDOptions {
  importance: boolean;
  echeance: boolean;
  etiquettes: boolean;
}

export function OptionsDemande({
  valeurs,
  onChanger,
  peutEcrire = true,
  droits,
  estAdmin = false,
  /** Une demande qu'on dépose n'a pas encore de livraison annoncée. */
  avecLivraison = true,
  enRetard = false,
  repere = 'demande',
}: {
  valeurs: ValeursDOptions;
  onChanger: (patch: PatchDOptions) => void;
  /** Le verrou d'un bloc, quand aucun droit par champ n'est donné. */
  peutEcrire?: boolean;
  droits?: DroitsDOptions;
  estAdmin?: boolean;
  avecLivraison?: boolean;
  enRetard?: boolean;
  repere?: string;
}) {
  const [etiquetteNeuve, setEtiquetteNeuve] = React.useState('');
  const peut: DroitsDOptions = droits ?? { importance: peutEcrire, echeance: peutEcrire, etiquettes: peutEcrire };

  /** Ce que la section « Dates » dit sans s'ouvrir. */
  const resumeDesDates = [
    valeurs.echeance ? jourDe(valeurs.echeance) : null,
    avecLivraison && valeurs.livraisonAnnoncee ? jourDe(valeurs.livraisonAnnoncee) : null,
  ]
    .filter(Boolean)
    .join(' → ');

  const sections: SectionAccordeon[] = [
    {
      clef: 'importance',
      titre: t('Importance'),
      resume: t(TITRES_IMPORTANCE[valeurs.importance]),
      contenu: (
        <div className="flex flex-wrap gap-1.5" data-champ-importance>
          {IMPORTANCES.map((niveau) => (
            <Button
              key={niveau}
              size="sm"
              variant={valeurs.importance === niveau ? 'subtle' : 'ghost'}
              disabled={!peut.importance}
              onClick={() => onChanger({ importance: niveau as ImportanceDemande })}
              data-importance={niveau}
            >
              {t(TITRES_IMPORTANCE[niveau as ImportanceDemande])}
            </Button>
          ))}
        </div>
      ),
    },
    {
      clef: 'dates',
      titre: t('Dates'),
      resume: resumeDesDates || t('Aucune'),
      icone: <Calendar className="h-3.5 w-3.5" />,
      contenu: (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {t('Échéance souhaitée')}
            </span>
            <Input
              type="date"
              value={enChampDate(valeurs.echeance)}
              disabled={!peut.echeance}
              onChange={(event) => onChanger({ echeance: depuisChampDate(event.target.value) })}
              className={enRetard ? 'h-8 border-danger/60 text-danger' : 'h-8'}
              data-champ-echeance
            />
          </label>
          {/*
           * LA DATE ANNONCÉE PAR HAIKO EST UN ENGAGEMENT : elle ne s'affiche
           * pour un client qu'en LECTURE. Le serveur la refuse de toute façon
           * (`champsModifiables`) — mais un champ ouvert qui refuse à
           * l'enregistrement est un mensonge d'écran.
           */}
          {avecLivraison ? (
            <label className="flex flex-col gap-1 text-[11px] text-faint">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t('Livraison annoncée')}
              </span>
              {estAdmin ? (
                <Input
                  type="date"
                  value={enChampDate(valeurs.livraisonAnnoncee)}
                  onChange={(event) => onChanger({ livraisonAnnoncee: depuisChampDate(event.target.value) })}
                  className="h-8"
                  data-champ-livraison
                />
              ) : (
                <span className="flex h-8 items-center text-[13px] text-text" data-livraison-lecture>
                  {valeurs.livraisonAnnoncee ? jourDe(valeurs.livraisonAnnoncee) : t('Pas encore annoncée')}
                </span>
              )}
            </label>
          ) : null}
        </div>
      ),
    },
    {
      clef: 'etiquettes',
      titre: t('Étiquettes'),
      resume: valeurs.etiquettes.length ? valeurs.etiquettes.map((e) => `#${e}`).join(' ') : t('Aucune'),
      icone: <Tag className="h-3.5 w-3.5" />,
      contenu: (
        <div className="flex flex-wrap items-center gap-1.5" data-champ-etiquettes>
          {valeurs.etiquettes.map((etiquette) => (
            <span
              key={etiquette}
              className="inline-flex items-center gap-1 rounded-lg border border-faint/60 px-2 py-0.5 text-[11px] text-muted"
              data-etiquette={etiquette}
            >
              {etiquette}
              {/* Le retrait suit le MÊME droit que l'ajout : il ignorait le verrou. */}
              {peut.etiquettes ? (
                <button
                  type="button"
                  onClick={() => onChanger({ etiquettes: valeurs.etiquettes.filter((e) => e !== etiquette) })}
                  className="text-faint hover:text-text"
                  title={t('Retirer')}
                  data-retirer-etiquette={etiquette}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
          {peut.etiquettes ? (
          <input
            value={etiquetteNeuve}
            onChange={(event) => setEtiquetteNeuve(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !etiquetteNeuve.trim()) return;
              event.preventDefault();
              onChanger({ etiquettes: etiquettesNettoyees([...valeurs.etiquettes, etiquetteNeuve]) });
              setEtiquetteNeuve('');
            }}
            placeholder={t('Étiquette…')}
            className="h-6 w-24 bg-transparent text-[11px] text-text outline-none placeholder:text-faint"
            data-champ-etiquette-neuve
          />
          ) : null}
        </div>
      ),
    },
  ];

  /* LES OPTIONS SE POSENT EN BLOCS SUR FOND CONTRASTÉ, sans un trait entre elles. */
  return <Accordeon sections={sections} repere={`options-${repere}`} variante="blocs" />;
}
