import { Card, CardContent, Chip, Stack, TextField, Typography, Tooltip, Box } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { ChatStyle, RuntimeEvolutionIntensity } from '../../types/chat';

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

function RuntimeSeedPreview(props: {
  mood: string;
  focus: string;
  recentEvent: string;
  runtimePhaseLabel: string;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  selectedCharacters: AICharacter[];
  seedMemoryText: string;
  seedArtifactText: string;
}) {
  const seedMemories = props.seedMemoryText.split('\n').map((item) => item.trim()).filter(Boolean);
  const seedArtifacts = props.seedArtifactText.split('\n').map((item) => item.trim()).filter(Boolean);
  const memberNames = props.selectedCharacters.map((character) => character.name).slice(0, 6);

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>运行态预览</Typography>
        <Stack spacing={1}>
          <Typography variant="body2"><strong>阶段：</strong>{props.runtimePhaseLabel}</Typography>
          <Typography variant="body2"><strong>气氛：</strong>{props.mood || '未设置'}</Typography>
          <Typography variant="body2"><strong>焦点：</strong>{props.focus || '未设置'}</Typography>
          <Typography variant="body2"><strong>最近事件：</strong>{props.recentEvent || '未设置'}</Typography>
          <Typography variant="body2"><strong>变化强度：</strong>{props.runtimeEvolutionIntensity === 'slow' ? '慢' : props.runtimeEvolutionIntensity === 'fast' ? '快' : '平衡'}</Typography>
          {memberNames.length ? <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>{memberNames.map((name) => <Chip key={name} size="small" label={name} />)}</Box> : <Typography variant="caption" color="text.secondary">暂无成员</Typography>}
          <Typography variant="caption" color="text.secondary">初始记忆 {seedMemories.length} 条 / 初始产物 {seedArtifacts.length} 条</Typography>
          {seedMemories.length ? <Typography variant="body2">{seedMemories.slice(0, 2).join(' / ')}</Typography> : <Typography variant="caption" color="text.secondary">暂无初始记忆</Typography>}
          {seedArtifacts.length ? <Typography variant="caption" color="text.secondary">{seedArtifacts.slice(0, 2).join(' / ')}</Typography> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function RuntimeSeedSection(props: RuntimeSeedSectionProps) {
  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>运行态种子</Typography>
          <Stack spacing={1}>
            <Typography variant="body2"><strong>阶段：</strong>{props.runtimePhaseLabel}</Typography>
            <Typography variant="body2"><strong>气氛：</strong>{props.runtimeMoodLabel}</Typography>
            <Typography variant="body2"><strong>焦点：</strong>{props.runtimeFocusLabel}</Typography>
            <Typography variant="body2"><strong>最近事件：</strong>{props.runtimeRecentEventLabel}</Typography>
            <Typography variant="body2"><strong>变化强度：</strong>{props.runtimeEvolutionIntensity === 'slow' ? '慢' : props.runtimeEvolutionIntensity === 'fast' ? '快' : '平衡'}</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Tooltip title="每行一条，适合写成共识、前情、已知关系、房间背景。" placement="top-start">
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, width: 'fit-content', cursor: 'help' }}>初始记忆种子</Typography>
          </Tooltip>
          <TextField
            value={props.seedMemoryText}
            onChange={(e) => props.setSeedMemoryText(e.target.value)}
            multiline
            rows={4}
            fullWidth
            placeholder={`例如：
大家默认知道记者小陈最近在追一条匿名爆料
心理医生和律师曾在上一轮争论过保密边界`}
          />
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Tooltip title="只有准备预置清单、纪要、结论类成果物时才需要；留空即可。" placement="top-start">
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, width: 'fit-content', cursor: 'help' }}>初始产物种子</Typography>
          </Tooltip>
          <TextField
            value={props.seedArtifactText}
            onChange={(e) => props.setSeedArtifactText(e.target.value)}
            multiline
            rows={3}
            fullWidth
            placeholder={`例如：
待核实线索清单
已公开版本时间线`}
          />
        </CardContent>
      </Card>

      <RuntimeSeedPreview
        mood={props.mood}
        focus={props.focus}
        recentEvent={props.recentEvent}
        runtimePhaseLabel={props.runtimePhaseLabel}
        runtimeEvolutionIntensity={props.runtimeEvolutionIntensity}
        selectedCharacters={props.selectedCharacters}
        seedMemoryText={props.seedMemoryText}
        seedArtifactText={props.seedArtifactText}
      />
    </Stack>
  );
}
