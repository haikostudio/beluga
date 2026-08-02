import { useSyncExternalStore } from 'react';
import { client, AppState } from './client';

export function useApp(): AppState {
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
}
