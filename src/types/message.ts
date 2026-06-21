import type { CompanionshipRuntimeTrace } from './companionship';

export type MessageType = 'ai' | 'user' | 'system' | 'god' | 'event';

export type MessageAttachmentKind = 'image' | 'audio' | 'sticker';
export type MessageAttachmentStatus = 'placeholder' | 'queued' | 'generating' | 'ready' | 'failed' | 'deleted';

export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  status: MessageAttachmentStatus;
  altText: string;
  assetId?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  generationJobId?: string;
  promptText?: string;
  referenceCharacterIds?: string[];
  thumbnailAssetId?: string;
  checksum?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaGenerationDecision {
  image?: {
    shouldGenerate: boolean;
    reason?: string;
    prompt?: string;
    altText?: string;
    referenceCharacterIds?: string[];
  } | null;
  audio?: {
    shouldGenerate: boolean;
    reason?: string;
    text?: string;
    voiceProfileId?: string;
  } | null;
}

export type NarrativeActorKind = 'narrator' | 'character' | 'director' | 'system';
export type NarrativeBlockKind = 'prose' | 'dialogue' | 'action' | 'inner_thought' | 'choice' | 'system_note';
export type NarrativeDisplayMode = 'paragraph' | 'bubble' | 'choice_card' | 'system_panel' | 'hidden';
export type NarrativeTurnKind = 'narrative_beat' | 'character_reaction' | 'choice_prompt' | 'reveal';

export interface NarrativeChoice {
  id: string;
  label: string;
  prompt?: string;
  intent?: string | null;
  risk?: string | null;
  reward?: string | null;
}

export interface StoryChoiceSuggestion {
  label: string;
  prompt?: string | null;
  intent?: string | null;
  risk?: string | null;
  reward?: string | null;
}

export type StoryEventType = 'narration' | 'speech' | 'choice_point' | 'chapter_update';

export interface StoryEventChoice {
  label: string;
  prompt?: string | null;
  intent?: string | null;
  risk?: string | null;
  reward?: string | null;
}

export interface StoryEvent {
  type: StoryEventType;
  text?: string;
  speakerName?: string;
  characterId?: string;
  choices?: StoryEventChoice[];
  title?: string;
  summary?: string;
  status?: 'active' | 'completed';
  startNewChapter?: boolean;
  keyChoices?: string[];
}

export interface StoryQualityTrace {
  score: number;
  labels: string[];
  gaps: string[];
}

export interface StoryChoiceSelection {
  branchId?: string;
  sourceMessageId?: string;
  label: string;
  prompt?: string | null;
  intent?: string | null;
  risk?: string | null;
  reward?: string | null;
  choiceEpoch?: number;
}

export interface NarrativeBlock {
  id: string;
  actorId: string;
  actorKind: NarrativeActorKind;
  kind: NarrativeBlockKind;
  displayMode: NarrativeDisplayMode;
  text: string;
  actorName?: string;
  characterId?: string;
  choices?: NarrativeChoice[];
}

export interface NarrativeTurnMetadata {
  turnId: string;
  turnKind: NarrativeTurnKind;
  sceneId?: string;
  phase?: string;
  povActorId?: string;
  blocks: NarrativeBlock[];
}

export interface MessageMetadata {
  format?: 'plain' | 'markdown';
  contextText?: string;
  renderText?: string;
  storyEvents?: StoryEvent[];
  storyQuality?: StoryQualityTrace;
  narrativeTurn?: NarrativeTurnMetadata;
  storyChoices?: StoryChoiceSuggestion[];
  storyChoiceSelection?: StoryChoiceSelection;
  manualSpeaker?: {
    actorId: string;
    actorName: string;
    avatar?: string;
  };
  withdrawal?: {
    withdrawn: boolean;
    originalContent?: string;
    reason?: string;
    withdrawnAt?: number;
    visiblePending?: boolean;
  };
  attachments?: MessageAttachment[];
  generationDecision?: MediaGenerationDecision;
  generation?: {
    status?: 'queued' | 'generating' | 'ready' | 'failed';
    updatedAt?: number;
    error?: string;
  };
  runtimeDecision?: {
    directorIntent?: {
      source: string;
      beatType: string;
      targetLineId?: string;
      targetActorIds?: string[];
      pressure?: number;
      reason?: string;
      userGuidance?: {
        kind: string;
        rawText: string;
        actorIds?: string[];
        mentionedActorIds?: string[];
        focusText?: string;
        beatType?: string;
        pressure?: number;
        maxTurns?: number;
        reason?: string;
        mediaRequest?: {
          kind: string;
          subjectActorIds?: string[];
          subjectText?: string;
          actionText?: string;
        } | null;
      } | null;
    };
    narrativeLines?: Array<{
      id: string;
      type: string;
      title: string;
      salience: number;
      tension: number;
      status: string;
      participantIds?: string[];
    }>;
    speakerSelection?: {
      speakerId?: string | null;
      reason?: string | null;
      bypassNotice?: string | null;
      policy?: Record<string, unknown>;
    };
    speakerScore?: Record<string, unknown>;
    innerLife?: {
      impulse: string;
      tone: string;
      reason: string;
      pressure: number;
      evidence?: string[];
      state?: {
        energy?: number;
        attention?: number;
        loneliness?: number;
        repression?: number;
        shame?: number;
        envy?: number;
        trustInRoom?: number;
        ignoredStreak?: number;
      };
      expressionPlan?: {
        length?: string;
        messageCount?: number;
        typoLevel?: number;
        delayMs?: number;
        allowWithdraw?: boolean;
      };
    };
    responseSurface?: {
      kind: 'chat' | 'professional' | 'creative' | 'longform';
      allowMarkdown: boolean;
      preserveParagraphs: boolean;
      roleFit: 'limited' | 'ordinary' | 'capable';
      basis: string[];
    };
    turnPlan?: {
      rhythm: 'micro_ack' | 'short_reply' | 'full_reply' | 'multi_bubble' | 'defer_or_wait';
      targetBubbleCount: number;
      lengthBand: 'micro' | 'short' | 'medium' | 'long' | 'extended';
      allowExtraMessages: boolean;
      waitSensitive: boolean;
      reasons: string[];
    };
    personaActivation?: {
      level: 'low' | 'medium' | 'high' | 'masked';
      reasons: string[];
    };
    intentionalRepeat?: boolean;
    memoryContext?: {
      injectedIds?: string[];
      targetActorId?: string;
      targetActorName?: string;
      targetReason?: string;
      sharedSecretGuards?: string[];
      recalledArchives?: Array<{
        id: string;
        scope: string;
        kind: string;
        layer: string;
        summary: string;
        recallReason?: string;
        recallTokens?: string[];
        recallScore?: number;
      }>;
    };
    companionshipContext?: CompanionshipRuntimeTrace;
    guidanceExecution?: {
      status: 'accepted' | 'accepted_after_retry' | 'failed_after_retry';
      validated: boolean;
      retryCount: number;
      rejectedDraftCount: number;
      rejectedReasons?: Array<'wrong_speaker' | 'missing_requested_image' | 'missing_requested_subject' | 'missing_topic_focus' | 'missing_question_answer' | 'missing_direct_reply_focus' | 'empty_content'>;
      finalReason?: 'matched' | 'wrong_speaker' | 'missing_requested_image' | 'missing_requested_subject' | 'missing_topic_focus' | 'missing_question_answer' | 'missing_direct_reply_focus' | 'empty_content';
      forcedMediaQueued?: boolean;
    };
    worldInfluence?: {
      attentionScore?: number;
      attentionRestraint?: number;
      activeRuleIds?: string[];
      activeRuleTexts?: string[];
    };
    generationRuntime?: {
      turnPlan?: unknown;
      expressionPlan?: unknown;
      realizationPlan?: unknown;
      trace?: unknown;
    };
    expressionFeedback?: Array<{
      id: string;
      label: string;
      text: string;
      evidence?: string;
      kind?: string;
      layer?: string;
      confidence?: number;
      count?: number;
      positiveCount?: number;
      applied?: boolean;
      effects?: string[];
    }>;
  };
  turnSegment?: {
    index: number;
    count: number;
  };
  visibility?: string;
  cachePolicy?: Record<string, unknown>;
}

export interface Message {
  id: string;
  clientKey?: string;
  serverId?: string;
  chatId: string;
  type: MessageType;
  senderId: string;         // AI character ID, 'user', or 'system'
  senderName: string;
  content: string;
  metadata?: MessageMetadata;
  emotion: number;           // -1 to 1
  timestamp: number;
  isDeleted: boolean;
  isOptimistic?: boolean;
  isStreaming?: boolean;
}
