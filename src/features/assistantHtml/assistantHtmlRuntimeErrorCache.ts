import type { AssistantHtmlRuntimeError } from './AssistantHtmlFrame';

const errors = new Map<string, AssistantHtmlRuntimeError>();

function keyFor(artifactId: string, versionId: string) {
  return `${artifactId}:${versionId}`;
}

export function getAssistantHtmlRuntimeError(artifactId: string, versionId: string) {
  return errors.get(keyFor(artifactId, versionId)) || null;
}

export function rememberAssistantHtmlRuntimeError(error: AssistantHtmlRuntimeError) {
  errors.set(keyFor(error.artifactId, error.versionId), error);
}
