import type { APIConfig } from '../types/settings';
import { generateImage } from './aiClient';
import { useCharacterStore } from '../stores/useCharacterStore';
import { api } from './api';

export type AvatarGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AvatarGenerationTaskState {
  id: string;
  targetKey: string;
  status: AvatarGenerationStatus;
  error: string | null;
  imageDataUrl: string | null;
  characterId?: string | null;
}

interface AvatarGenerationTask extends AvatarGenerationTaskState {
  prompt: string;
  config: APIConfig;
  controller: AbortController | null;
}

type TaskListener = (state: AvatarGenerationTaskState) => void;

class AvatarGenerationQueueService {
  private queue: string[] = [];
  private tasks = new Map<string, AvatarGenerationTask>();
  private listenersByTask = new Map<string, Set<TaskListener>>();
  private listenersByTarget = new Map<string, Set<TaskListener>>();
  private latestTaskIdByTarget = new Map<string, string>();
  private runningTaskId: string | null = null;

  enqueue(config: APIConfig, prompt: string, options: { targetKey: string; characterId?: string | null }) {
    const previous = this.getLatestTaskForTarget(options.targetKey);
    if (previous && (previous.status === 'queued' || previous.status === 'running')) {
      this.cancel(previous.id);
    }

    const id = `avatar-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: AvatarGenerationTask = {
      id,
      targetKey: options.targetKey,
      characterId: options.characterId || null,
      prompt,
      config,
      status: 'queued',
      error: null,
      imageDataUrl: null,
      controller: null,
    };

    this.tasks.set(id, task);
    this.latestTaskIdByTarget.set(options.targetKey, id);
    this.queue.push(id);
    this.emit(task);
    void this.processNext();
    return id;
  }

  getLatestTaskForTarget(targetKey: string) {
    const taskId = this.latestTaskIdByTarget.get(targetKey);
    return taskId ? this.toPublicState(this.tasks.get(taskId)) : null;
  }

  subscribe(taskId: string, listener: TaskListener) {
    return this.subscribeInternal(this.listenersByTask, taskId, listener, this.tasks.get(taskId) || null);
  }

  subscribeTarget(targetKey: string, listener: TaskListener) {
    const current = this.getLatestTaskForTarget(targetKey);
    return this.subscribeInternal(this.listenersByTarget, targetKey, listener, current ? (this.tasks.get(current.id) || null) : null);
  }

  cancel(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.status === 'queued') {
      this.queue = this.queue.filter((id) => id !== taskId);
      task.status = 'cancelled';
      this.emit(task);
      return;
    }

    if (task.status === 'running' && task.controller) {
      task.controller.abort();
    }
  }

  private subscribeInternal(
    bucketMap: Map<string, Set<TaskListener>>,
    key: string,
    listener: TaskListener,
    task: AvatarGenerationTaskState | AvatarGenerationTask | null,
  ) {
    const bucket = bucketMap.get(key) || new Set<TaskListener>();
    bucket.add(listener);
    bucketMap.set(key, bucket);

    const publicTask = this.toPublicState(task);
    if (publicTask) {
      listener(publicTask);
    }

    return () => {
      const current = bucketMap.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        bucketMap.delete(key);
      }
    };
  }

  private async processNext() {
    if (this.runningTaskId) return;
    const nextTaskId = this.queue.shift();
    if (!nextTaskId) return;

    const task = this.tasks.get(nextTaskId);
    if (!task || task.status !== 'queued') {
      void this.processNext();
      return;
    }

    this.runningTaskId = nextTaskId;
    task.status = 'running';
    task.error = null;
    task.controller = new AbortController();
    this.emit(task);

    try {
      const images = await generateImage(task.config, {
        prompt: task.prompt,
        count: 1,
        size: '1024x1024',
        signal: task.controller.signal,
      });
      const firstImage = images[0];
      if (!firstImage?.dataUrl) {
        throw new Error('No image returned');
      }

      task.status = 'succeeded';
      task.imageDataUrl = firstImage.dataUrl;
      task.error = null;

      if (task.characterId) {
        const currentCharacters = useCharacterStore.getState().characters;
        const stillExists = currentCharacters.some((character) => character.id === task.characterId);
        if (stillExists) {
          await api.updateCharacter(task.characterId, {
            avatar: firstImage.dataUrl,
          });
          await useCharacterStore.getState().loadCharacters();
        }
      }

      this.emit(task);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      task.status = aborted ? 'cancelled' : 'failed';
      task.error = aborted ? null : (error instanceof Error ? error.message : String(error));
      task.imageDataUrl = null;
      this.emit(task);
    } finally {
      task.controller = null;
      this.runningTaskId = null;
      void this.processNext();
    }
  }

  private emit(task: AvatarGenerationTask) {
    const publicState = this.toPublicState(task);
    if (!publicState) return;
    this.listenersByTask.get(task.id)?.forEach((listener) => listener(publicState));
    this.listenersByTarget.get(task.targetKey)?.forEach((listener) => listener(publicState));
  }

  private toPublicState(task?: AvatarGenerationTask | AvatarGenerationTaskState | null): AvatarGenerationTaskState | null {
    if (!task) return null;
    return {
      id: task.id,
      targetKey: task.targetKey,
      status: task.status,
      error: task.error,
      imageDataUrl: task.imageDataUrl,
      characterId: task.characterId || null,
    };
  }
}

export const avatarGenerationQueue = new AvatarGenerationQueueService();
