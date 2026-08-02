import { ServerEvent } from '@haikodev/shared';
import { log } from './logger.js';

type Sink = (event: ServerEvent) => void;

const sinks = new Set<Sink>();

/** Le démon est la source de vérité : l'interface s'abonne, il pousse. */
export const bus = {
  subscribe(sink: Sink): () => void {
    sinks.add(sink);
    return () => sinks.delete(sink);
  },
  emit(event: ServerEvent): void {
    for (const sink of sinks) {
      try {
        sink(event);
      } catch (err) {
        log.error('diffusion impossible vers un client', err);
      }
    }
  },
  toast(level: 'info' | 'success' | 'warning' | 'error', text: string, cardId?: string): void {
    bus.emit({ type: 'toast', level, text, cardId });
  },
  clientCount(): number {
    return sinks.size;
  },
};
