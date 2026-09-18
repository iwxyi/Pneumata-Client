import type { AssistantHtmlRuntimeError } from './AssistantHtmlFrame';

const errors = new Map<string, AssistantHtmlRuntimeError>();

const errorPriority: Record<AssistantHtmlRuntimeError['kind'], number> = {
  runtime: 4,
  unhandledrejection: 4,
  resource: 3,
  console: 2,
  page_state: 1,
};

function keyFor(artifactId: string, versionId: string) {
  return `${artifactId}:${versionId}`;
}

export function getAssistantHtmlRuntimeError(artifactId: string, versionId: string) {
  return errors.get(keyFor(artifactId, versionId)) || null;
}

export function rememberAssistantHtmlRuntimeError(error: AssistantHtmlRuntimeError) {
  if (error.kind === 'page_state') return getAssistantHtmlRuntimeError(error.artifactId, error.versionId);
  const key = keyFor(error.artifactId, error.versionId);
  const current = errors.get(key);
  if (current && errorPriority[current.kind] > errorPriority[error.kind]) return current;
  errors.set(key, error);
  return error;
}
