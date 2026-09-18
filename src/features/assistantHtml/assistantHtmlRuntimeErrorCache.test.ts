import { describe, expect, it } from 'vitest';
import { getAssistantHtmlRuntimeError, rememberAssistantHtmlRuntimeError } from './assistantHtmlRuntimeErrorCache';
import type { AssistantHtmlRuntimeError } from './AssistantHtmlFrame';

function runtimeError(kind: AssistantHtmlRuntimeError['kind'], message: string): AssistantHtmlRuntimeError {
  return { artifactId: `artifact-${message}`, versionId: 'version-1', kind, message };
}

describe('assistantHtmlRuntimeErrorCache', () => {
  it('does not let inferred page text replace a concrete runtime error', () => {
    const concrete = runtimeError('runtime', 'fabackLevel is not defined');
    rememberAssistantHtmlRuntimeError(concrete);

    const inferred = { ...concrete, kind: 'page_state' as const, message: '关卡生成失败' };
    expect(rememberAssistantHtmlRuntimeError(inferred)).toEqual(concrete);
    expect(getAssistantHtmlRuntimeError(concrete.artifactId, concrete.versionId)).toEqual(concrete);
  });

  it('replaces inferred page text when a concrete error arrives later', () => {
    const inferred = runtimeError('page_state', '页面生成失败');
    rememberAssistantHtmlRuntimeError(inferred);

    const concrete = { ...inferred, kind: 'unhandledrejection' as const, message: 'request failed' };
    expect(rememberAssistantHtmlRuntimeError(concrete)).toEqual(concrete);
    expect(getAssistantHtmlRuntimeError(inferred.artifactId, inferred.versionId)).toEqual(concrete);
  });
});
