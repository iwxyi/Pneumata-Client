import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { ChatStyle } from '../../types/chat';
import type { TopicAdaptationResult, TopicItem, TopicSourceSummary } from '../../services/api';

interface HotTopicDialogProps {
  open: boolean;
  cancelLabel: string;
  language: string;
  loadingText: string;
  sourceTab: number;
  sourceTabs: TopicSourceSummary[];
  currentSource: TopicSourceSummary | null;
  selectionConflictText: string;
  loading: boolean;
  topics: TopicItem[];
  emptyText: string;
  selectedTopic: TopicItem | null;
  adaptation: TopicAdaptationResult | null;
  suggestedMembers: AICharacter[];
  selectedSuggestedMemberIds: string[];
  selectedCharacterNames: string[];
  adapting: boolean;
  creatingCharacters: boolean;
  canCreateCharacters: boolean;
  canApply: boolean;
  createLabel: string;
  applyLabel: string;
  getStyleLabel: (styleValue: ChatStyle) => string;
  getHotCharacterCardState: (candidateName: string) => { alreadyExists: boolean; created: boolean };
  onClose: () => void;
  onSourceTabChange: (event: unknown, value: number) => void;
  onTopicSelect: (topic: TopicItem) => void;
  onToggleSuggestedMember: (characterId: string) => void;
  onToggleCharacter: (characterName: string) => void;
  onCreateCharacters: () => void;
  onApply: () => void;
}

export default function HotTopicDialog({
  open,
  cancelLabel,
  language,
  loadingText,
  sourceTab,
  sourceTabs,
  currentSource,
  selectionConflictText,
  loading,
  topics,
  emptyText,
  selectedTopic,
  adaptation,
  suggestedMembers,
  selectedSuggestedMemberIds,
  selectedCharacterNames,
  adapting,
  creatingCharacters,
  canCreateCharacters,
  canApply,
  createLabel,
  applyLabel,
  getStyleLabel,
  getHotCharacterCardState,
  onClose,
  onSourceTabChange,
  onTopicSelect,
  onToggleSuggestedMember,
  onToggleCharacter,
  onCreateCharacters,
  onApply,
}: HotTopicDialogProps) {
  const isZh = language.startsWith('zh');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box component="span" sx={{ font: 'inherit' }}>{isZh ? '热点灵感' : 'Topic inspiration'}</Box>
        <Box sx={{ minWidth: 120, display: 'flex', justifyContent: 'flex-end' }}>
          {loadingText ? <Typography variant="body2" color="text.secondary">{loadingText}</Typography> : null}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1, minHeight: 520 }}>
          <Tabs
            value={sourceTab}
            onChange={onSourceTabChange}
            variant="scrollable"
            scrollButtons={false}
            sx={{ '& .MuiTab-root': { minWidth: 0, px: { xs: 0.85, sm: 1.5 }, fontSize: { xs: '0.78rem', sm: '0.875rem' }, whiteSpace: 'nowrap' } }}
          >
            {sourceTabs.map((source) => <Tab key={source.id} label={source.label} />)}
          </Tabs>
          {currentSource?.status === 'unavailable' && currentSource?.note ? <Alert severity="error">{currentSource.note}</Alert> : null}
          {selectionConflictText ? <Alert severity="info">{selectionConflictText}</Alert> : null}
          {!loading && topics.length === 0 && currentSource?.status === 'unavailable' ? (
            <Typography variant="body2" color="text.secondary">{currentSource?.note || emptyText}</Typography>
          ) : null}
          {!loading ? (
            <Box sx={{ display: 'grid', gap: 1 }}>
              {topics.map((topicItem) => (
                <Box
                  key={topicItem.id}
                  onClick={() => onTopicSelect(topicItem)}
                  sx={{
                    p: 1.5,
                    border: 1,
                    borderRadius: 2,
                    borderColor: selectedTopic?.id === topicItem.id ? 'primary.main' : 'divider',
                    bgcolor: selectedTopic?.id === topicItem.id ? 'action.selected' : 'background.paper',
                    cursor: 'pointer',
                    '&:hover': { borderColor: 'primary.main', boxShadow: 1 },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>{topicItem.title}</Typography>
                      {(topicItem.subtitle || topicItem.heat) ? <Typography variant="caption" color="text.secondary">{[topicItem.subtitle, topicItem.heat].filter(Boolean).join(' · ')}</Typography> : null}
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          ) : null}
          {adaptation ? (
            <Stack spacing={1.5}>
              <Divider />
              {adaptation.suggestedName ? (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{isZh ? '推荐群聊名称' : 'Suggested chat name'}</Typography>
                  <Typography variant="body2">{adaptation.suggestedName}</Typography>
                </Box>
              ) : null}
              {adaptation.suggestedTopic ? (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{isZh ? '推荐话题' : 'Suggested topic'}</Typography>
                  <Typography variant="body2">{adaptation.suggestedTopic}</Typography>
                </Box>
              ) : null}
              {adaptation.suggestedStyle ? <Chip label={`${isZh ? '建议风格' : 'Suggested style'}：${getStyleLabel(adaptation.suggestedStyle)}`} size="small" color="primary" variant="outlined" /> : null}
              {suggestedMembers.length ? (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{isZh ? '推荐已有成员' : 'Suggested existing members'}</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1, mt: 0.75 }}>
                    {suggestedMembers.map((character) => {
                      const checked = selectedSuggestedMemberIds.includes(character.id);
                      return (
                        <Box key={character.id} onClick={() => onToggleSuggestedMember(character.id)} sx={{ p: 1, border: 1, borderColor: checked ? 'primary.main' : 'divider', borderRadius: 2, bgcolor: checked ? 'action.selected' : 'background.paper', cursor: 'pointer' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Checkbox checked={checked} onChange={() => onToggleSuggestedMember(character.id)} onClick={(event) => event.stopPropagation()} sx={{ p: 0.25 }} />
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{character.name}</Typography>
                              {character.group ? <Typography variant="caption" color="text.secondary">{character.group}</Typography> : null}
                            </Box>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              ) : null}
              {adaptation.recommendedCharacters?.length ? (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{isZh ? '推荐新角色' : 'Suggested new characters'}</Typography>
                  <Stack spacing={1} sx={{ mt: 0.75 }}>
                    {adaptation.recommendedCharacters.map((candidate) => {
                      const { alreadyExists, created } = getHotCharacterCardState(candidate.name);
                      const checked = selectedCharacterNames.includes(candidate.name) || created;
                      return (
                        <Box key={candidate.name} sx={{ p: 1.25, border: 1, borderColor: checked ? 'primary.main' : created ? 'success.main' : 'divider', borderRadius: 2, bgcolor: alreadyExists ? 'action.disabledBackground' : checked ? 'action.selected' : 'background.paper', position: 'relative' }}>
                          {created ? <Chip size="small" color="success" label={isZh ? '已创建' : 'Created'} sx={{ position: 'absolute', top: 8, right: 8 }} /> : null}
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <Checkbox checked={checked} disabled={alreadyExists || created || creatingCharacters} onChange={() => onToggleCharacter(candidate.name)} sx={{ mt: -0.5 }} />
                            <Box sx={{ flex: 1, minWidth: 0, pr: created ? 7 : 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{candidate.name}</Typography>
                              <Typography variant="caption" color="text.secondary">{candidate.description}</Typography>
                              {alreadyExists ? <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>{isZh ? '已存在同名角色' : 'Character already exists'}</Typography> : null}
                            </Box>
                          </Box>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose}>{cancelLabel}</Button>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={onCreateCharacters} disabled={adapting || creatingCharacters || !canCreateCharacters}>{createLabel}</Button>
          <Button variant="contained" onClick={onApply} disabled={adapting || !canApply}>{applyLabel}</Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
