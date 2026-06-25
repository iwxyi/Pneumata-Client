export interface HumanAppraisalRuntimeConfig {
  enabled: boolean;
}

const DEFAULT_CONFIG: HumanAppraisalRuntimeConfig = {
  enabled: true,
};

let runtimeConfig: HumanAppraisalRuntimeConfig = { ...DEFAULT_CONFIG };

export function getHumanAppraisalRuntimeConfig() {
  return runtimeConfig;
}

export function setHumanAppraisalRuntimeConfig(next: Partial<HumanAppraisalRuntimeConfig> | undefined | null) {
  runtimeConfig = {
    ...runtimeConfig,
    ...(next || {}),
    enabled: next?.enabled ?? runtimeConfig.enabled,
  };
}

