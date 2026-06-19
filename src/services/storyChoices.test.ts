import { describe, expect, it } from 'vitest';
import { buildStoryBranchOptions, getOpenStoryChoiceState, hasVisibleStoryChoices, normalizeStoryChoiceSuggestions } from './storyChoices';

describe('storyChoices', () => {
  it('filters abstract template choices', () => {
    expect(normalizeStoryChoiceSuggestions([
      { label: '追查线索', prompt: '泛化模板' },
      { label: '去地下档案室查被撕掉的病历', prompt: '地下档案室出现新证据', intent: '冒险', risk: '被发现', reward: '找到病历' },
    ])).toEqual([
      { label: '去地下档案室查被撕掉的病历', prompt: '地下档案室出现新证据', intent: '冒险', risk: '被发现', reward: '找到病历' },
    ]);
  });

  it('cleans model formatting and developer meta from visible choice labels', () => {
    expect(normalizeStoryChoiceSuggestions([
      { label: '选项A：让林医生追问护士昨晚去向（风险：激怒护士，收益：得到线索）', prompt: '追问护士昨晚去向', risk: '激怒护士', reward: '得到线索' },
      { label: '方案2 - 让主角检查墙上的新鲜血迹 意图：搜证', prompt: '检查血迹；风险：暴露位置；收益：找到证据', intent: '搜证' },
    ])).toEqual([
      { label: '让林医生追问护士昨晚去向', prompt: '追问护士昨晚去向', risk: '激怒护士', reward: '得到线索' },
      { label: '让主角检查墙上的新鲜血迹', prompt: '检查血迹', intent: '搜证' },
    ]);
  });

  it('filters near-duplicate choices that point to the same story action', () => {
    expect(normalizeStoryChoiceSuggestions([
      { label: '追问林医生昨晚的停电记录', prompt: '林医生说出停电时有人进入档案室', risk: '激怒林医生' },
      { label: '继续追问林医生昨晚停电记录', prompt: '逼林医生交代停电时谁进入档案室', reward: '得到人名' },
      { label: '去地下档案室查被撕掉的病历', prompt: '地下档案室出现新证据', risk: '被护士发现' },
    ])).toEqual([
      { label: '追问林医生昨晚的停电记录', prompt: '林医生说出停电时有人进入档案室', risk: '激怒林医生' },
      { label: '去地下档案室查被撕掉的病历', prompt: '地下档案室出现新证据', risk: '被护士发现' },
    ]);
  });

  it('binds visible choices to active branches from the current epoch', () => {
    const options = buildStoryBranchOptions({
      storyChoices: [
        { label: '追问林医生昨晚的停电记录', prompt: '林医生说出停电时有人进入档案室', intent: '逼问', risk: '激怒林医生', reward: '得到人名' },
        { label: '去地下档案室查被撕掉的病历', prompt: '地下档案室出现新证据', intent: '探索', risk: '被值班护士发现', reward: '找到病历' },
      ],
      choiceEpoch: 3,
      branches: [
        { branchId: 'old-same-label', label: '追问林医生昨晚的停电记录', prompt: '旧分支', status: 'available', choiceEpoch: 2 },
        { branchId: 'current-a', label: '追问林医生昨晚的停电记录', prompt: '林医生说出停电时有人进入档案室', status: 'available', choiceEpoch: 3 },
        { branchId: 'current-b', label: '去地下档案室查被撕掉的病历', prompt: '地下档案室出现新证据', status: 'available', choiceEpoch: 3 },
      ],
      sourceId: 'msg-1',
    });

    expect(options).toEqual([
      { label: '追问林医生昨晚的停电记录', prompt: '林医生说出停电时有人进入档案室', value: 'current-a', intent: '逼问', risk: '激怒林医生', reward: '得到人名' },
      { label: '去地下档案室查被撕掉的病历', prompt: '地下档案室出现新证据', value: 'current-b', intent: '探索', risk: '被值班护士发现', reward: '找到病历' },
    ]);
  });

  it('falls back to stable source values before branches are persisted', () => {
    expect(buildStoryBranchOptions({
      storyChoices: [
        { label: '让护士长打开封存柜', prompt: '柜里露出缺失的值班表' },
        { label: '追问林医生昨晚的停电记录', prompt: '林医生说出停电时有人进入档案室' },
      ],
      branches: [],
      choiceEpoch: 4,
      sourceId: 'msg-2',
    })).toEqual([
      { label: '让护士长打开封存柜', prompt: '柜里露出缺失的值班表', value: 'msg-2:0', intent: null, risk: null, reward: null },
      { label: '追问林医生昨晚的停电记录', prompt: '林医生说出停电时有人进入档案室', value: 'msg-2:1', intent: null, risk: null, reward: null },
    ]);
  });

  it('falls back to latest available branch epoch when chat choiceEpoch is stale', () => {
    const options = buildStoryBranchOptions({
      storyChoices: [
        { label: '让林医生追问昨晚的停电记录', prompt: '追问停电记录' },
        { label: '让护士检查墙上的血迹', prompt: '检查血迹' },
      ],
      choiceEpoch: 1,
      branches: [
        { branchId: 'choice-2-a', label: '让林医生追问昨晚的停电记录', prompt: '追问停电记录', status: 'available', choiceEpoch: 2 },
        { branchId: 'choice-2-b', label: '让护士检查墙上的血迹', prompt: '检查血迹', status: 'available', choiceEpoch: 2 },
      ],
      sourceId: 'msg-4',
    });

    expect(options.map((option) => option.value)).toEqual(['choice-2-a', 'choice-2-b']);
  });

  it('cleans executable prompts from branch fallback data', () => {
    expect(buildStoryBranchOptions({
      storyChoices: [
        { label: '让林医生追问昨晚的停电记录', prompt: '追问停电记录；风险：激怒林医生；收益：得到人名' },
        { label: '让护士检查墙上的血迹', prompt: '检查血迹；风险：暴露位置；收益：找到证据' },
      ],
      choiceEpoch: 2,
      branches: [
        { branchId: 'ask', label: '让林医生追问昨晚的停电记录', prompt: '追问停电记录；风险：激怒林医生；收益：得到人名', status: 'available', choiceEpoch: 2 },
        { branchId: 'search', label: '让护士检查墙上的血迹', prompt: '检查血迹；风险：暴露位置；收益：找到证据', status: 'available', choiceEpoch: 2 },
      ],
      sourceId: 'msg-5',
    })).toEqual([
      { label: '让林医生追问昨晚的停电记录', prompt: '追问停电记录', value: 'ask', intent: null, risk: null, reward: null },
      { label: '让护士检查墙上的血迹', prompt: '检查血迹', value: 'search', intent: null, risk: null, reward: null },
    ]);
  });

  it('does not expose a single legacy choice as a waiting choice point', () => {
    const choices = [{ label: '让护士长打开封存柜', prompt: '柜里露出缺失的值班表' }];
    expect(hasVisibleStoryChoices(choices)).toBe(false);
    expect(buildStoryBranchOptions({ storyChoices: choices, sourceId: 'msg-3' })).toEqual([]);
  });

  it('detects open story choices from current epoch branches when message metadata is absent', () => {
    const chat = {
      sessionKind: { scenarioId: 'story-reader' },
      scenarioState: {
        phase: 'choice',
        choiceEpoch: 3,
        branches: [
          { branchId: 'old-a', label: '旧选项', status: 'available', choiceEpoch: 2 },
          { branchId: 'a', label: '让林医生追问护士', status: 'available', choiceEpoch: 3 },
          { branchId: 'b', label: '让林医生检查血迹', status: 'available', choiceEpoch: 3 },
        ],
      },
    };

    expect(getOpenStoryChoiceState(chat as Parameters<typeof getOpenStoryChoiceState>[0], [])).toEqual({
      source: 'branches',
      messageId: null,
      count: 2,
    });
    expect(getOpenStoryChoiceState({
      ...chat,
      scenarioState: { ...chat.scenarioState, phase: 'scene' },
    } as Parameters<typeof getOpenStoryChoiceState>[0], [])).toBeNull();
  });
});
