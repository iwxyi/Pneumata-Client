export function buildIncludeUserAsMemberCopy(params: {
  isZh: boolean;
  isStoryRoom: boolean;
  includeUserAsMember: boolean;
}) {
  if (!params.isStoryRoom) {
    return {
      label: params.isZh ? '把我作为群成员' : 'Include me as a member',
      hint: params.isZh
        ? '开启后，用户普通发言按群成员语义进入关系、关注与世界事件链路。'
        : 'When enabled, normal user messages are treated as member participation for relationship, attention, and world-event runtime.',
    };
  }
  if (params.includeUserAsMember) {
    return {
      label: params.isZh ? '把我作为故事中的我' : 'Put me in the story',
      hint: params.isZh
        ? '当前开启：你是故事中的“我”，候选项会以“我……”的行动呈现。关闭后，你将作为读者/导演选择具体角色行动。'
        : 'Currently on: you act as “me” inside the story, so choices are written as my actions. Turn it off to choose concrete character actions as a reader/director.',
    };
  }
  return {
    label: params.isZh ? '把我作为故事中的我' : 'Put me in the story',
    hint: params.isZh
      ? '当前关闭：你是场外读者/导演，候选项会以具体角色行动呈现。开启后，选项会变成“我……”的故事内行动。'
      : 'Currently off: you are an outside reader/director, so choices name concrete character actions. Turn it on to make choices my in-story actions.',
  };
}
