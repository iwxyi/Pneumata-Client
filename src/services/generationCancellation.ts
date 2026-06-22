export class GenerationCancelledError extends Error {
  constructor(message = '生成已停止') {
    super(message);
    this.name = 'GenerationCancelledError';
  }
}

export function isAbortLikeError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isGenerationCancelledError(error: unknown): error is GenerationCancelledError {
  return error instanceof GenerationCancelledError || isAbortLikeError(error);
}
