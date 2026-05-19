export type PaperSurfaceVariant = 'lined' | 'plain' | 'letter' | 'night';

export interface ArtifactAppearanceSettings {
  paperVariant: PaperSurfaceVariant;
}

export const PAPER_SURFACE_VARIANTS: PaperSurfaceVariant[] = ['lined', 'plain', 'letter', 'night'];

export const DEFAULT_ARTIFACT_APPEARANCE_SETTINGS: ArtifactAppearanceSettings = {
  paperVariant: 'lined',
};
