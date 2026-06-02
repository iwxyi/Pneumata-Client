import type { SocialEventCandidatePayload } from '../types/runtimeEvent';

function compactSourceText(value?: string) {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, 42).replace(/[。！？!?.,，、；;：:]+$/u, '');
}

function pickBySeed(seed: string, choices: string[]) {
  if (!choices.length) return '';
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return choices[hash % choices.length];
}

export function buildMomentPostText(actorName: string, payload: SocialEventCandidatePayload) {
  if (payload.momentText?.trim()) return payload.momentText.trim();
  const source = compactSourceText(payload.sourceText);
  const seed = [
    actorName,
    payload.reasonType,
    payload.seedIntent,
    payload.activityType,
    payload.dedupeKey,
    source,
  ].filter(Boolean).join('|');
  const hasPhoto = (payload.expectedArtifacts || []).some((item) => item !== 'moment_text');

  if (payload.reasonType === 'world_attention_share_moment_inner' || payload.activityType === '情绪碎片') {
    return pickBySeed(seed, [
      '有些话当场说出来就变味了。先放在这里，等风过去再看。',
      '刚才那一瞬间其实挺安静的，热闹都在外面，心里反而慢了半拍。',
      '不解释太多。今天这一页，留给自己看就好。',
    ]);
  }

  if (payload.reasonType === 'celebration') {
    return pickBySeed(seed, [
      hasPhoto ? '这张先占个位置。刚才真的有被这一刻哄到。' : '刚才那一下是真的开心，先记下来，免得等会儿又嘴硬。',
      hasPhoto ? '今天的快乐有图有证据，暂时不接受反驳。' : '今日份快乐到账，虽然嘴上不说，但心情确实亮了一点。',
      source ? `刚才这一段太有画面了：${source}。留个纪念。` : '有些开心不需要解释，出现的时候就已经够了。',
    ]);
  }

  if (hasPhoto || payload.activityType === '随拍') {
    return pickBySeed(seed, [
      '随手拍一张。不是为了证明什么，就是这一刻刚好值得留下。',
      '今天的光线、气氛和人都刚刚好。先发出来，别等滤镜把感觉磨没了。',
      source ? `刚才这幕还挺适合放进相册：${source}。` : '有些瞬间不发出来，好像就散得太快了。',
    ]);
  }

  if (payload.reasonType === 'world_attention_share_moment_event' || payload.activityType === '关系互动') {
    return pickBySeed(seed, [
      source ? `刚才那句还挺戳人的：${source}。先记一笔。` : '刚才这段对话有点意思，过会儿再回头看，应该还能笑一下。',
      '人和人之间有时候就差这么一小段没说完的话。今天先记到这里。',
      '刚才那个气氛很微妙，像是大家都懂，但谁也没把话说满。',
    ]);
  }

  return pickBySeed(seed, [
    payload.seedIntent || '今天有一点想记录的东西，先放这里。',
    source ? `刚才这段留一下：${source}。` : '今天这点情绪不大，但也不想让它悄悄过去。',
    '不算什么大事，但就是突然想发一下。',
  ]);
}

export function buildMomentCandidatePreview(actorName: string, payload: SocialEventCandidatePayload) {
  return payload.seedIntent || payload.sourceText || `${actorName} 有发朋友圈的候选意图`;
}
