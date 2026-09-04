import type { CompanionshipRuntimeTrace } from './companionship';

export type MessageType = 'ai' | 'user' | 'system' | 'god' | 'event';

export type MessageAttachmentKind = 'image' | 'audio' | 'sticker' | 'file';
export type ChatFileSource = 'message_upload' | 'chat_artifact' | 'workspace_file' | 'generated_file';

export interface ChatFileAttachment {
  id: string;
  source: ChatFileSource;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
  textContent?: string;
  workspaceId?: string;
  relativePath?: string;
  artifactId?: string;
  createdAt: number;
}
export type MessageAttachmentStatus = 'placeholder' | 'queued' | 'generating' | 'ready' | 'failed' | 'deleted';

export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  status: MessageAttachmentStatus;
  altText: string;
  fileName?: string;
  textContent?: string;
  caption?: string;
  slotId?: string;
  assetId?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  generationJobId?: string;
  promptText?: string;
  /** Distinguishes generated learning audio from ordinary character voice messages. */
  audioPurpose?: 'chat_voice' | 'listening_exercise';
  /** Per-attachment transcript policy; learning listening audio can override global settings. */
  transcriptVisibility?: 'default' | 'visible' | 'hidden';
  ttsVoice?: string;
  ttsLanguage?: string;
  ttsSpeed?: number;
  ttsPitch?: number;
  ttsStyle?: string;
  semanticSummary?: string;
  aspectRatio?: string;
  imageSize?: string;
  targetArtifactId?: string;
  targetImageIds?: string[];
  referenceImageIds?: string[];
  styleImageIds?: string[];
  referenceCharacterIds?: string[];
  referenceImages?: Array<{
    url: string;
    mimeType?: string;
    label?: string;
  }>;
  thumbnailAssetId?: string;
  checksum?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaGenerationDecision {
  images?: Array<{
    shouldGenerate: boolean;
    reason?: string;
    prompt?: string;
    altText?: string;
    aspectRatio?: string;
    imageSize?: string;
    referenceCharacterIds?: string[];
    targetImageIds?: string[];
    referenceImageIds?: string[];
    styleImageIds?: string[];
  }> | null;
  image?: {
    shouldGenerate: boolean;
    reason?: string;
    prompt?: string;
    altText?: string;
    aspectRatio?: string;
    imageSize?: string;
    referenceCharacterIds?: string[];
    targetImageIds?: string[];
    referenceImageIds?: string[];
    styleImageIds?: string[];
  } | null;
  audio?: {
    shouldGenerate: boolean;
    reason?: string;
    text?: string;
    voiceProfileId?: string;
    audioPurpose?: 'chat_voice' | 'listening_exercise';
    transcriptVisibility?: 'default' | 'visible' | 'hidden';
    voice?: string;
    language?: string;
    speed?: number;
    pitch?: number;
    style?: string;
  } | null;
  sticker?: {
    shouldSend: boolean;
    keyword?: string;
    altText?: string;
  } | null;
}

export interface MessagePresenceUpdate {
  status: 'online' | 'away';
  activity?: string;
  reason?: string;
  durationMinutes?: number;
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
  voice?: {
    url: string;
    mimeType?: string;
    text?: string;
    provider?: string;
    createdAt: number;
  };
  format?: 'plain' | 'markdown';
  contextText?: string;
  renderText?: string;
  assistant?: {
    mode?: 'general';
    artifacts?: Array<{
      id: string;
      kind: string;
      title: string;
      versionId?: string;
      presentation?: 'link' | 'inline_html' | 'fullscreen_html';
      interactionId?: string;
    }>;
  };
  assistantHtmlSubmission?: {
    artifactId: string;
    baseVersionId: string;
    interactionId: string;
    submissionId: string;
    resultType: 'form' | 'quiz' | 'selection' | 'custom';
    payload: Record<string, unknown>;
    submittedAt: number;
  };
  workspaceMutationPlan?: {
    id: string;
    directoryId: string;
    mutations: Array<{ kind: 'write' | 'delete' | 'move'; path: string; destinationPath?: string; content?: string }>;
    createdAt: number;
    expiresAt: number;
    status: 'pending' | 'confirmed' | 'expired' | 'rejected';
    result?: { applied: number; failed: number; error?: string };
  };
  branching?: {
    nodeId?: string;
    parentNodeId?: string | null;
    rootNodeId?: string | null;
    sequence?: number;
    revisionOfNodeId?: string | null;
    speakerRef?: { characterInstanceId: string; displayName?: string } | null;
    revisionRootId?: string | null;
    revisionOfMessageId?: string | null;
    createdFromMessageId?: string | null;
  };
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
  presenceUpdate?: MessagePresenceUpdate;
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
        hardConstraintActorIds?: string[];
        suppressedActorIds?: string[];
        hasHardConstraints?: boolean;
        voiceRequest?: boolean;
        focusText?: string;
        beatType?: string;
        pressure?: number;
        maxTurns?: number;
        minTargetTurns?: number;
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
    characterMind?: {
      visibility: 'public' | 'private';
      visibleMemoryRecall: 'off' | 'implicit' | 'natural';
      memorySource?: 'assembly_candidates' | 'fallback_retrieval';
      targetActorId?: string;
      targetActorName?: string;
      omittedPrivateContinuity?: boolean;
      omittedRawRoomLines?: boolean;
      coreLineCount?: number;
      roomLineCount?: number;
      recallCueCount?: number;
      hasUserContinuity?: boolean;
      hasRelationshipContinuity?: boolean;
      hasSharedHistory?: boolean;
      hasWorldContext?: boolean;
    };
    companionshipContext?: CompanionshipRuntimeTrace;
    guidanceExecution?: {
      status: 'accepted' | 'accepted_after_retry' | 'failed_after_retry';
      validated: boolean;
      retryCount: number;
      rejectedDraftCount: number;
      rejectedReasons?: Array<'wrong_speaker' | 'missing_requested_image' | 'missing_requested_subject' | 'missing_topic_focus' | 'missing_question_answer' | 'missing_direct_reply_focus' | 'suppression_handoff_required' | 'empty_content'>;
      finalReason?: 'matched' | 'wrong_speaker' | 'missing_requested_image' | 'missing_requested_subject' | 'missing_topic_focus' | 'missing_question_answer' | 'missing_direct_reply_focus' | 'suppression_handoff_required' | 'empty_content';
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
  deliberationArtifacts?: {
    claims?: Array<{
      text: string;
      stance?: 'support' | 'oppose' | 'neutral' | 'review' | 'inquiry';
      reason?: string;
      confidence?: number;
    }>;
    evidence?: Array<{
      text: string;
      reason?: string;
      confidence?: number;
    }>;
    issues?: Array<{
      text: string;
      targetActorId?: string | null;
      reason?: string;
      confidence?: number;
    }>;
    verdicts?: Array<{
      text: string;
      tendency?: 'support' | 'oppose' | 'mixed' | 'undecided';
      reason?: string;
      confidence?: number;
    }>;
    summary?: {
      text: string;
      reason?: string;
      confidence?: number;
    } | null;
    overallReason?: string | null;
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
