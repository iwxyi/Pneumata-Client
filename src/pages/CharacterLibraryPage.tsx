import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { Box, Button, Tabs, Tab, Snackbar, Alert, IconButton, Menu, MenuItem, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography, Divider } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreIcon from '@mui/icons-material/MoreVert';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SortIcon from '@mui/icons-material/Sort';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import CharacterCard from '../components/character/CharacterCard';
import ConfirmDialog from '../components/common/ConfirmDialog';
import EmptyState from '../components/common/EmptyState';
import { canDeleteCharacterGroup, getCharacterGroupList, getCharactersInGroup, isPresetCharacterSelectable, normalizeCharacterGroup, getDuplicateCharacterBannerText, getDuplicateCharacterCount } from '../types/character';
import { enqueueAvatarGenerationForCharacters } from '../services/avatarGeneration';
import { generateCharacterProfile } from '../services/characterGenerator';
import { createCharacterBubbleStyleId } from '../utils/bubbleStyle';
import { getPreferredAIProfile } from '../types/settings';
import { useChatStore } from '../stores/useChatStore';
import { buildDirectChatDraft } from '../services/chatDraftBuilder';
import type { AICharacter } from '../types/character';

type CharacterSortField = 'name' | 'createdAt';
type CharacterSortDirection = 'asc' | 'desc';

function compareCharacterByField(a: AICharacter, b: AICharacter, field: CharacterSortField) {
  if (field === 'createdAt') {
    return (a.createdAt || 0) - (b.createdAt || 0);
  }
  return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

function getSortableGroupName(character: AICharacter) {
  return normalizeCharacterGroup(character.group) || '\uffff';
}

function sortCharactersForLibrary(
  characters: AICharacter[],
  field: CharacterSortField,
  direction: CharacterSortDirection,
  groupFirst: boolean,
) {
  const directionMultiplier = direction === 'asc' ? 1 : -1;
  return [...characters].sort((a, b) => {
    if (groupFirst) {
      const groupDiff = getSortableGroupName(a).localeCompare(getSortableGroupName(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      if (groupDiff !== 0) return groupDiff;
    }
    const fieldDiff = compareCharacterByField(a, b, field);
    if (fieldDiff !== 0) return fieldDiff * directionMultiplier;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

export default function CharacterLibraryPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const settings = useSettingsStore();
  const { chats, addChat } = useChatStore();
  const { characters, loadCharacters, deleteCharacter, deleteCharacters, updateCharactersGroup, importCharacters, initializePresets } = useCharacterStore();
  const [tab, setTab] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkGroupDialogOpen, setBulkGroupDialogOpen] = useState(false);
  const [bulkGroupValue, setBulkGroupValue] = useState('');
  const [groupActionTarget, setGroupActionTarget] = useState<string | null>(null);
  const [groupActionDialogOpen, setGroupActionDialogOpen] = useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [sortMenuAnchorEl, setSortMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [sortField, setSortField] = useState<CharacterSortField>('name');
  const [sortDirection, setSortDirection] = useState<CharacterSortDirection>('asc');
  const [sortGroupFirst, setSortGroupFirst] = useState(false);
  const [selectionMenuAnchorEl, setSelectionMenuAnchorEl] = useState<null | HTMLElement>(null);
  const groupPressTimerRef = useRef<number | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    void loadCharacters()
      .then(() => initializePresets());
  }, [initializePresets, loadCharacters]);


  const presets = characters.filter((c) => c.isPreset);
  const custom = characters.filter((c) => !c.isPreset);
  const customGroups = useMemo(() => getCharacterGroupList(custom), [custom]);
  const duplicateCharacterCount = useMemo(() => getDuplicateCharacterCount(custom), [custom]);
  const duplicateCharacterBannerText = useMemo(() => getDuplicateCharacterBannerText(custom, i18n.language), [custom, i18n.language]);
  const filteredCustom = selectedGroup === 'all' ? custom : getCharactersInGroup(custom, selectedGroup);
  const displayChars = useMemo(
    () => sortCharactersForLibrary(tab === 0 ? filteredCustom : presets, sortField, sortDirection, sortGroupFirst),
    [filteredCustom, presets, sortDirection, sortField, sortGroupFirst, tab]
  );
  const selectedIdSet = new Set(selectedIds);
  const selectedCustomCharacters = custom.filter((character) => selectedIdSet.has(character.id));

  const resetSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const enterSelectionMode = (id: string) => {
    setSelectionMode(true);
    setSelectedIds((prev) => prev.includes(id) ? prev : [...prev, id]);
  };

  const handleGroupAction = async (mode: 'clear' | 'delete') => {
    const normalizedTarget = normalizeCharacterGroup(groupActionTarget);
    if (!normalizedTarget) return;
    const targetCharacters = custom.filter((character) => normalizeCharacterGroup(character.group) === normalizedTarget);
    const ids = targetCharacters.map((character) => character.id);
    if (!ids.length) return;
    if (mode === 'clear') {
      await updateCharactersGroup(ids, null);
    } else {
      await deleteCharacters(ids);
    }
    setGroupActionDialogOpen(false);
    setGroupActionTarget(null);
    if (selectedGroup === normalizedTarget) setSelectedGroup('all');
    resetSelection();
  };

  const applyBulkGroup = async () => {
    await updateCharactersGroup(selectedIds, normalizeCharacterGroup(bulkGroupValue));
    setBulkGroupDialogOpen(false);
    setBulkGroupValue('');
    resetSelection();
  };

  const applyBulkDelete = async () => {
    await deleteCharacters(selectedIds);
    setBulkDeleteOpen(false);
    resetSelection();
  };

  const handleBulkGenerateAvatars = () => {
    try {
      const queued = enqueueAvatarGenerationForCharacters(
        selectedCustomCharacters,
        settings.aiProfiles,
        i18n.language.startsWith('zh') ? 'zh' : 'en',
        settings.avatarGeneration,
      );
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh')
          ? `已为 ${queued.length} 个角色加入头像生成队列`
          : `Queued avatar generation for ${queued.length} characters`,
        severity: queued.length > 0 ? 'success' : 'error',
      });
    } catch (error) {
      setSnackbar({
        open: true,
        message: error instanceof Error ? error.message : (i18n.language.startsWith('zh') ? '头像生成入队失败' : 'Failed to queue avatar generation'),
        severity: 'error',
      });
    }
  };

  const handleBulkGenerateBubbles = async () => {
    const profile = getPreferredAIProfile(settings.aiProfiles, 'text');
    if (!profile?.apiKey || !profile?.model) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请先配置AI模型' : 'Configure AI model first', severity: 'error' });
      return;
    }

    let successCount = 0;
    for (const character of selectedCustomCharacters) {
      try {
        const generated = await generateCharacterProfile(profile, character.name, i18n.language.startsWith('zh') ? 'zh' : 'en', character.group || null);
        await useCharacterStore.getState().updateCharacter(character.id, {
          bubbleStyle: { ...generated.bubbleStyle, id: createCharacterBubbleStyleId() },
        });
        successCount += 1;
      } catch (error) {
        setSnackbar({
          open: true,
          message: error instanceof Error ? error.message : (i18n.language.startsWith('zh') ? '批量生成气泡失败' : 'Failed to generate bubbles'),
          severity: 'error',
        });
        return;
      }
    }

    setSnackbar({
      open: true,
      message: i18n.language.startsWith('zh') ? `已为 ${successCount} 个角色生成气泡` : `Generated bubbles for ${successCount} characters`,
      severity: successCount > 0 ? 'success' : 'error',
    });
  };

  const handleSelectionMoreMenu = (event: MouseEvent<HTMLElement>) => {
    setSelectionMenuAnchorEl(event.currentTarget);
  };

  const closeSelectionMoreMenu = () => {
    setSelectionMenuAnchorEl(null);
  };

  const handleStartDirectChat = async (characterId: string, characterName: string) => {
    const existing = chats.find((chat) => chat.type === 'direct' && chat.memberIds.length === 1 && chat.memberIds[0] === characterId);
    if (existing) {
      navigate(`/chats/${existing.id}?fromTab=1`);
      return;
    }
    const chat = await addChat(buildDirectChatDraft(characterId, characterName));
    navigate(`/chats/${chat.id}?fromTab=1`);
  };

  const clearGroupPressTimer = () => {
    if (groupPressTimerRef.current !== null) {
      window.clearTimeout(groupPressTimerRef.current);
      groupPressTimerRef.current = null;
    }
  };

  const startGroupLongPress = (group: string) => {
    clearGroupPressTimer();
    groupPressTimerRef.current = window.setTimeout(() => {
      setGroupActionTarget(group);
      setGroupActionDialogOpen(true);
      clearGroupPressTimer();
    }, 450);
  };

  const handleBulkDeleteConfirm = async () => {
    try {
      await applyBulkDelete();
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已删除' : 'Deleted', severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    }
  };

  const handleSingleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await deleteCharacter(deleteId);
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已删除' : 'Deleted', severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setDeleteId(null);
    }
  };

  useEffect(() => {
    setHideMobileBottomNav(false);
    setHeaderBackAction(null);
    setHeaderTitle(null);
    setHeaderActions(null);

    return () => {
      setHeaderActions(null);
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
    };
  }, [setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav]);

  const desktopListMenu = null;
  void desktopListMenu;

  const mobileListHeader = null;
  void mobileListHeader;

  const renderListMenu = (
    <>
      <IconButton onClick={(e) => setMenuAnchorEl(e.currentTarget)}>
        <MoreIcon />
      </IconButton>
      <Menu anchorEl={menuAnchorEl} open={Boolean(menuAnchorEl)} onClose={() => setMenuAnchorEl(null)}>
        <MenuItem onClick={() => {
          setMenuAnchorEl(null);
          navigate('/characters/batch-generate');
        }}>
          批量生成角色
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchorEl(null);
          handleImport();
        }}>
          {t('character.import')}
        </MenuItem>
        <MenuItem onClick={() => {
          setMenuAnchorEl(null);
          handleExport();
        }} disabled={custom.length === 0}>
          {t('character.exportAll')}
        </MenuItem>
      </Menu>
    </>
  );

  const sortFieldLabel = sortField === 'name'
    ? (i18n.language.startsWith('zh') ? '名称' : 'Name')
    : (i18n.language.startsWith('zh') ? '创建时间' : 'Created time');
  const sortDirectionLabel = sortDirection === 'asc'
    ? (i18n.language.startsWith('zh') ? '正序' : 'Ascending')
    : (i18n.language.startsWith('zh') ? '逆序' : 'Descending');
  const renderSortMenu = (
    <>
      <IconButton onClick={(event) => setSortMenuAnchorEl(event.currentTarget)} aria-label={i18n.language.startsWith('zh') ? '排序' : 'Sort'}>
        <SortIcon />
      </IconButton>
      <Menu anchorEl={sortMenuAnchorEl} open={Boolean(sortMenuAnchorEl)} onClose={() => setSortMenuAnchorEl(null)}>
        <MenuItem selected={sortField === 'name'} onClick={() => { setSortField('name'); setSortMenuAnchorEl(null); }}>
          {sortField === 'name' ? '✓ ' : ''}{i18n.language.startsWith('zh') ? '名称' : 'Name'}
        </MenuItem>
        <MenuItem selected={sortField === 'createdAt'} onClick={() => { setSortField('createdAt'); setSortMenuAnchorEl(null); }}>
          {sortField === 'createdAt' ? '✓ ' : ''}{i18n.language.startsWith('zh') ? '创建时间' : 'Created time'}
        </MenuItem>
        <Divider />
        <MenuItem selected={sortDirection === 'asc'} onClick={() => { setSortDirection('asc'); setSortMenuAnchorEl(null); }}>
          {sortDirection === 'asc' ? '✓ ' : ''}{i18n.language.startsWith('zh') ? '正序' : 'Ascending'}
        </MenuItem>
        <MenuItem selected={sortDirection === 'desc'} onClick={() => { setSortDirection('desc'); setSortMenuAnchorEl(null); }}>
          {sortDirection === 'desc' ? '✓ ' : ''}{i18n.language.startsWith('zh') ? '逆序' : 'Descending'}
        </MenuItem>
        <Divider />
        <MenuItem selected={sortGroupFirst} onClick={() => { setSortGroupFirst((value) => !value); setSortMenuAnchorEl(null); }}>
          {sortGroupFirst ? '✓ ' : ''}{i18n.language.startsWith('zh') ? '分组优先' : 'Group first'}
        </MenuItem>
      </Menu>
    </>
  );

  const showInlineMenu = true;

  const openCreateForm = () => {
    navigate('/characters/create');
  };

  const handleExport = () => {
    const data = JSON.stringify(custom, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mirageTea-characters.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const chars = Array.isArray(data) ? data : [data];
        await importCharacters(chars);
        setSnackbar({ open: true, message: t('character.importSuccess'), severity: 'success' });
      } catch (error) {
        setSnackbar({ open: true, message: error instanceof Error ? error.message : t('character.importError'), severity: 'error' });
      }
    };
    input.click();
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
          <Tabs value={tab} onChange={(_, v) => { setTab(v); resetSelection(); }} sx={{ minWidth: 0, flex: 1 }}>
            <Tab label={`${t('character.myCharacters')} (${custom.length})`} />
            <Tab label={`${t('character.presets')} (${presets.length})`} />
          </Tabs>
          {showInlineMenu ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <Chip size="small" label={`${sortFieldLabel} · ${sortDirectionLabel}${sortGroupFirst ? ` · ${i18n.language.startsWith('zh') ? '分组优先' : 'Group first'}` : ''}`} sx={{ display: { xs: 'none', sm: 'inline-flex' } }} />
              {renderSortMenu}
              {renderListMenu}
            </Box>
          ) : null}
        </Box>
        {tab === 0 && duplicateCharacterCount > 0 ? <Alert severity="warning" sx={{ mb: 2 }}>{duplicateCharacterBannerText}</Alert> : null}
      {tab === 0 ? (
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1.5, mb: 1.5 }}>
          <Chip label={`${i18n.language.startsWith('zh') ? '全部' : 'All'} (${custom.length})`} color={selectedGroup === 'all' ? 'primary' : 'default'} variant={selectedGroup === 'all' ? 'filled' : 'outlined'} onClick={() => setSelectedGroup('all')} />
          {customGroups.map((group) => (
            <Chip
              key={group}
              label={`${group} (${custom.filter((character) => normalizeCharacterGroup(character.group) === group).length})`}
              color={selectedGroup === group ? 'primary' : 'default'}
              variant={selectedGroup === group ? 'filled' : 'outlined'}
              onClick={() => setSelectedGroup(group)}
              onPointerDown={() => {
                if (canDeleteCharacterGroup(group)) {
                  startGroupLongPress(group);
                }
              }}
              onPointerUp={clearGroupPressTimer}
              onPointerLeave={clearGroupPressTimer}
              onPointerCancel={clearGroupPressTimer}
            />
          ))}
        </Box>
      ) : null}
      {selectionMode && tab === 0 ? (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" color="text.secondary">{selectedIds.length} {i18n.language.startsWith('zh') ? '已选择' : 'selected'}</Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" startIcon={<ClearAllIcon />} onClick={resetSelection}>{i18n.language.startsWith('zh') ? '取消选择' : 'Cancel'}</Button>
            <Button size="small" color="error" variant="outlined" startIcon={<DeleteSweepIcon />} onClick={() => setBulkDeleteOpen(true)} disabled={selectedIds.length === 0}>{i18n.language.startsWith('zh') ? '批量删除' : 'Delete selected'}</Button>
            <IconButton size="small" onClick={handleSelectionMoreMenu} disabled={selectedIds.length === 0}>
              <MoreIcon fontSize="small" />
            </IconButton>
          </Box>
          <Menu anchorEl={selectionMenuAnchorEl} open={Boolean(selectionMenuAnchorEl) && selectionMode} onClose={closeSelectionMoreMenu}>
            <MenuItem onClick={() => {
              closeSelectionMoreMenu();
              handleBulkGenerateAvatars();
            }}>
              {i18n.language.startsWith('zh') ? '批量生成头像' : 'Generate avatars'}
            </MenuItem>
            <MenuItem onClick={async () => {
              closeSelectionMoreMenu();
              await handleBulkGenerateBubbles();
            }}>
              {i18n.language.startsWith('zh') ? '批量生成气泡' : 'Generate bubbles'}
            </MenuItem>
            <MenuItem onClick={() => {
              closeSelectionMoreMenu();
              setBulkGroupDialogOpen(true);
            }}>
              {i18n.language.startsWith('zh') ? '更改分组' : 'Change group'}
            </MenuItem>
          </Menu>
        </Box>
      ) : null}

      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5, pb: { xs: 15, sm: 12 } }}>
      {displayChars.length === 0 ? (
        <EmptyState
          icon="🎭"
          message={tab === 0 ? t('character.empty') : t('common.noData')}
          action={
            tab === 0 ? (
              <Button variant="outlined" onClick={openCreateForm}>
                {t('character.create')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(3, minmax(0, 1fr))',
            },
            gap: 1.5,
            alignItems: 'stretch',
          }}
        >
          {displayChars.map((char) => {
            const selectable = tab === 0 && isPresetCharacterSelectable(char);
            return (
              <CharacterCard
                key={char.id}
                character={char}
                selected={selectedIdSet.has(char.id)}
                selectable={selectable}
                selectionMode={selectionMode}
                onLongPress={selectable ? () => enterSelectionMode(char.id) : undefined}
                onEdit={tab === 0 ? () => navigate(`/characters/${char.id}/edit`) : undefined}
                onDelete={tab === 0 && selectable ? () => setDeleteId(char.id) : undefined}
                onStartDirectChat={tab === 0 && !selectionMode ? () => void handleStartDirectChat(char.id, char.name) : undefined}
                onClick={() => {
                  if (selectionMode && selectable) {
                    toggleSelection(char.id);
                    return;
                  }
                  navigate(`/characters/${char.id}/edit`);
                }}
              />
            );
          })}
        </Box>
      )}

      </Box>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title={t('character.delete')}
        message={t('character.deleteConfirm')}
        onConfirm={handleSingleDeleteConfirm}
        onCancel={() => setDeleteId(null)}
        destructive
      />

      <Dialog open={bulkGroupDialogOpen} onClose={() => setBulkGroupDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{i18n.language.startsWith('zh') ? '更改分组' : 'Change group'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
            <TextField label={i18n.language.startsWith('zh') ? '分组名' : 'Group'} value={bulkGroupValue} onChange={(e) => setBulkGroupValue(e.target.value)} fullWidth />
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {customGroups.map((group) => <Chip key={group} label={group} size="small" variant={normalizeCharacterGroup(bulkGroupValue) === group ? 'filled' : 'outlined'} color={normalizeCharacterGroup(bulkGroupValue) === group ? 'primary' : 'default'} onClick={() => setBulkGroupValue(group)} />)}
              <Chip label={i18n.language.startsWith('zh') ? '清空分组' : 'Clear group'} size="small" variant="outlined" onClick={() => setBulkGroupValue('')} />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkGroupDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={applyBulkGroup} variant="contained">{t('common.confirm')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={groupActionDialogOpen} onClose={() => setGroupActionDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{groupActionTarget}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{i18n.language.startsWith('zh') ? '请选择如何处理这个分组。' : 'Choose how to handle this group.'}</Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Button onClick={() => handleGroupAction('clear')}>{i18n.language.startsWith('zh') ? '清空分组' : 'Clear group'}</Button>
          <Button color="error" variant="contained" onClick={() => handleGroupAction('delete')}>{i18n.language.startsWith('zh') ? '删除该组角色' : 'Delete characters'}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={i18n.language.startsWith('zh') ? '批量删除角色' : 'Delete selected characters'}
        message={i18n.language.startsWith('zh') ? `确认删除 ${selectedCustomCharacters.length} 个角色吗？` : `Delete ${selectedCustomCharacters.length} selected characters?`}
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => setBulkDeleteOpen(false)}
        destructive
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Button
        variant="contained"
        startIcon={<AddIcon />}
        onClick={openCreateForm}
        sx={{
          position: 'fixed',
          right: { xs: 20, sm: 28, md: 36 },
          bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', sm: 32, md: 36 },
          zIndex: 1300,
          minHeight: 56,
          px: 2.25,
          borderRadius: 18,
          boxShadow: '0 10px 24px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.16)',
        }}
      >
        {t('character.create')}
      </Button>
    </Box>
  );
}
