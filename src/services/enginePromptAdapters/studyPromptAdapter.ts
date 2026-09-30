import type { EnginePromptAdapter } from '../promptContextAssembler';
import { buildCrossModeMemoryPrompt } from '../promptBuilder';

function isPracticeRequest(messages: Parameters<EnginePromptAdapter['buildSystemPrompt']>[0]['messages']) {
  const latestLearnerMessage = messages
    .filter((message) => !message.isDeleted && (message.type === 'user' || message.type === 'god'))
    .at(-1)?.content || '';
  return /(测试|测一下|模拟测试|模拟考|出题|练习|小测|试卷|题目|test|quiz|practice|mock exam|mock test)/i.test(latestLearnerMessage);
}

function isListeningPracticeRequest(messages: Parameters<EnginePromptAdapter['buildSystemPrompt']>[0]['messages']) {
  const recentLearnerText = messages
    .filter((message) => !message.isDeleted && (message.type === 'user' || message.type === 'god'))
    .slice(-3)
    .map((message) => message.content)
    .join('\n');
  return /(听力题|听力练习|练听力|听力音频|听力材料|listening practice|listening question|listening audio|听.*题)/i.test(recentLearnerText);
}

function hasPendingExerciseOffer(messages: Parameters<EnginePromptAdapter['buildSystemPrompt']>[0]['messages']) {
  const recentAssistant = [...messages]
    .reverse()
    .find((message) => !message.isDeleted && message.type === 'ai')?.content || '';
  return /(准备好|说一声|给你出|给你放|开始.*题|安排.*练习|先.*小测)/i.test(recentAssistant);
}

export const studyPromptAdapter: EnginePromptAdapter = {
  key: 'learning-progress',
  buildSystemPrompt: ({ character, chat, messages, characters }) => {
    const learning = chat.scenarioState?.learning;
    const role = chat.memberIds.find((id) => id !== 'user') === character.id ? 'teacher' : 'student';
    const knowledge = learning?.knowledgeItems?.slice(0, 24).map((item) => `${item.id}: ${item.title}（${item.status}）`).join('、') || '尚未建立知识点地图';
    const evidence = learning?.evidence?.slice(-6).map((item) => item.summary).filter(Boolean).join('；') || '暂无已记录学习证据';
    const attempts = learning?.attempts?.slice(-4).map((item) => `${item.status}${typeof item.score === 'number' ? ` ${item.score}${typeof item.maxScore === 'number' ? `/${item.maxScore}` : ''}` : ''}`).join('、') || '暂无练习提交';
    const recent = messages.slice(-8).map((message) => `${message.senderName}: ${message.content}`).join('\n');
    const memoryPrompt = buildCrossModeMemoryPrompt(character, chat, messages, characters);
    const practiceRequest = isPracticeRequest(messages);
    const listeningPracticeRequest = isListeningPracticeRequest(messages);
    const pendingExerciseOffer = hasPendingExerciseOffer(messages);
    const learnerCount = chat.memberIds.filter((memberId) => memberId === 'user' || memberId.startsWith('user:')).length;
    const oneToOneGuidance = learnerCount <= 1;
    return [
      `You are ${character.name} in a learning-progress room called "${chat.name}".`,
      `Room role: ${role}. Teaching mode: ${learning?.teachingMode || 'casual'}.`,
      `Teacher expertise: ${learning?.teacherExpertise || '角色自定义，无预设专长。'}`,
      `Assessment policy: ${learning?.assessmentPolicy || 'evidence_only'}; never claim mastery without learner evidence.`,
      `Learning goal: ${learning?.goal || chat.topic || 'not specified'}.`,
      `Current phase: ${chat.scenarioState?.phase || 'mapping'}.`,
      `Known learning map: ${knowledge}.`,
      `Recent observed evidence: ${evidence}.`,
      `Recent attempts: ${attempts}.`,
      oneToOneGuidance
        ? 'Learner setting: one-to-one guidance. Address the learner directly with “你/你现在/你的”，and never use group wording such as “大家”“你们”“各位” unless quoting the learner.'
        : `Learner setting: ${learnerCount} learners. Use singular or plural address according to the actual participants; do not invent additional learners.`,
      memoryPrompt,
      'Rules:',
      '1. This is a general learning-progress room, not a subject-specific exam room. Adapt to any learnable goal: languages, programming, school subjects, exams, writing, arts, professional skills, or practical projects.',
      '2. Preserve the character personality, but keep the learning goal visible in your choices.',
      '3. Separate what the learner demonstrated from what is merely assumed. Do not invent a level, score, or mastery claim without evidence.',
      '4. Prefer a concrete next step, example, exercise, study material, or small deliverable over a vague lecture or a promise to prepare something later.',
      '5. If the learner clearly asks for practice, testing, feedback, or a deliverable and the request is sufficiently specified, provide a useful first version directly in this reply. Do not merely describe a future plan.',
      '6. Ask a clarifying question first only when the learner intent is genuinely ambiguous or a missing critical detail (such as subject scope, target format, available tools, or current level) would make a direct response misleading. When possible, make a reasonable assumption, state it briefly, and proceed.',
      '7. If a requested format is unavailable in this chat (for example, audio), offer the closest useful alternative instead of pretending it was provided.',
      '8. For entertainment teachers, mark playful guesses as uncertain and avoid presenting them as verified facts.',
      '9. Use Markdown when it improves the explanation; do not expose internal IDs or runtime mechanics.',
      '10. Honor an explicit plain-text request. If the learner asks for plain-text questions or does not request audio/HTML, a self-contained text exercise is valid and preferred; do not force an attachment, HTML artifact, or audio player.',
      '11. For a listening exercise, hide the script and request structured audio only when the learner wants an audio listening exercise and audio is available. Set audioPurpose="listening_exercise", transcriptVisibility="hidden", and include the requested language, voice style and speed when supplied. If the learner explicitly requests plain text, provide a text-based listening transcript exercise instead and label it as text, not as an audio exercise.',
      practiceRequest
        ? `12. The learner is asking for practice or testing. Unless a critical detail is missing, start with a compact, answerable first task now; include the expected response format and wait for the learner response before grading or revealing solutions.${listeningPracticeRequest ? ' This is specifically a listening-practice request: generate the first listening task now (audio attachment when explicitly appropriate and available, otherwise a clearly labeled text-based listening exercise with transcript/dialogue and questions). Do not answer with study advice, a Cambridge-resource recommendation, or a plan for finding material.' : ''}${pendingExerciseOffer ? ' A previous teacher message already offered this exercise, so the learner\'s acceptance or request for the题目 is enough: do not ask whether they are ready again and do not add another warm-up preamble.' : ''}`
        : '12. Keep the interaction incremental: one useful step at a time, then use the learner response to decide what should come next.',
      `Recent exchange:\n${recent || 'No messages yet.'}`,
    ].join('\n\n');
  },
};
