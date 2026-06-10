import { Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import type { RoomTemplateCategory, RoomTemplateDefinition, RoomTemplateKey, RoomTemplateStructure } from '../../services/roomTemplates';
import { listTemplateCategories, listTemplateStructures, listTemplatesByStructureAndCategory } from '../../services/roomTemplates';

const STRUCTURE_LABELS: Record<string, string> = {
  conversation: '互动结构',
  analysis: '讨论结构',
  study: '训练结构',
  agent: 'Agent结构',
  deduction: '推理结构',
  mystery: '案件结构',
  board_game: '棋盘结构',
  simulation: '世界结构',
};

const FAMILY_LABELS: Record<string, string> = {
  conversation: '互动叙事',
  analysis: '讨论协作',
  study: '教学训练',
  agent: 'Agent工作流',
  interview: '面试评审',
  deduction: '推理对抗',
  mystery: '剧本谜案',
  board_game: '棋盘对局',
  simulation: '世界模拟',
};

const INTENSITY_OPTIONS = [
  { value: 'slow', zh: '慢节奏', en: 'Slow' },
  { value: 'balanced', zh: '平衡', en: 'Balanced' },
  { value: 'fast', zh: '快节奏', en: 'Fast' },
] as const;

interface GameplaySectionProps {
  language: string;
  roomTemplate: RoomTemplateKey;
  roomTemplates: RoomTemplateDefinition[];
  onRoomTemplateChange: (value: RoomTemplateKey) => void;
  runtimeEvolutionIntensity: 'slow' | 'balanced' | 'fast';
  onRuntimeEvolutionIntensityChange: (value: 'slow' | 'balanced' | 'fast') => void;
  topic: string;
  discussionRoundsTarget: number;
  onDiscussionRoundsTargetChange: (value: number) => void;
  storyBranchMode: 'guided' | 'open';
  onStoryBranchModeChange: (value: 'guided' | 'open') => void;
  studyGoalLabel: string;
  onStudyGoalLabelChange: (value: string) => void;
  agentGoalLabel: string;
  onAgentGoalLabelChange: (value: string) => void;
  boardColumns: number;
  boardRows: number;
  onBoardColumnsChange: (value: number) => void;
  onBoardRowsChange: (value: number) => void;
  deductionFactionCount: number;
  onDeductionFactionCountChange: (value: number) => void;
  mysteryClueCount: number;
  onMysteryClueCountChange: (value: number) => void;
}

function inferSelectedStructure(template: RoomTemplateDefinition): RoomTemplateStructure {
  return template.structure;
}

function inferSelectedCategory(template: RoomTemplateDefinition): RoomTemplateCategory {
  return template.category;
}

function pickFirstTemplateKey(structure: RoomTemplateStructure, category: RoomTemplateCategory, fallback: RoomTemplateKey): RoomTemplateKey {
  return listTemplatesByStructureAndCategory(structure, category)[0]?.key || fallback;
}

export default function GameplaySection(props: GameplaySectionProps) {
  const isZh = props.language.startsWith('zh');
  const selectedTemplate = props.roomTemplates.find((item) => item.key === props.roomTemplate) || props.roomTemplates[0];
  const selectedStructure = inferSelectedStructure(selectedTemplate);
  const selectedCategory = inferSelectedCategory(selectedTemplate);
  const selectedFamily = selectedTemplate.sessionKind.family;
  const structureLabel = STRUCTURE_LABELS[selectedStructure] || selectedStructure;
  const familyLabel = FAMILY_LABELS[selectedFamily] || selectedFamily;
  const structures = listTemplateStructures();
  const categories = listTemplateCategories(selectedStructure);
  const categoryTemplates = listTemplatesByStructureAndCategory(selectedStructure, selectedCategory);

  const handleStructureChange = (structure: RoomTemplateStructure) => {
    const nextCategory = listTemplateCategories(structure)[0]?.value as RoomTemplateCategory | undefined;
    if (!nextCategory) return;
    props.onRoomTemplateChange(pickFirstTemplateKey(structure, nextCategory, props.roomTemplate));
  };

  const handleCategoryChange = (category: RoomTemplateCategory) => {
    props.onRoomTemplateChange(pickFirstTemplateKey(selectedStructure, category, props.roomTemplate));
  };

  return (
    <Stack spacing={2}>
      <SurfaceCard>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {isZh ? '玩法结构' : 'Gameplay structure'}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {structures.map((item) => {
            const selected = item.value === selectedStructure;
            return (
              <Chip
                key={item.value}
                clickable
                label={STRUCTURE_LABELS[item.value] || item.label}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => handleStructureChange(item.value as RoomTemplateStructure)}
              />
            );
          })}
        </Box>
      </SurfaceCard>

      <SurfaceCard>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {isZh ? '玩法分类' : 'Gameplay category'}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {categories.map((item) => {
            const selected = item.value === selectedCategory;
            return (
              <Chip
                key={item.value}
                clickable
                label={item.label}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => handleCategoryChange(item.value as RoomTemplateCategory)}
              />
            );
          })}
        </Box>
      </SurfaceCard>

      <SurfaceCard>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {isZh ? '具体玩法' : 'Room type'}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.25 }}>
          {categoryTemplates.map((template) => {
            const selected = template.key === props.roomTemplate;
            return (
              <Button
                key={template.key}
                variant={selected ? 'contained' : 'outlined'}
                onClick={() => props.onRoomTemplateChange(template.key)}
                sx={{ borderRadius: 999 }}
              >
                {template.label}
              </Button>
            );
          })}
        </Box>
        <Typography variant="body2" color="text.secondary">
          {selectedTemplate.description}
        </Typography>
      </SurfaceCard>

      <SurfaceCard>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {isZh ? '详细设定' : 'Detailed settings'}
        </Typography>
        <Stack spacing={1.25}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Chip label={structureLabel} color="primary" variant="outlined" />
            <Chip label={selectedTemplate.categoryLabel} variant="outlined" />
            <Chip label={familyLabel} variant="outlined" />
            <Chip label={selectedTemplate.sessionKind.scenarioId} variant="outlined" />
          </Box>
          <TextField
            select
            label={isZh ? '节奏强度' : 'Runtime intensity'}
            value={props.runtimeEvolutionIntensity}
            onChange={(e) => props.onRuntimeEvolutionIntensityChange(e.target.value as 'slow' | 'balanced' | 'fast')}
            fullWidth
          >
            {INTENSITY_OPTIONS.map((item) => (
              <MenuItem key={item.value} value={item.value}>{isZh ? item.zh : item.en}</MenuItem>
            ))}
          </TextField>
          <Box sx={{ px: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {isZh ? '当前议题 / 目标' : 'Current topic / goal'}
            </Typography>
            <Typography variant="body2">
              {props.topic.trim() || (isZh ? '还未填写，将围绕设定页中的话题或目标运行。' : 'Not set yet. Gameplay will run around the topic or goal from the main setup tab.')}
            </Typography>
          </Box>
          {selectedTemplate.defaults?.discussionRoundsTarget !== undefined ? (
            <TextField type="number" label={isZh ? '目标发言轮次' : 'Target discussion rounds'} value={props.discussionRoundsTarget} onChange={(e) => props.onDiscussionRoundsTargetChange(Math.max(1, Number(e.target.value) || 1))} fullWidth />
          ) : null}
          {selectedTemplate.defaults?.storyBranchMode !== undefined ? (
            <TextField select label={isZh ? '分支风格' : 'Branch mode'} value={props.storyBranchMode} onChange={(e) => props.onStoryBranchModeChange(e.target.value as 'guided' | 'open')} fullWidth>
              <MenuItem value="guided">{isZh ? '引导分支' : 'Guided'}</MenuItem>
              <MenuItem value="open">{isZh ? '开放推进' : 'Open'}</MenuItem>
            </TextField>
          ) : null}
          {selectedTemplate.defaults?.studyGoalLabel !== undefined ? (
            <TextField label={isZh ? '学习目标' : 'Study goal'} value={props.studyGoalLabel} onChange={(e) => props.onStudyGoalLabelChange(e.target.value)} fullWidth placeholder={isZh ? '例如：雅思口语 7.5' : 'e.g. IELTS speaking 7.5'} />
          ) : null}
          {selectedTemplate.defaults?.agentGoalLabel !== undefined ? (
            <TextField label={isZh ? '任务目标' : 'Agent goal'} value={props.agentGoalLabel} onChange={(e) => props.onAgentGoalLabelChange(e.target.value)} fullWidth placeholder={isZh ? '例如：整理一份产品竞品分析' : 'e.g. build a competitor analysis brief'} />
          ) : null}
          {selectedTemplate.defaults?.boardColumns !== undefined || selectedTemplate.defaults?.boardRows !== undefined ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField type="number" label={isZh ? '棋盘列数' : 'Board columns'} value={props.boardColumns} onChange={(e) => props.onBoardColumnsChange(Math.max(2, Number(e.target.value) || 2))} fullWidth />
              <TextField type="number" label={isZh ? '棋盘行数' : 'Board rows'} value={props.boardRows} onChange={(e) => props.onBoardRowsChange(Math.max(2, Number(e.target.value) || 2))} fullWidth />
            </Stack>
          ) : null}
          {selectedTemplate.defaults?.deductionFactionCount !== undefined ? (
            <TextField type="number" label={isZh ? '阵营数量' : 'Faction count'} value={props.deductionFactionCount} onChange={(e) => props.onDeductionFactionCountChange(Math.max(2, Number(e.target.value) || 2))} fullWidth />
          ) : null}
          {selectedTemplate.defaults?.mysteryClueCount !== undefined ? (
            <TextField type="number" label={isZh ? '线索数量' : 'Clue count'} value={props.mysteryClueCount} onChange={(e) => props.onMysteryClueCountChange(Math.max(1, Number(e.target.value) || 1))} fullWidth />
          ) : null}
        </Stack>
      </SurfaceCard>
    </Stack>
  );
}
