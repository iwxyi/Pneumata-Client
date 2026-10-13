import { describe, expect, it } from 'vitest';
import { getStyleProfile, resolveChatStyleProfile, resolveDefaultStyleProfile, resolveRichDeliveryPolicy } from './styleProfileRegistry';

describe('styleProfileRegistry', () => {
  it('keeps direct and AI-private companionship low-pressure without making it a short-answer rule', () => {
    expect(resolveDefaultStyleProfile({ scenarioId: 'direct-chat', family: 'conversation' })).toBe('companion_room');
    expect(resolveDefaultStyleProfile({ scenarioId: 'ai-private-thread', family: 'conversation' })).toBe('companion_room');

    const constraints = getStyleProfile('companion_room')?.promptContext.additionalConstraints?.join('\n') || '';

    expect(constraints).toContain('Low-pressure is about tone and consent');
    expect(constraints).toContain('not a short-answer rule');
    expect(constraints).toContain('when the user requests a deliverable');
    expect(constraints).not.toContain('Prioritize emotional acknowledgment, reassurance');
  });

  it('maps the user-selected conversation style to the runtime expression profile', () => {
    expect(resolveChatStyleProfile('free')).toBe('casual_room');
    expect(resolveChatStyleProfile('debate')).toBe('analytical_room');
    expect(resolveChatStyleProfile('brainstorm')).toBe('discovery_room');
    expect(resolveChatStyleProfile('roleplay')).toBe('dramatic_room');
  });

  it('stores styleProfile on prompt contexts so runtime planning sees the same profile', () => {
    expect(getStyleProfile('casual_room')?.promptContext.styleProfile).toBe('casual_room');
    expect(getStyleProfile('analytical_room')?.promptContext.styleProfile).toBe('analytical_room');
    expect(getStyleProfile('discovery_room')?.promptContext.styleProfile).toBe('discovery_room');
    expect(getStyleProfile('dramatic_room')?.promptContext.styleProfile).toBe('dramatic_room');
  });

  it('keeps conversational extra sends available without making them the default tendency', () => {
    for (const profile of ['casual_room', 'companion_room']) {
      const delivery = resolveRichDeliveryPolicy(profile);
      expect(delivery.multiBubble).toMatchObject({ proactivity: 'low', maxBubbles: 5, organization: 'conversational' });
    }
  });
});
