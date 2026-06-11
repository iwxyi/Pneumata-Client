import { Box, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import SurfaceCard from '../common/SurfaceCard';

interface ManagementSectionProps {
  selectedCharacters: AICharacter[];
  ownerCharacterId: string;
  adminCharacterIds: string[];
  noOwnerLabel: string;
  adminNotesValue: string;
  autoModeration: boolean;
  allowMute: boolean;
  allowPrivateThreads: boolean;
  allowCliques: boolean;
  allowMockery: boolean;
  editingChat: boolean;
  conversationKind: 'group' | 'direct' | 'ai_direct';
  conversationNoun: string;
  language: string;
  clearMessagesLabel: string;
  clearMemoryLabel: string;
  onOwnerChange: (value: string) => void;
  onAdminChange: (value: string[]) => void;
  onAutoModerationChange: (value: boolean) => void;
  onAllowMuteChange: (value: boolean) => void;
  onAllowPrivateThreadsChange: (value: boolean) => void;
  onAllowCliquesChange: (value: boolean) => void;
  onAllowMockeryChange: (value: boolean) => void;
  onOpenClearMessagesDialog: () => void;
  onOpenClearMemoryDialog: () => void;
}

export default function ManagementSection(props: ManagementSectionProps) {
  const isZh = props.language.startsWith('zh');
  const isGroup = props.conversationKind === 'group';
  const ownerLabel = isGroup ? (isZh ? '群主' : 'Owner') : (isZh ? '主角色' : 'Primary role');
  const adminLabel = isGroup ? (isZh ? '管理员' : 'Admins') : (isZh ? '协同角色' : 'Supporting roles');

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <SurfaceCard>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {isZh ? '管理设置' : 'Management'}
            </Typography>
          </Box>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField
              select
              label={ownerLabel}
              value={props.ownerCharacterId}
              onChange={(e) => props.onOwnerChange(e.target.value)}
              fullWidth
            >
              <MenuItem value="">{props.noOwnerLabel}</MenuItem>
              {props.selectedCharacters.map((char) => (
                <MenuItem key={char.id} value={char.id}>{char.name}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              slotProps={{ select: { multiple: true } }}
              label={adminLabel}
              value={props.adminCharacterIds}
              onChange={(e) => props.onAdminChange((typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value).filter(Boolean))}
              fullWidth
            >
              {props.selectedCharacters.map((char) => (
                <MenuItem key={char.id} value={char.id}>{char.name}</MenuItem>
              ))}
            </TextField>

            <TextField
              label={isZh ? `${adminLabel}说明` : `${adminLabel} notes`}
              value={props.adminNotesValue}
              slotProps={{ input: { readOnly: true } }}
              fullWidth
            />

            <Typography variant="caption" color="text.secondary">
              {isGroup
                ? (isZh ? '可多选管理员；群主不会重复加入管理员。' : 'You can select multiple admins; the owner is excluded automatically.')
                : (isZh ? `${props.conversationNoun}也使用同一套角色、关系、情绪和会话记忆；这些设置只影响权限和入口显示。` : `This ${props.conversationNoun} uses the same role, relationship, emotion, and session-memory runtime. These settings only affect permissions and display.`)}
            </Typography>

            <Box sx={{ display: 'grid', gap: 0.5 }}>
              <FormControlLabel control={<Switch checked={props.autoModeration} onChange={(e) => props.onAutoModerationChange(e.target.checked)} />} label={isZh ? '自动管理' : 'Auto moderation'} />
              <FormControlLabel control={<Switch checked={props.allowMute} onChange={(e) => props.onAllowMuteChange(e.target.checked)} />} label={isZh ? '允许禁言' : 'Allow mute'} />
              {isGroup ? <FormControlLabel control={<Switch checked={props.allowPrivateThreads} onChange={(e) => props.onAllowPrivateThreadsChange(e.target.checked)} />} label={isZh ? '允许角色私聊' : 'Allow character private chats'} /> : null}
            </Box>
          </Box>
      </SurfaceCard>

      <SurfaceCard>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {isZh ? '戏剧规则' : 'Drama'}
          </Typography>
          <Box sx={{ display: 'grid', gap: 1 }}>
            <FormControlLabel control={<Switch checked={props.allowCliques} onChange={(e) => props.onAllowCliquesChange(e.target.checked)} />} label={isZh ? '允许小团体' : 'Allow cliques'} />
            <FormControlLabel control={<Switch checked={props.allowMockery} onChange={(e) => props.onAllowMockeryChange(e.target.checked)} />} label={isZh ? '允许公开嘲讽' : 'Allow mockery'} />
          </Box>
      </SurfaceCard>

      {props.editingChat ? (
        <SurfaceCard sx={{ borderColor: 'error.light', bgcolor: 'rgba(211, 47, 47, 0.04)' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: 'error.main' }}>
              {isZh ? '危险操作' : 'Danger zone'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {isZh ? `可分别清理消息记录或会话级记忆，不删除${props.conversationNoun}本身。` : `You can clear messages or session memory separately without deleting the ${props.conversationNoun} itself.`}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button color="error" variant="outlined" onClick={props.onOpenClearMessagesDialog}>
                {props.clearMessagesLabel}
              </Button>
              <Button color="error" variant="outlined" onClick={props.onOpenClearMemoryDialog}>
                {props.clearMemoryLabel}
              </Button>
            </Stack>
        </SurfaceCard>
      ) : null}
    </Box>
  );
}
