import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition, SessionProjectionContext, SessionViewProjection } from '../types/sessionEngine';
import { getAllowedSessionActions } from './sessionActionBus';
import { createProjectionContext, projectActionSchema, projectPrivatePayloads, projectRuntimeState, projectSessionFrameworkState, projectSessionView } from './sessionProjection';

export function createSessionRuntimeContext(engine: SessionEngineDefinition, conversation: GroupChat, viewerId?: string | null, viewerRole?: string | null): SessionProjectionContext {
  return createProjectionContext(conversation, engine.buildParticipants(conversation), viewerId, viewerRole);
}

export function resolveSessionView(engine: SessionEngineDefinition, context: SessionProjectionContext): SessionViewProjection {
  const projected = projectSessionView(engine, context);
  return {
    ...projected,
    availableActions: getAllowedSessionActions(engine, context),
  };
}

export function resolveSessionProjectionData(engine: SessionEngineDefinition, context: SessionProjectionContext) {
  const actionSchema = projectActionSchema(engine, context);
  return {
    view: resolveSessionView(engine, context),
    actionSchema,
    runtimeState: projectRuntimeState(context.conversation, context),
    frameworkState: projectSessionFrameworkState(context.conversation, actionSchema),
    privatePayloads: projectPrivatePayloads(context.conversation, context),
  };
}
