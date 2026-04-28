import { Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { ChatStyle, RuntimeEvolutionIntensity } from '../../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE, DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../../types/chat';
import ChatRuntimePanel from '../chat/ChatRuntimePanel';

interface RuntimeSeedSectionProps {
  editingChatId?: string;
  editingChatCreatedAt?: number;
  editingChatUpdatedAt?: number;
  editingChatLastMessageAt?: number;
  editingChatTimeline?: Array<{ type: 'note' | 'artifact' | 'relationship'; text: string; createdAt: number }>;
  name: string;
  topic: string;
  style: ChatStyle;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  selectedMembers: string[];
  showRoleActions: boolean;
  ownerCharacterId: string;
  adminCharacterIds: string[];
  autoModeration: boolean;
  allowMute: boolean;
  allowPrivateThreads: boolean;
  allowCliques: boolean;
  allowMockery: boolean;
  mood: string;
  focus: string;
  recentEvent: string;
  allowSpeakAs: boolean;
  allowDirectorMode: boolean;
  allowEventInjection: boolean;
  allowForcedReply: boolean;
  seedMemoryText: string;
  seedArtifactText: string;
  setSeedMemoryText: (value: string) => void;
  setSeedArtifactText: (value: string) => void;
  runtimePhaseLabel: string;
  runtimeMoodLabel: string;
  runtimeFocusLabel: string;
  runtimeRecentEventLabel: string;
  selectedCharacters: AICharacter[];
}

export default function RuntimeSeedSection(props: RuntimeSeedSectionProps) {
  return (
    <Stack spacing={2}>
      <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>运行态种子</Typography><Stack spacing={1}><Typography variant="body2"><strong>阶段：</strong>{props.runtimePhaseLabel}</Typography><Typography variant="body2"><strong>气氛：</strong>{props.runtimeMoodLabel}</Typography><Typography variant="body2"><strong>焦点：</strong>{props.runtimeFocusLabel}</Typography><Typography variant="body2"><strong>最近事件：</strong>{props.runtimeRecentEventLabel}</Typography><Typography variant="body2"><strong>变化强度：</strong>{props.runtimeEvolutionIntensity === 'slow' ? '慢' : props.runtimeEvolutionIntensity === 'fast' ? '快' : '平衡'}</Typography></Stack></CardContent></Card>
      <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>初始记忆种子</Typography><TextField value={props.seedMemoryText} onChange={(e) => props.setSeedMemoryText(e.target.value)} multiline rows={4} fullWidth placeholder="每行一条，会作为初始记忆导入" /></CardContent></Card>
      <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>初始产物种子</Typography><TextField value={props.seedArtifactText} onChange={(e) => props.setSeedArtifactText(e.target.value)} multiline rows={3} fullWidth placeholder="每行一条，会作为初始产物导入" /></CardContent></Card>
      <ChatRuntimePanel chat={{ id: props.editingChatId || 'draft', type: 'group', mode: 'open_chat', modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG, modeState: DEFAULT_OPEN_CHAT_MODE_STATE, name: props.name || '未命名群聊', topic: props.topic, style: props.style, runtimeEvolutionIntensity: props.runtimeEvolutionIntensity, memberIds: props.selectedMembers, speed: 1, isActive: false, allowIntervention: true, showRoleActions: props.showRoleActions, topicSeed: '', sourceChatId: null, sourceMemberIds: [], runtimeSeed: { notes: props.seedMemoryText.split('\n').map((item) => item.trim()).filter(Boolean), artifacts: props.seedArtifactText.split('\n').map((item) => item.trim()).filter(Boolean) }, runtimeTimeline: props.editingChatTimeline || [], governance: { ...DEFAULT_CONVERSATION_GOVERNANCE, ownerCharacterId: props.ownerCharacterId || null, adminCharacterIds: props.adminCharacterIds, autoModeration: props.autoModeration, allowMute: props.allowMute, allowPrivateThreads: props.allowPrivateThreads }, dramaRules: { ...DEFAULT_CONVERSATION_DRAMA_RULES, allowCliques: props.allowCliques, allowMockery: props.allowMockery }, worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, mood: props.mood, focus: props.focus, recentEvent: props.recentEvent }, directorControls: { ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, allowSpeakAs: props.allowSpeakAs, allowDirectorMode: props.allowDirectorMode, allowEventInjection: props.allowEventInjection, allowForcedReply: props.allowForcedReply }, createdAt: props.editingChatCreatedAt || Date.now(), updatedAt: props.editingChatUpdatedAt || Date.now(), lastMessageAt: props.editingChatLastMessageAt || Date.now() }} members={props.selectedCharacters} />
    </Stack>
  );
}
