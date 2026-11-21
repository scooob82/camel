import { useEffect } from 'react';
import { createStore } from './store';

export interface Command {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  run: () => void;
}

/** Commands contributed by the current screen (e.g. the builder), merged into the palette. */
export const contextCommands = createStore<Command[]>([]);

export function useContextCommands(cmds: Command[], deps: unknown[]) {
  useEffect(() => {
    contextCommands.set(() => cmds);
    return () => contextCommands.set(() => []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const paletteOpen = createStore(false);
export const openPalette = () => paletteOpen.set(() => true);
