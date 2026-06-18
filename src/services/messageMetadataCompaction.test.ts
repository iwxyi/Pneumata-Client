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
            forbiddenAddresses: [],
            evidence: [longText],
            occurredAt: index,
          })),
          careTopicHistory: [],
          promiseHistory: [],
          sharedAnchorHistory: [],
          sharedSecretHistory: [],
          sharedPhraseHistory: [],
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
          userProfileHistory: [],
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
    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(metadata).length / 4);
  });
});
