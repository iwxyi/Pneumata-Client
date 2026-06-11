import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import type { RoomTemplateCategory, RoomTemplateConfigGroup, RoomTemplateDefinition, RoomTemplateFieldDefinition, RoomTemplateKey, RoomTemplateStructure } from '../../services/roomTemplates';
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
  storyBackground: string;
  onStoryBackgroundChange: (value: string) => void;
  storyDirection: string;
  onStoryDirectionChange: (value: string) => void;
  storyOutline: string;
  onStoryOutlineChange: (value: string) => void;
  werewolfRoleConfig: string;
  onWerewolfRoleConfigChange: (value: string) => void;
  werewolfPostGameMode: string;
  onWerewolfPostGameModeChange: (value: string) => void;
  mysteryScript: string;
  onMysteryScriptChange: (value: string) => void;
  mysteryRoleMappingMode: string;
  onMysteryRoleMappingModeChange: (value: string) => void;
  allowPrivateThreads: boolean;
  onAllowPrivateThreadsChange: (value: boolean) => void;
  allowCliques: boolean;
  onAllowCliquesChange: (value: boolean) => void;
  allowMockery: boolean;
  onAllowMockeryChange: (value: boolean) => void;
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

function getFieldValue(field: RoomTemplateFieldDefinition, props: GameplaySectionProps) {
  switch (field.key) {
    case 'discussionRoundsTarget': return props.discussionRoundsTarget;
    case 'storyBranchMode': return props.storyBranchMode;
    case 'studyGoalLabel': return props.studyGoalLabel;
    case 'agentGoalLabel': return props.agentGoalLabel;
    case 'boardColumns': return props.boardColumns;
    case 'boardRows': return props.boardRows;
    case 'deductionFactionCount': return props.deductionFactionCount;
    case 'mysteryClueCount': return props.mysteryClueCount;
    case 'storyBackground': return props.storyBackground;
    case 'storyDirection': return props.storyDirection;
    case 'storyOutline': return props.storyOutline;
    case 'werewolfRoleConfig': return props.werewolfRoleConfig;
    case 'werewolfPostGameMode': return props.werewolfPostGameMode;
    case 'mysteryScript': return props.mysteryScript;
    case 'mysteryRoleMappingMode': return props.mysteryRoleMappingMode;
    case 'allowPrivateThreads': return props.allowPrivateThreads ? 'true' : 'false';
    case 'allowCliques': return props.allowCliques ? 'true' : 'false';
    case 'allowMockery': return props.allowMockery ? 'true' : 'false';
    default: return '';
  }
}

function setFieldValue(field: RoomTemplateFieldDefinition, value: string, props: GameplaySectionProps) {
  switch (field.key) {
    case 'discussionRoundsTarget': props.onDiscussionRoundsTargetChange(Math.max(1, Number(value) || 1)); break;
    case 'storyBranchMode': props.onStoryBranchModeChange(value as 'guided' | 'open'); break;
    case 'studyGoalLabel': props.onStudyGoalLabelChange(value); break;
    case 'agentGoalLabel': props.onAgentGoalLabelChange(value); break;
    case 'boardColumns': props.onBoardColumnsChange(Math.max(2, Number(value) || 2)); break;
    case 'boardRows': props.onBoardRowsChange(Math.max(2, Number(value) || 2)); break;
    case 'deductionFactionCount': props.onDeductionFactionCountChange(Math.max(2, Number(value) || 2)); break;
    case 'mysteryClueCount': props.onMysteryClueCountChange(Math.max(1, Number(value) || 1)); break;
    case 'storyBackground': props.onStoryBackgroundChange(value); break;
    case 'storyDirection': props.onStoryDirectionChange(value); break;
    case 'storyOutline': props.onStoryOutlineChange(value); break;
    case 'werewolfRoleConfig': props.onWerewolfRoleConfigChange(value); break;
    case 'werewolfPostGameMode': props.onWerewolfPostGameModeChange(value); break;
    case 'mysteryScript': props.onMysteryScriptChange(value); break;
    case 'mysteryRoleMappingMode': props.onMysteryRoleMappingModeChange(value); break;
    case 'allowPrivateThreads': props.onAllowPrivateThreadsChange(value === 'true'); break;
    case 'allowCliques': props.onAllowCliquesChange(value === 'true'); break;
    case 'allowMockery': props.onAllowMockeryChange(value === 'true'); break;
  }
}

function renderField(field: RoomTemplateFieldDefinition, props: GameplaySectionProps, isZh: boolean) {
  const value = getFieldValue(field, props);
  return (
    <TextField
      key={field.key}
      select={field.kind === 'single_select'}
      type={field.kind === 'number' ? 'number' : 'text'}
      multiline={field.kind === 'textarea'}
      minRows={field.kind === 'textarea' ? 3 : undefined}
      label={field.required ? `${field.label} *` : field.label}
      value={String(value ?? '')}
      onChange={(e) => setFieldValue(field, e.target.value, props)}
      fullWidth
      required={field.required}
      placeholder={field.placeholder}
    >
      {field.kind === 'single_select'
        ? (field.options || []).map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)
        : null}
    </TextField>
  );
}

function renderConfigGroup(group: RoomTemplateConfigGroup, props: GameplaySectionProps, isZh: boolean) {
  const requiredFields = group.fields.filter((field) => !field.advanced);
  const advancedFields = group.fields.filter((field) => field.advanced);
  return (
    <Box key={group.key} sx={{ border: 1, borderColor: 'divider', borderRadius: 3, p: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{group.label}</Typography>
      {group.description ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{group.description}</Typography> : null}
      <Stack spacing={1.25}>
        {requiredFields.map((field) => renderField(field, props, isZh))}
        {advancedFields.length ? (
          <Accordion disableGutters elevation={0} sx={{ borderRadius: 2, bgcolor: 'transparent', border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{isZh ? '高级设定（可选）' : 'Advanced settings (optional)'}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.25}>{advancedFields.map((field) => renderField(field, props, isZh))}</Stack>
            </AccordionDetails>
          </Accordion>
        ) : null}
      </Stack>
    </Box>
  );
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
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
              {isZh ? '玩法分类' : 'Gameplay category'}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {structures.map((item) => {
                const selected = item.value === selectedStructure;
                return (
                  <Chip
                    key={item.value}
                    clickable
                    label={item.label}
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() => handleStructureChange(item.value as RoomTemplateStructure)}
                  />
                );
              })}
            </Box>
          </Box>

          <Stack spacing={1.5}>
            {categories.map((item) => {
              const templates = listTemplatesByStructureAndCategory(selectedStructure, item.value as RoomTemplateCategory);
              return (
                <Box key={item.value} sx={{ border: 1, borderColor: 'divider', borderRadius: 3, p: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{item.label}</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 0.9, alignItems: 'start' }}>
                    {templates.map((template) => {
                      const selected = template.key === props.roomTemplate;
                      return (
                        <Button
                          key={template.key}
                          variant="text"
                          color={selected ? 'primary' : 'inherit'}
                          onClick={() => props.onRoomTemplateChange(template.key)}
                          sx={{
                            justifyContent: 'flex-start',
                            alignItems: 'stretch',
                            textTransform: 'none',
                            borderRadius: 3,
                            px: 1.35,
                            py: 1.1,
                            border: '1px solid',
                            borderColor: selected ? 'primary.main' : 'divider',
                            bgcolor: selected ? 'action.selected' : 'background.paper',
                            boxShadow: 'none',
                            transition: 'border-color 160ms ease, background-color 160ms ease',
                            '&:hover': {
                              bgcolor: selected ? 'action.selected' : 'action.hover',
                              borderColor: selected ? 'primary.main' : 'text.secondary',
                            },
                          }}
                        >
                          <Box sx={{ textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{template.label}</Typography>
                            <Typography variant="caption" color="text.secondary">{template.description}</Typography>
                          </Box>
                        </Button>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Stack>
      </SurfaceCard>

      <SurfaceCard>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
            {isZh ? '详细设定' : 'Detailed settings'}
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              select
              label={isZh ? '当前房间节奏' : 'Room intensity'}
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
                {isZh ? '当前议题 / 目标（来自“设定”页）' : 'Current topic / goal (from Config tab)'}
              </Typography>
              <Typography variant="body2">
                {props.topic.trim() || (isZh ? '请先到“设定”页填写群名下方的话题/目标。' : 'Fill the topic/goal field in the Config tab first.')}
              </Typography>
            </Box>
            {(selectedTemplate.configGroups || []).map((group) => renderConfigGroup(group, props, isZh))}
          </Stack>
        </Box>
      </SurfaceCard>
    </Stack>
  );
}
