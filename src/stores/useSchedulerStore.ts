import { create } from 'zustand';
import type { CandidateInfo } from '../types/scheduler';
import { BASE_COOLDOWN_MS } from '../constants/defaults';

interface SchedulerStore {
  isRunning: boolean;
  isPaused: boolean;
  currentSpeakerId: string | null;
  candidates: CandidateInfo[];
  lastSpeakTimestamps: Record<string, number>;
  baseCooldownMs: number;
  timerId: ReturnType<typeof setTimeout> | null;
  loopToken: string | null;

  start: (loopToken?: string | null) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setLoopToken: (token: string | null) => void;
  setCurrentSpeaker: (id: string | null) => void;
  updateCandidates: (candidates: CandidateInfo[]) => void;
  recordSpeak: (characterId: string) => void;
  resetAllCooldowns: () => void;
  isOnCooldown: (characterId: string, speed: number) => boolean;
  setTimerId: (id: ReturnType<typeof setTimeout> | null) => void;
}

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  isRunning: false,
  isPaused: false,
  currentSpeakerId: null,
  candidates: [],
  lastSpeakTimestamps: {},
  baseCooldownMs: BASE_COOLDOWN_MS,
  timerId: null,
  loopToken: null,

  start: (loopToken = null) => set({ isRunning: true, isPaused: false, loopToken }),
  stop: () => {
    const { timerId } = get();
    if (timerId) clearTimeout(timerId);
    set({
      isRunning: false,
      isPaused: false,
      currentSpeakerId: null,
      candidates: [],
      timerId: null,
      loopToken: null,
    });
  },
  pause: () => set({ isPaused: true }),
  resume: () => set({ isPaused: false }),

  setCurrentSpeaker: (id) => set({ currentSpeakerId: id }),
  updateCandidates: (candidates) => set({ candidates }),
  setLoopToken: (token) => set({ loopToken: token }),

  recordSpeak: (characterId) => {
    set((state) => ({
      lastSpeakTimestamps: {
        ...state.lastSpeakTimestamps,
        [characterId]: Date.now(),
      },
    }));
  },

  resetAllCooldowns: () => set({ lastSpeakTimestamps: {} }),

  isOnCooldown: (characterId, speed) => {
    const { lastSpeakTimestamps, baseCooldownMs } = get();
    const lastSpeak = lastSpeakTimestamps[characterId];
    if (!lastSpeak) return false;
    return Date.now() - lastSpeak < baseCooldownMs / speed;
  },

  setTimerId: (id) => set({ timerId: id }),
}));
