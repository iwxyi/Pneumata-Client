import { useState } from 'react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import type { RoomTemplateConfigGroup, RoomTemplateDefinition, RoomTemplateFieldDefinition, RoomTemplateKey, RoomTemplateStructure } from '../../services/roomTemplates';
import {
  getRoomTemplateKernel,
  getRoomTemplatePresetDescription,
  getRoomTemplatePresetLabel,
  listRoomTemplateKernelsByStructure,
  listRoomTemplatePresets,
  listTemplateStructures,
} from '../../services/roomTemplates';

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
  lockGameplayKernelSelection?: boolean;
  lockPresetSelection?: boolean;
  onSaveAsChat?: () => void;
  saveAsChatDisabled?: boolean;
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

function pickFirstTemplateKey(structure: RoomTemplateStructure, fallback: RoomTemplateKey): RoomTemplateKey {
  return listRoomTemplateKernelsByStructure(structure)[0]?.key || fallback;
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

function renderConfigGroup(
  group: RoomTemplateConfigGroup,
  props: GameplaySectionProps,
  isZh: boolean,
  expandedAdvancedGroups: Record<string, boolean>,
  setAdvancedGroupExpanded: (groupKey: string, expanded: boolean) => void,
) {
  const requiredFields = group.fields.filter((field) => !field.advanced);
  const advancedFields = group.fields.filter((field) => field.advanced);
  return (
    <Box key={group.key} sx={{ border: 1, borderColor: 'divider', borderRadius: 3, p: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{group.label}</Typography>
      {group.description ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{group.description}</Typography> : null}
      <Stack spacing={1.25}>
        {requiredFields.map((field) => renderField(field, props, isZh))}
        {advancedFields.length ? (
          <Accordion
            disableGutters
            elevation={0}
            expanded={Boolean(expandedAdvancedGroups[group.key])}
            onChange={(_, expanded) => setAdvancedGroupExpanded(group.key, expanded)}
            sx={{ borderRadius: 2, bgcolor: 'transparent', border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}
          >
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
  const [expandedAdvancedGroups, setExpandedAdvancedGroups] = useState<Record<string, boolean>>({});
  const isZh = props.language.startsWith('zh');
  const selectedTemplate = props.roomTemplates.find((item) => item.key === props.roomTemplate) || props.roomTemplates[0];
  const selectedKernel = getRoomTemplateKernel(selectedTemplate);
  const selectedStructure = inferSelectedStructure(selectedKernel);
  const selectedFamily = selectedKernel.sessionKind.family;
  const structureLabel = STRUCTURE_LABELS[selectedStructure] || selectedStructure;
  const familyLabel = FAMILY_LABELS[selectedFamily] || selectedFamily;
  const structures = listTemplateStructures();
  const structureKernels = listRoomTemplateKernelsByStructure(selectedStructure);
  const selectedPresets = listRoomTemplatePresets(selectedKernel.key);
  const selectedPreset = selectedPresets.find((preset) => preset.key === props.roomTemplate) || selectedPresets[0];
  const presetMenuItems = selectedPresets.flatMap((preset, index) => {
    const items = [
      <MenuItem key={preset.key} value={preset.key}>
        {getRoomTemplatePresetLabel(preset)}
      </MenuItem>,
    ];
    if (index === 0 && selectedPresets.length > 1) {
      items.push(<Divider key={`${preset.key}-divider`} />);
    }
    return items;
  });

  const handleStructureChange = (structure: RoomTemplateStructure) => {
    if (props.lockGameplayKernelSelection) return;
    props.onRoomTemplateChange(pickFirstTemplateKey(structure, props.roomTemplate));
  };
  const setAdvancedGroupExpanded = (groupKey: string, expanded: boolean) => {
    setExpandedAdvancedGroups((prev) => ({ ...prev, [groupKey]: expanded }));
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {structures.map((item) => {
          const selected = item.value === selectedStructure;
          return (
            <Chip
              key={item.value}
              clickable={!props.lockGameplayKernelSelection}
              label={item.label}
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              onClick={props.lockGameplayKernelSelection ? undefined : () => handleStructureChange(item.value as RoomTemplateStructure)}
              sx={{
                height: 34,
                borderRadius: 999,
                fontWeight: selected ? 700 : 500,
                '& .MuiChip-label': { px: 1.25 },
              }}
            />
          );
        })}
      </Box>

      <SurfaceCard>
        <Stack spacing={2}>
          {props.lockGameplayKernelSelection ? (
            <Box sx={{ border: 1, borderColor: 'primary.light', borderRadius: 2, p: 1.25, bgcolor: 'action.selected' }}>
              <Typography variant="body2" color="text.secondary">
                {props.lockPresetSelection
                  ? (isZh ? '此房间已开始运行，不能切换玩法内核或预设。' : 'This room has runtime data, so gameplay core and preset cannot be switched.')
                  : (isZh ? '编辑已有房间时不能切换玩法内核。' : 'Existing rooms cannot switch gameplay core.')}
                {props.onSaveAsChat ? (
                  <Button
                    variant="text"
                    color="primary"
                    onClick={props.onSaveAsChat}
                    disabled={props.saveAsChatDisabled}
                    sx={{ ml: 0.5, minWidth: 0, px: 0.5, verticalAlign: 'baseline', fontWeight: 700 }}
                  >
                    {isZh ? '另存为群聊' : 'Save as chat'}
                  </Button>
                ) : null}
                {props.onSaveAsChat ? (isZh ? '后可修改玩法。' : 'to change gameplay.') : null}
              </Typography>
            </Box>
          ) : null}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{isZh ? '玩法类型' : 'Gameplay type'}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 0.9, alignItems: 'start' }}>
              {structureKernels.map((template) => {
                const selected = template.key === selectedKernel.key;
                return (
                  <Button
                    key={template.key}
                    variant="text"
                    color={selected ? 'primary' : 'inherit'}
                    disabled={props.lockGameplayKernelSelection}
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
                      '&.Mui-disabled': {
                        color: 'text.primary',
                        opacity: selected ? 1 : 0.48,
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

          {selectedPresets.length > 1 ? (
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.25, bgcolor: 'action.hover' }}>
              <TextField
                select
                label={isZh ? '预设模板' : 'Preset'}
                value={props.roomTemplate}
                onChange={(event) => props.onRoomTemplateChange(event.target.value as RoomTemplateKey)}
                disabled={props.lockPresetSelection}
                fullWidth
              >
                {presetMenuItems}
              </TextField>
              <Box sx={{ mt: 1, px: 0.25 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {getRoomTemplatePresetLabel(selectedPreset)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
                  {getRoomTemplatePresetDescription(selectedPreset)}
                </Typography>
                {props.lockPresetSelection ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {isZh ? '已有运行数据后只能修改下方参数，不能切换预设。' : 'Rooms with runtime data can edit settings below, but cannot switch presets.'}
                  </Typography>
                ) : null}
                {selectedPreset.sellingPoints?.length ? (
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.75 }}>
                    {selectedPreset.sellingPoints.slice(0, 3).map((point) => (
                      <Chip
                        key={point}
                        size="small"
                        label={point}
                        variant="outlined"
                        sx={{
                          height: 20,
                          maxWidth: '100%',
                          '& .MuiChip-label': {
                            px: 0.75,
                            fontSize: 11,
                            maxWidth: 140,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          },
                        }}
                      />
                    ))}
                  </Stack>
                ) : null}
              </Box>
            </Box>
          ) : null}
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
                {selectedTemplate.sessionKind.scenarioId === 'story-reader'
                  ? (isZh ? '开场提示（来自“设定”页）' : 'Opening prompt (from Config tab)')
                  : (isZh ? '当前议题 / 目标（来自“设定”页）' : 'Current topic / goal (from Config tab)')}
              </Typography>
              <Typography variant="body2">
                {props.topic.trim() || (selectedTemplate.sessionKind.scenarioId === 'story-reader'
                  ? (isZh ? '可在“设定”页填写一句开局灵感；完整故事设定在这里编辑。' : 'Add a short opening seed in Config; edit full story settings here.')
                  : (isZh ? '请先到“设定”页填写群名下方的话题/目标。' : 'Fill the topic/goal field in the Config tab first.'))}
              </Typography>
            </Box>
            {(selectedTemplate.configGroups || []).map((group) => renderConfigGroup(
              group,
              props,
              isZh,
              expandedAdvancedGroups,
              setAdvancedGroupExpanded,
            ))}
          </Stack>
        </Box>
      </SurfaceCard>
    </Stack>
  );
}
