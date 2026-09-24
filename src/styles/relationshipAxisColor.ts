import type { PaletteMode } from '@mui/material';

export type RelationshipAxisColorKey = 'warmth' | 'competence' | 'trust' | 'threat' | 'attachment' | 'deference';

const NEUTRAL: Record<PaletteMode, string> = { light: '#475569', dark: '#CBD5E1' };

function interpolateHex(from: string, to: string, amount: number) {
  const ratio = Math.max(0, Math.min(1, amount));
  const channels = [1, 3, 5].map((index) => Math.round(
    Number.parseInt(from.slice(index, index + 2), 16) + (Number.parseInt(to.slice(index, index + 2), 16) - Number.parseInt(from.slice(index, index + 2), 16)) * ratio,
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function targetColor(axis: RelationshipAxisColorKey, value: number) {
  if (axis === 'deference') return value >= 0 ? '#7C3AED' : '#0284C7';
  const favorable = axis === 'threat' ? value < 0 : value >= 0;
  return favorable ? '#2E7D32' : '#D32F2F';
}

/** Neutral is theme-aware; saturation grows smoothly with relationship magnitude. */
export function relationshipAxisValueColor(axis: RelationshipAxisColorKey, value: number, mode: PaletteMode) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return interpolateHex(NEUTRAL[mode], targetColor(axis, safeValue), Math.min(Math.abs(safeValue) / 60, 1));
}

/** A change uses the same semantic direction, with a little more contrast at small values. */
export function relationshipAxisDeltaColor(axis: RelationshipAxisColorKey, delta: number, mode: PaletteMode) {
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  return interpolateHex(NEUTRAL[mode], targetColor(axis, safeDelta), Math.min(Math.abs(safeDelta) / 12, 1) * 0.82);
}
