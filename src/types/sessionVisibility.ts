export type VisibilityScope = 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public';

export interface ProjectionRule {
  scope: VisibilityScope;
  visibleToRoles?: string[];
  visibleToIds?: string[];
}

export interface ProjectionContext {
  viewerId?: string | null;
  viewerRole?: string | null;
}

export function canProjectScope(rule: ProjectionRule, context: ProjectionContext) {
  if (rule.scope === 'public' || rule.scope === 'derived_public') return true;
  if (rule.visibleToIds?.length && context.viewerId) return rule.visibleToIds.includes(context.viewerId);
  if (rule.visibleToRoles?.length && context.viewerRole) return rule.visibleToRoles.includes(context.viewerRole);
  return false;
}
