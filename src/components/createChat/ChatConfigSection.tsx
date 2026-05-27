import AddIcon from '@mui/icons-material/Add';
import HotIcon from '@mui/icons-material/LocalFireDepartment';
import {
  Avatar,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { CHAT_STYLE_OPTIONS, MAX_MEMBERS } from '../../constants/defaults';
import type { AICharacter } from '../../types/character';
import type { ChatStyle } from '../../types/chat';
import { isImageAvatar } from '../../utils/avatar';
import SurfaceCard from '../common/SurfaceCard';

interface ChatConfigSectionProps {
  lockMembers?: boolean;
  showMembers?: boolean;
  maxMembers?: number;
  name: string;
  topic: string;
  style: ChatStyle;
  showRoleActions: boolean;
  selectedMembers: string[];
  selectedCharacters: AICharacter[];
  language: string;
  memberSummaryEmptyLabel: string;
  topicPlaceholder: string;
  getStyleLabel: (styleValue: ChatStyle) => string;
  onNameChange: (value: string) => void;
  onTopicChange: (value: string) => void;
  onStyleChange: (value: ChatStyle) => void;
  onShowRoleActionsChange: (value: boolean) => void;
  onOpenMemberDialog: () => void;
  onOpenHotDialog: () => void;
  onToggleMember: (memberId: string) => void;
  nameLabel: string;
  namePlaceholder: string;
  topicLabel: string;
  selectMembersLabel: string;
  membersHintLabel: string;
  styleLabel: string;
  showRoleActionsLabel: string;
  openTopicInspirationLabel: string;
}

export default function ChatConfigSection(props: ChatConfigSectionProps) {
  return (
    <Stack spacing={2}>
      <SurfaceCard>
          {props.showMembers === false ? null : (
            <TextField
              label={props.nameLabel}
              placeholder={props.namePlaceholder}
              value={props.name}
              onChange={(e) => props.onNameChange(e.target.value)}
              required
              fullWidth
              sx={{ mb: 2 }}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        color="primary"
                        onClick={props.onOpenHotDialog}
                        edge="end"
                        aria-label={props.openTopicInspirationLabel}
                      >
                        <HotIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
          <TextField
            label={props.topicLabel}
            placeholder={props.topicPlaceholder}
            value={props.topic}
            onChange={(e) => props.onTopicChange(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
      </SurfaceCard>

      <SurfaceCard>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {props.selectMembersLabel}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {props.membersHintLabel} ({props.selectedMembers.length}/{props.maxMembers || MAX_MEMBERS})
              </Typography>
            </Box>
            {props.lockMembers ? null : <IconButton color="primary" onClick={props.onOpenMemberDialog}>
              <AddIcon />
            </IconButton>}
          </Box>
          {props.selectedCharacters.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {props.selectedCharacters.map((char) => (
                <Chip
                  key={char.id}
                  avatar={
                    <Avatar src={isImageAvatar(char.avatar) ? char.avatar : undefined} sx={{ bgcolor: 'primary.light' }}>
                      {isImageAvatar(char.avatar) ? undefined : char.avatar}
                    </Avatar>
                  }
                  label={char.name}
                  onDelete={props.lockMembers ? undefined : () => props.onToggleMember(char.id)}
                />
              ))}
            </Box>
          ) : (
            <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, color: 'text.secondary' }}>
              {props.memberSummaryEmptyLabel}
            </Box>
          )}
      </SurfaceCard>

      <SurfaceCard>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {props.styleLabel}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {CHAT_STYLE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={props.style === opt.value ? 'contained' : 'outlined'}
                onClick={() => props.onStyleChange(opt.value)}
                sx={{ borderRadius: 999 }}
              >
                {props.getStyleLabel(opt.value)}
              </Button>
            ))}
          </Box>
      </SurfaceCard>

      <SurfaceCard contentSx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <FormControlLabel
            control={<Switch checked={props.showRoleActions} onChange={(e) => props.onShowRoleActionsChange(e.target.checked)} />}
            label={props.showRoleActionsLabel}
          />
      </SurfaceCard>
    </Stack>
  );
}
