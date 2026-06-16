import type { CompanionshipSettings } from '../types/settings';
import { DEFAULT_COMPANIONSHIP_SETTINGS } from '../types/settings';

let runtimeConfig: CompanionshipSettings = { ...DEFAULT_COMPANIONSHIP_SETTINGS };

export function getCompanionshipRuntimeConfig() {
  return runtimeConfig;
}

export function setCompanionshipRuntimeConfig(next: Partial<CompanionshipSettings> | undefined | null) {
  runtimeConfig = {
    ...runtimeConfig,
    ...(next || {}),
    proactiveCooldownMinutes: {
      ...runtimeConfig.proactiveCooldownMinutes,
      ...(next?.proactiveCooldownMinutes || {}),
    },
    ritualKindToggles: {
      ...runtimeConfig.ritualKindToggles,
      ...(next?.ritualKindToggles || {}),
    },
    quietHours: {
      ...runtimeConfig.quietHours,
      ...(next?.quietHours || {}),
    },
  };
}
