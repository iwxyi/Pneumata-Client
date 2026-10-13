export type AceImageModelForm = {
  code: string;
  displayName: string;
  prices: Record<string, string>;
};

const DEFAULT_MODELS: AceImageModelForm[] = [
  { code: 'nano-banana', displayName: 'Nano Banana', prices: { '1K': '0.14', '2K': '', '4K': '' } },
  { code: 'nano-banana-2-lite', displayName: 'Nano Banana 2 Lite', prices: { '1K': '0.14', '2K': '', '4K': '' } },
  { code: 'nano-banana-2', displayName: 'Nano Banana 2', prices: { '1K': '0.28', '2K': '', '4K': '' } },
  { code: 'nano-banana-2.1', displayName: 'Nano Banana 2.1', prices: { '1K': '0.2', '2K': '', '4K': '' } },
  { code: 'nano-banana-pro', displayName: 'Nano Banana Pro', prices: { '1K': '0.35', '2K': '', '4K': '' } },
  { code: 'nano-banana:official', displayName: 'Nano Banana Official', prices: { '1K': '0.1803', '2K': '', '4K': '' } },
  { code: 'nano-banana-2-lite:official', displayName: 'Nano Banana 2 Lite Official', prices: { '1K': '0.1803', '2K': '', '4K': '' } },
  { code: 'nano-banana-2:official', displayName: 'Nano Banana 2 Official', prices: { '1K': '0.2576', '2K': '0.3091', '4K': '0.3864' } },
  { code: 'nano-banana-pro:official', displayName: 'Nano Banana Pro Official', prices: { '1K': '0.5152', '2K': '0.5152', '4K': '0.7727' } },
];

export function toAceImageModelsForm(metadata: Record<string, unknown>): AceImageModelForm[] {
  const models = metadata.acedataModels;
  return DEFAULT_MODELS.map((model) => {
    const row = Array.isArray(models) ? models.find((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      const item = value as Record<string, unknown>;
      return item.code === model.code || item.upstreamModel === model.code;
    }) as Record<string, unknown> | undefined : undefined;
    const prices = row?.prices && typeof row.prices === 'object' ? row.prices as Record<string, unknown> : {};
    return { ...model, prices: Object.fromEntries(['1K', '2K', '4K'].map((size) => [size, size !== '1K' && Number(prices[size]) === 0 ? '' : String(prices[size] ?? model.prices[size])])) };
  });
}
