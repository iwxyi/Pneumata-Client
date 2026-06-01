import { describe, expect, it } from 'vitest';
import type { ProjectedRuntimeTimelineItem } from './sessionProjection';
import {
  buildRuntimeTimelineBody,
  buildRuntimeTimelineCaption,
  buildRuntimeTimelineMeta,
  buildRuntimeTimelineRelationshipChips,
  buildRuntimeTimelineTitle,
  buildRuntimeTimelineTypeLabel,
  projectRuntimeTimelineDisplayItem,
} from './runtimeTimelinePresentation';

describe('runtimeTimelinePresentation', () => {
  it('builds readable relationship timeline payload', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'relationship',
      text: '关系变化',
      createdAt: 1,
      label: '关系',
      actorNames: ['甲'],
      targetNames: ['乙'],
      event: { id: 'evt-1', conversationId: 'chat-1', kind: 'relationship_delta', createdAt: 1, actorIds: ['a'], targetIds: ['b'], summary: '变化', payload: {} },
      meta: {
        relationshipDelta: {
          reason: 'test',
          delta: { warmth: 2, trust: -1, threat: 3 },
          axisReasons: {},
        },
      },
    };

    expect(buildRuntimeTimelineTitle(item)).toBe('关系变化');
    expect(buildRuntimeTimelineTypeLabel(item)).toBe('关系');
    expect(buildRuntimeTimelineBody(item)).toContain('亲和+2');
    expect(buildRuntimeTimelineMeta(item)).toBe('甲 → 乙');
    expect(buildRuntimeTimelineCaption(item)).toBeNull();
    expect(buildRuntimeTimelineRelationshipChips(item)).toEqual(['亲和 +2', '信任 -1', '威胁感 +3']);
  });

  it('builds attention followup timeline body and meta', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'artifact',
      text: '跟进',
      createdAt: 1,
      label: '产物',
      event: { id: 'evt-2', conversationId: 'chat-1', kind: 'artifact', createdAt: 1, summary: '跟进', payload: {} },
      meta: {
        attentionFollowup: {
          actorId: 'a',
          actorName: '甲',
          focus: '先回应再追问',
          status: 'pending_response',
          issuedAt: 1,
        },
      },
    };

    expect(buildRuntimeTimelineBody(item)).toContain('甲 跟进用户指令 待响应');
    expect(buildRuntimeTimelineBody(item)).toContain('先回应再追问');
    expect(buildRuntimeTimelineMeta(item)).toBe('用户跟进动作 · 甲 · 待响应');
  });

  it('builds member attention followup timeline body and meta', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'artifact',
      text: '成员跟进',
      createdAt: 2,
      label: '产物',
      event: { id: 'evt-2b', conversationId: 'chat-1', kind: 'artifact', createdAt: 2, summary: '成员跟进', payload: {} },
      meta: {
        attentionFollowup: {
          kind: 'member',
          actorId: 'a',
          actorName: '甲',
          targetId: 'b',
          targetName: '乙',
          focus: '先回应乙，再追问',
          status: 'pending_response',
          issuedAt: 2,
        },
      },
    };

    expect(buildRuntimeTimelineBody(item)).toContain('甲 跟进乙指令 待响应');
    expect(buildRuntimeTimelineMeta(item)).toBe('成员跟进动作 · 甲 → 乙 · 待响应');
  });

  it('shows manual attention source for attention candidates', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '关注候选',
      createdAt: 3,
      label: '记录',
      event: { id: 'evt-attention-candidate', conversationId: 'chat-1', kind: 'attention_candidate', createdAt: 3, summary: '关注候选', payload: {} },
      meta: {
        attentionSource: {
          source: 'manual_attention_followup_member',
          mode: 'manual',
          label: '手动跟进',
        },
      },
    };
    expect(buildRuntimeTimelineMeta(item)).toBe('关注候选 · 来源 手动跟进');
  });

  it('projects a consolidated display item model for timeline rendering', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '原文',
      createdAt: 1,
      label: '记录',
      event: { id: 'evt-3', conversationId: 'chat-1', kind: 'message_generated', createdAt: 1, summary: '原文', payload: {} },
      actorNames: ['甲'],
      targetNames: ['乙'],
    };
    const display = projectRuntimeTimelineDisplayItem(item);
    expect(display.title).toBe('消息生成');
    expect(display.typeLabel).toBe('记录');
    expect(display.bodyText).toBe('原文');
    expect(display.meta).toBeNull();
    expect(display.relationshipChips).toEqual([]);
    expect(display.roomShiftChips).toEqual([]);
  });

  it('shows readable actor audit meta for operator-origin actions', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '动作执行',
      createdAt: 2,
      label: '记录',
      event: { id: 'evt-operator', conversationId: 'chat-1', kind: 'action_resolution', createdAt: 2, summary: '动作执行', payload: {} },
      meta: {
        actorAudit: {
          actorId: 'host_moderator',
          actorName: '主持人',
          origin: 'operator',
          isOperator: true,
        },
      },
    };

    expect(buildRuntimeTimelineMeta(item)).toBe('执行者 · 主持人 · 操作者 · 非成员操作者');
  });

  it('shows suppressed candidate and calendar patch apply result as readable scheduling traces', () => {
    const suppressedItem: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '候选已抑制',
      createdAt: 3,
      label: '记录',
      event: { id: 'evt-suppress', conversationId: 'chat-1', kind: 'action_resolution', createdAt: 3, summary: '候选已抑制', payload: {} },
      meta: {
        candidateSuppression: {
          eventType: 'event_candidate_suppressed',
          candidateEventKind: 'check_in',
          reasonType: 'restraint_policy',
          reasonLabel: '触发关注克制策略（冷却/夜间/关系边界）',
          reasonDetail: '同 key 候选中保留更高置信度候选（0.93 > 0.80）',
          preferredConfidence: 0.93,
          suppressedConfidence: 0.8,
          preferredCandidateId: 'evt_candidate_keep_long_id',
          suppressedCandidateId: 'evt_candidate_drop_long_id',
          hitEventId: 'evt_private_hit_long_id',
          hitWindow: '90min',
        },
      },
    };
    const patchApplyItem: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '执行完成',
      createdAt: 4,
      label: '记录',
      event: { id: 'evt-patch-apply', conversationId: 'chat-1', kind: 'action_resolution', createdAt: 4, summary: '执行完成', payload: {} },
      meta: {
        calendarPatchApplyResult: {
          eventType: 'calendar_patch_apply_result',
          appliedCount: 2,
          skippedCount: 1,
          failedCount: 0,
          queueCount: 4,
          persistedCount: 1,
        },
      },
    };

    expect(buildRuntimeTimelineTitle(suppressedItem)).toBe('候选抑制');
    expect(buildRuntimeTimelineTypeLabel(suppressedItem)).toBe('调度');
    expect(buildRuntimeTimelineBody(suppressedItem)).toContain('0.93 > 0.80');
    expect(buildRuntimeTimelineMeta(suppressedItem)).toContain('候选抑制');
    expect(buildRuntimeTimelineMeta(suppressedItem)).toContain('保留 0.93 / 抑制 0.80');
    expect(buildRuntimeTimelineMeta(suppressedItem)).toContain('keep');
    expect(buildRuntimeTimelineMeta(suppressedItem)).toContain('drop');
    expect(buildRuntimeTimelineMeta(suppressedItem)).toContain('hit');
    expect(buildRuntimeTimelineMeta(suppressedItem)).toContain('90min');

    expect(buildRuntimeTimelineTitle(patchApplyItem)).toBe('日历草案执行');
    expect(buildRuntimeTimelineTypeLabel(patchApplyItem)).toBe('调度');
    expect(buildRuntimeTimelineBody(patchApplyItem)).toBe('应用 2 · 跳过 1 · 失败 0');
    expect(buildRuntimeTimelineMeta(patchApplyItem)).toContain('队列 4');
  });

  it('shows world attention decision as readable trigger/fallback/suppressed traces', () => {
    const decisionItem: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '世界驱动决策',
      createdAt: 5,
      label: '记录',
      event: { id: 'evt-world-decision', conversationId: 'chat-1', kind: 'action_resolution', createdAt: 5, summary: '世界驱动决策', payload: {} },
      meta: {
        worldAttentionDecision: {
          eventType: 'world_attention_decision',
          decisionType: 'fallback',
          reasonType: 'world_attention_moment_disabled',
          reasonLabel: '朋友圈功能关闭，改走替代动作',
          reasonDetail: 'share_moment 被关闭，已改为 status_update',
          fromEventKind: 'post_moment',
          toEventKind: 'status_update',
        },
      },
    };

    expect(buildRuntimeTimelineTitle(decisionItem)).toBe('世界驱动决策');
    expect(buildRuntimeTimelineTypeLabel(decisionItem)).toBe('调度');
    expect(buildRuntimeTimelineBody(decisionItem)).toContain('世界驱动改道');
    expect(buildRuntimeTimelineBody(decisionItem)).toContain('状态更新');
    expect(buildRuntimeTimelineMeta(decisionItem)).toContain('from 朋友圈');
    expect(buildRuntimeTimelineMeta(decisionItem)).toContain('to 状态更新');
  });

  it('shows suggested next trigger time for delayed moment suppression', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '候选已抑制',
      createdAt: 6,
      label: '记录',
      event: { id: 'evt-delay', conversationId: 'chat-1', kind: 'action_resolution', createdAt: 6, summary: '候选已抑制', payload: {} },
      meta: {
        candidateSuppression: {
          eventType: 'event_candidate_suppressed',
          candidateEventKind: 'post_moment',
          reasonType: 'world_attention_moment_delay_window',
          reasonLabel: '发圈延迟窗口',
          reasonDetail: '距离最近社交产物时间过近，发圈候选延后。',
          nextSuggestedAt: new Date('2026-05-29T21:30:00+08:00').getTime(),
        },
      },
    };
    const body = buildRuntimeTimelineBody(item);
    expect(body).toContain('建议');
  });

  it('shows world_decision_v2 scheduling trace with domain/source/candidate context', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'note',
      text: '世界决策',
      createdAt: 7,
      label: '记录',
      event: { id: 'evt-world-v2', conversationId: 'chat-1', kind: 'action_resolution', createdAt: 7, summary: '世界决策', payload: {} },
      meta: {
        worldDecisionV2: {
          eventType: 'world_decision_v2',
          domain: 'open_chat',
          selectedId: 'candidate-1',
          selectedKind: 'check_in',
          decisionSource: 'model',
          modelReason: '优先回应当前被点名对象',
          confidenceDelta: 0.03,
          candidateCount: 4,
        },
      },
    };

    expect(buildRuntimeTimelineTitle(item)).toBe('世界决策');
    expect(buildRuntimeTimelineTypeLabel(item)).toBe('调度');
    expect(buildRuntimeTimelineBody(item)).toContain('开放群聊');
    expect(buildRuntimeTimelineBody(item)).toContain('模型裁决');
    expect(buildRuntimeTimelineMeta(item)).toContain('世界决策 · 开放群聊 · 模型 · 候选 4 · Δ0.03');
  });
});
