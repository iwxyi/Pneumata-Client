import { describe, expect, it } from 'vitest';
import type { MessageMetadata } from '../types/message';
import { compactMessageMetadata } from './messageMetadataCompaction';

describe('messageMetadataCompaction', () => {
  it('drops duplicated context text and compacts runtime histories', () => {
    const longText = '很长的运行态证据'.repeat(80);
    const metadata: MessageMetadata = {
      contextText: longText,
      runtimeDecision: {
        speakerScore: {
          actorId: 'char-a',
          finalScore: 1,
          addressed: 1,
          topicRelevance: 1,
          lineInvolvement: 1,
          emotionalPressure: 1,
          innerLifePressure: 1,
          relationshipPressure: 1,
          factionPressure: 1,
          personalityDrive: 1,
          repetitionPenalty: 0,
          reasons: Array.from({ length: 20 }, (_, index) => `${longText}-${index}`),
        },
        companionshipContext: {
          style: 'ambiguous',
          phase: 'ambiguous',
          currentAddress: '小夏',
          sharedAnchors: Array.from({ length: 10 }, (_, index) => `${longText}-${index}`),
          sharedPhrases: [],
          sharedSecrets: [],
          rituals: [],
          pendingCareTopics: [],
          pendingPromises: [],
          rememberedUserPlans: [],
          boundaries: [],
          boundaryReasons: [],
          userProfileCues: [],
          addressingHistory: Array.from({ length: 12 }, (_, index) => ({
            id: `address-${index}`,
            action: 'set_current',
            currentAddress: '小夏',
            privateAddress: '夏夏',
            publicAddress: '夏同学',
            forbiddenAddresses: ['陌生称呼'],
            initiatedBy: 'user',
            evidence: [longText],
            sourceMessageIds: [`address-msg-${index}`],
            decisionSource: 'model',
            occurredAt: index,
          })),
          careTopicHistory: [],
          promiseHistory: [],
          sharedAnchorHistory: [],
          sharedSecretHistory: [],
          sharedPhraseHistory: Array.from({ length: 8 }, (_, index) => ({
            id: `phrase-${index}`,
            phraseId: 'phrase-main',
            action: 'upsert',
            text: `${longText}-共同话语-${index}`,
            kind: 'inside_joke',
            participantIds: ['char-a', 'user'],
            visibility: 'private',
            evidence: [longText],
            sourceMessageIds: [`msg-${index}`],
            decisionSource: 'model',
            occurredAt: index,
          })),
          ritualHistory: [],
          carePolicy: {
            dailyInitiationBudget: 1,
            triggerSensitivity: 0.5,
            silenceAnxietyThresholdHours: 12,
            expressionIntensity: 0.5,
            allowGoodMorning: true,
            allowGoodNight: true,
            allowMissYou: false,
          },
          phaseHistory: [],
          userProfileHistory: Array.from({ length: 8 }, (_, index) => ({
            id: `profile-${index}`,
            action: 'upsert',
            items: [{
              kind: 'preference',
              text: `${longText}-喜欢晚上聊天-${index}`,
              evidence: `${longText}-画像证据-${index}`,
              sourceMessageIds: [`profile-msg-${index}`],
              confidence: 0.88,
              sensitive: index % 2 === 0,
            }],
            evidence: [longText],
            sourceMessageIds: [`profile-msg-${index}`],
            decisionSource: 'model',
            occurredAt: index,
          })),
          conflictHistory: [],
          attachmentHistory: [],
          diagnostics: [longText],
          evidence: [longText],
          intimacy: {
            attraction: 1,
            intimacy: 2,
            attachment: 3,
            longing: 4,
            exclusivity: 5,
            security: 6,
          },
          userProfileConfidence: 70,
        },
      },
    };

    const compacted = compactMessageMetadata(metadata, { dropContextText: true });
    const reasons = compacted?.runtimeDecision?.speakerScore?.reasons as string[] | undefined;

    expect(compacted?.contextText).toBeUndefined();
    expect(reasons).toHaveLength(6);
    expect(reasons?.[0]?.length).toBeLessThan(220);
    expect(compacted?.runtimeDecision?.companionshipContext?.sharedAnchors).toHaveLength(3);
    expect(compacted?.runtimeDecision?.companionshipContext?.addressingHistory).toHaveLength(3);
    expect(compacted?.runtimeDecision?.companionshipContext?.addressingHistory?.[0]).toMatchObject({
      currentAddress: '小夏',
      privateAddress: '夏夏',
      publicAddress: '夏同学',
      forbiddenAddresses: ['陌生称呼'],
      initiatedBy: 'user',
      sourceMessageIds: ['address-msg-0'],
      decisionSource: 'model',
    });
    expect(compacted?.runtimeDecision?.companionshipContext?.userProfileHistory).toHaveLength(3);
    expect(compacted?.runtimeDecision?.companionshipContext?.userProfileHistory?.[0]?.decisionSource).toBe('model');
    expect(compacted?.runtimeDecision?.companionshipContext?.userProfileHistory?.[0]?.items?.[0]).toMatchObject({
      kind: 'preference',
      sourceMessageIds: ['profile-msg-0'],
      confidence: 0.88,
      sensitive: true,
    });
    expect(compacted?.runtimeDecision?.companionshipContext?.userProfileHistory?.[0]?.items?.[0]?.text.length).toBeLessThan(220);
    expect(compacted?.runtimeDecision?.companionshipContext?.sharedPhraseHistory).toHaveLength(3);
    expect(compacted?.runtimeDecision?.companionshipContext?.sharedPhraseHistory?.[0]).toMatchObject({
      phraseId: 'phrase-main',
      participantIds: ['char-a', 'user'],
      visibility: 'private',
      decisionSource: 'model',
    });
    expect(compacted?.runtimeDecision?.companionshipContext?.sharedPhraseHistory?.[0]?.text.length).toBeLessThan(220);
    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(metadata).length / 4);
  });
});
