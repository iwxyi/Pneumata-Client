import type { MouseEvent } from 'react';
import { Avatar, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import { isImageAvatar } from '../../utils/avatar';

interface MemberSelectionDialogProps {
  open: boolean;
  customCharacters: AICharacter[];
  presetCharacters: AICharacter[];
  selectedMembers: string[];
  hasCustomCharacters: boolean;
  hasPresetCharacters: boolean;
  selectedMemberGridSx: Record<string, unknown>;
  memberOptionSx: (checked: boolean) => Record<string, unknown>;
  title: string;
  presetLabel: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  onToggleMember: (memberId: string) => void;
  onStartLongPress: (characterId: string) => void;
  onClearPressTimer: () => void;
  onContextMenu: (event: MouseEvent, characterId: string) => void;
}

function MemberOption({
  char,
  checked,
  presetLabel,
  sx,
  onToggle,
  onStartLongPress,
  onClearPressTimer,
  onContextMenu,
}: {
  char: AICharacter;
  checked: boolean;
  presetLabel?: string;
  sx: Record<string, unknown>;
  onToggle: () => void;
  onStartLongPress?: () => void;
  onClearPressTimer?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  return (
    <Box
      onClick={onToggle}
      onPointerDown={onStartLongPress}
      onPointerUp={onClearPressTimer}
      onPointerLeave={onClearPressTimer}
      onPointerCancel={onClearPressTimer}
      onContextMenu={onContextMenu}
      sx={sx}
    >
      <Checkbox checked={checked} size="small" onClick={(e) => { e.stopPropagation(); onToggle(); }} />
      <Avatar src={isImageAvatar(char.avatar) ? char.avatar : undefined} sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>
        {isImageAvatar(char.avatar) ? undefined : char.avatar}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{char.name}</Typography>
      </Box>
      {presetLabel ? <Chip label={presetLabel} size="small" variant="outlined" /> : null}
    </Box>
  );
}

export default function MemberSelectionDialog(props: MemberSelectionDialogProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="md" fullWidth>
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {props.hasCustomCharacters ? (
            <Box sx={props.selectedMemberGridSx}>
              {props.customCharacters.map((char) => (
                <MemberOption
                  key={char.id}
                  char={char}
                  checked={props.selectedMembers.includes(char.id)}
                  sx={props.memberOptionSx(props.selectedMembers.includes(char.id))}
                  onToggle={() => props.onToggleMember(char.id)}
                  onStartLongPress={() => props.onStartLongPress(char.id)}
                  onClearPressTimer={props.onClearPressTimer}
                  onContextMenu={(event) => props.onContextMenu(event, char.id)}
                />
              ))}
            </Box>
          ) : null}

          {props.hasCustomCharacters && props.hasPresetCharacters ? <Divider /> : null}

          {props.hasPresetCharacters ? (
            <Box sx={props.selectedMemberGridSx}>
              {props.presetCharacters.map((char) => (
                <MemberOption
                  key={char.id}
                  char={char}
                  checked={props.selectedMembers.includes(char.id)}
                  sx={props.memberOptionSx(props.selectedMembers.includes(char.id))}
                  onToggle={() => props.onToggleMember(char.id)}
                  presetLabel={props.presetLabel}
                />
              ))}
            </Box>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onConfirm}>{props.confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
