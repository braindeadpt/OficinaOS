import { create } from "zustand";

interface CommandPaletteState {
  close: () => void;
  isOpen: boolean;
  open: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
