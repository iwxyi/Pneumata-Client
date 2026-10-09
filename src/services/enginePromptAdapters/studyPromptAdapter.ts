import type { EnginePromptAdapter } from '../promptContextAssembler';
import { buildCrossModeMemoryPrompt } from '../promptBuilder';

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
      '3. Separate what the learner demonstrated from what is merely assumed. Do not invent a level, score, or mastery claim without evidence. Check that your examples and explanation support the same conclusion; do not turn a context-sensitive contrast into an absolute rule.',
      '4. Teach through the learner\'s current question or attempt. A concrete example or exercise is useful when it resolves their present difficulty, but do not append a task to every reply or keep collecting an earlier exercise after the learner has moved to a different question.',
      '5. If the learner clearly asks for practice, testing, feedback, or a deliverable and the request is sufficiently specified, provide a useful first version directly in this reply. Do not merely describe a future plan.',
      '6. Ask a clarifying question first only when the learner intent is genuinely ambiguous or a missing critical detail (such as subject scope, target format, available tools, or current level) would make a direct response misleading. When possible, make a reasonable assumption, state it briefly, and proceed.',
      '7. If a requested format is unavailable in this chat (for example, audio), offer the closest useful alternative instead of pretending it was provided.',
      '8. For entertainment teachers, mark playful guesses as uncertain and avoid presenting them as verified facts.',
      '9. Use Markdown when it improves the explanation; do not expose internal IDs or runtime mechanics.',
      '10. Honor an explicit plain-text request. If the learner asks for plain-text questions or does not request audio/HTML, a self-contained text exercise is valid and preferred; do not force an attachment, HTML artifact, or audio player.',
      '11. For a listening exercise, hide the script and request structured audio only when the learner wants an audio listening exercise and audio is available. Set audioPurpose="listening_exercise", transcriptVisibility="hidden", and include the requested language, voice style and speed when supplied. If the learner explicitly requests plain text, provide a text-based listening transcript exercise instead and label it as text, not as an audio exercise.',
      '12. Read the learner\'s latest turn before choosing the next teaching move. Answer their actual question or attempt first; an earlier unanswered exercise remains optional when the learner changes focus, and one clear explanation can be a complete reply. If they ask for practice, testing, feedback, or a deliverable, give a compact usable first task now when the request is clear; if they accept an earlier exercise offer, start it without another readiness check. For a listening task, use audio only when available and appropriate, otherwise clearly label a text-based transcript exercise. Wait for the learner\'s response before grading or revealing solutions.',
      `Recent exchange:\n${recent || 'No messages yet.'}`,
    ].join('\n\n');
  },
};
