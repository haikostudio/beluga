/**
 * L'IMAGE D'UNE LIGNE DE NOTIFICATION — partagée par les DEUX cloches : celle
 * du bandeau de l'administration et celle de l'espace client. Ce fichier ne
 * dépend d'aucun magasin : la porte client l'embarque sans rien tirer de
 * l'interface d'administration.
 */
import * as React from 'react';
import { AlertCircle, Check, MessageSquare, RotateCcw, Route, TriangleAlert, UploadCloud, Zap } from 'lucide-react';
import type { IconeNotification } from '@beluga/shared';
import { cn } from '@/lib/utils';

/** L'image de chaque ligne : on reconnaît le genre de nouvelle avant de la lire. */
export function IconeDeNotification({ icone, classe = 'h-3.5 w-3.5 shrink-0' }: { icone: IconeNotification; classe?: string }) {
  switch (icone) {
    case 'attention':
      return <TriangleAlert className={cn(classe, 'text-warning')} />;
    case 'question':
      return <MessageSquare className={cn(classe, 'text-text')} />;
    case 'plan':
      return <Route className={cn(classe, 'text-text')} />;
    case 'erreur':
      return <AlertCircle className={cn(classe, 'text-danger')} />;
    case 'publication':
      return <UploadCloud className={cn(classe, 'text-publie')} />;
    case 'quota':
      return <Zap className={cn(classe, 'text-info')} />;
    case 'redemarrage':
      return <RotateCcw className={cn(classe, 'text-muted')} />;
    default:
      return <Check className={cn(classe, 'text-termine')} />;
  }
}

/** La couleur du rond posé sur la ligne centrale, selon l'image de la ligne. */
export function bordureDIcone(icone: IconeNotification): string {
  switch (icone) {
    case 'attention':
    case 'question':
    case 'plan':
      return 'border-warning/60';
    case 'erreur':
      return 'border-danger/60';
    case 'publication':
      return 'border-publie/60';
    case 'quota':
      return 'border-info/60';
    case 'redemarrage':
      return 'border-border';
    default:
      return 'border-termine/60';
  }
}
