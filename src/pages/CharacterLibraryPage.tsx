import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { Box, Button, Snackbar, Alert, IconButton, Menu, MenuItem, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography, Divider, Tooltip } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import MoreIcon from '@mui/icons-material/MoreVert';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SortIcon from '@mui/icons-material/Sort';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import CharacterCard from '../components/character/CharacterCard';
import CharacterGroupFilterBar from '../components/character/CharacterGroupFilterBar';
import ConfirmDialog from '../components/common/ConfirmDialog';
import EmptyState from '../components/common/EmptyState';
import ListSkeletonGrid from '../components/common/ListSkeletonGrid';
import FloatingSegmentedTabs, { buildFloatingTabContainerSx } from '../components/common/FloatingSegmentedTabs';
import { usePaneLayout } from '../components/layout/PaneLayoutContext';
import { canDeleteCharacterGroup, getCharacterGroupList, getCharactersInGroup, isPresetCharacterSelectable, normalizeCharacterGroup, getDuplicateCharacterBannerText, getDuplicateCharacterCount } from '../types/character';
import { enqueueAvatarGenerationForCharacters } from '../services/avatarGeneration';
import { generateCharacterProfile } from '../services/characterGenerator';
import { createCharacterBubbleStyleId } from '../utils/bubbleStyle';
import { getPreferredAIProfile } from '../types/settings';
import { useChatStore } from '../stores/useChatStore';
import { buildDirectChatDraft } from '../services/chatDraftBuilder';
import type { AICharacter } from '../types/character';
import { readPersistentUiValue, writePersistentUiValue } from '../utils/persistentUiState';
import { buildFloatingActionSx, buildListGridSx } from '../styles/interaction';

type CharacterSortField = 'name' | 'createdAt';
type CharacterSortDirection = 'asc' | 'desc';
const CHARACTER_LIBRARY_TAB_KEY = 'character-library-tab';
const isCharacterLibraryTab = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1;

function getActiveCharacterId(pathname: string) {
  return pathname.match(/^\/characters\/([^/]+)\/edit$/)?.[1] || null;
}

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
  const location = useLocation();
  const { setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const settings = useSettingsStore();
  const pane = usePaneLayout();
  const isMasterPane = pane.role === 'master';
  const { chats, addChat } = useChatStore();
  const { characters, loadCharacters, deleteCharacter, deleteCharacters, updateCharactersGroup, importCharacters, initializePresets, isLoading } = useCharacterStore();
  const [tab, setTab] = useState(() => readPersistentUiValue(CHARACTER_LIBRARY_TAB_KEY, 0, isCharacterLibraryTab));
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectionMenuAnchorEl, setSelectionMenuAnchorEl] = useState<null | HTMLElement>(null);
  const groupPressTimerRef = useRef<number | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const activeCharacterId = isMasterPane && !selectionMode ? getActiveCharacterId(location.pathname) : null;
  const floatingActionPositionSx = isMasterPane ? {
    position: 'fixed' as const,
    right: pane.bounds ? `calc(100vw - ${pane.bounds.right}px + 28px)` : 28,
    bottom: pane.bounds ? `calc(100vh - ${pane.bounds.bottom}px + 32px)` : 32,
    visibility: pane.bounds ? 'visible' as const : 'hidden' as const,
  } : {
    position: 'fixed' as const,
    right: { xs: 20, sm: 28, md: 36 },
    bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', sm: 32, md: 36 },
  };

  useEffect(() => {
    void loadCharacters()
      .then(() => {
        setLoadError(null);
        return initializePresets();
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : (i18n.language.startsWith('zh') ? '角色加载失败' : 'Failed to load characters'));
      });
  }, [i18n.language, initializePresets, loadCharacters]);

  useEffect(() => {
    writePersistentUiValue(CHARACTER_LIBRARY_TAB_KEY, tab);
  }, [tab]);


  const presets = characters.filter((c) => c.isPreset);
  const custom = characters.filter((c) => !c.isPreset);
  const customGroups = useMemo(() => getCharacterGroupList(custom), [custom]);
  const customGroupOptions = useMemo(() => customGroups.map((group) => ({
    value: group,
    label: group,
    count: custom.filter((character) => normalizeCharacterGroup(character.group) === group).length,
  })), [custom, customGroups]);
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

  const desktopListMenu = null;
  void desktopListMenu;

  const mobileListHeader = null;
  void mobileListHeader;

  const renderListMenu = useMemo(() => (
    <>
      <Tooltip title={i18n.language.startsWith('zh') ? '更多' : 'More'}>
      <IconButton
        aria-label={i18n.language.startsWith('zh') ? '更多' : 'More'}
        onClick={(e) => setMenuAnchorEl(e.currentTarget)}
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          border: '1px solid',
          borderColor: (theme) => menuAnchorEl
            ? theme.palette.primary.main
            : 'transparent',
          bgcolor: (theme) => menuAnchorEl
            ? theme.palette.mode === 'light' ? 'rgba(49,90,156,0.10)' : 'rgba(120,156,220,0.14)'
            : 'transparent',
          transition: 'background-color 180ms ease, border-color 180ms ease, color 180ms ease',
          '&:hover': {
            borderColor: (theme) => menuAnchorEl
              ? theme.palette.primary.main
              : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
            bgcolor: (theme) => menuAnchorEl
              ? theme.palette.mode === 'light' ? 'rgba(49,90,156,0.12)' : 'rgba(120,156,220,0.16)'
              : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(226,232,240,0.06)',
          },
        }}
      >
        <MoreIcon fontSize="small" />
      </IconButton>
      </Tooltip>
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
  ), [custom.length, i18n.language, menuAnchorEl, navigate, t]);

  const sortFieldLabel = sortField === 'name'
    ? (i18n.language.startsWith('zh') ? '名称' : 'Name')
    : (i18n.language.startsWith('zh') ? '创建时间' : 'Created time');
  const sortDirectionLabel = sortDirection === 'asc'
    ? (i18n.language.startsWith('zh') ? '正序' : 'Ascending')
    : (i18n.language.startsWith('zh') ? '逆序' : 'Descending');
  const renderSortMenu = useMemo(() => (
    <>
      <Tooltip title={i18n.language.startsWith('zh') ? '排序' : 'Sort'}>
      <IconButton
        onClick={(event) => setSortMenuAnchorEl(event.currentTarget)}
        aria-label={i18n.language.startsWith('zh') ? '排序' : 'Sort'}
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          border: '1px solid',
          borderColor: (theme) => sortMenuAnchorEl
            ? theme.palette.primary.main
            : 'transparent',
          bgcolor: (theme) => sortMenuAnchorEl
            ? theme.palette.mode === 'light' ? 'rgba(49,90,156,0.10)' : 'rgba(120,156,220,0.14)'
            : 'transparent',
          transition: 'background-color 180ms ease, border-color 180ms ease, color 180ms ease',
          '&:hover': {
            borderColor: (theme) => sortMenuAnchorEl
              ? theme.palette.primary.main
              : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
            bgcolor: (theme) => sortMenuAnchorEl
              ? theme.palette.mode === 'light' ? 'rgba(49,90,156,0.12)' : 'rgba(120,156,220,0.16)'
              : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(226,232,240,0.06)',
          },
        }}
      >
        <SortIcon fontSize="small" />
      </IconButton>
      </Tooltip>
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
  ), [i18n.language, sortField, sortMenuAnchorEl, sortDirection, sortGroupFirst]);

  useEffect(() => {
    setHideMobileBottomNav(false);
    setHeaderBackAction(null);
    setHeaderTitle(null);
    setHeaderActions(
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Chip
          size="small"
          label={`${sortFieldLabel} · ${sortDirectionLabel}${sortGroupFirst ? ` · ${i18n.language.startsWith('zh') ? '分组优先' : 'Group first'}` : ''}`}
          sx={{ display: { xs: 'none', md: 'inline-flex' } }}
        />
        {renderSortMenu}
        {renderListMenu}
      </Box>
    );

    return () => {
      setHeaderActions(null);
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
    };
  }, [i18n.language, renderListMenu, renderSortMenu, setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav, sortDirectionLabel, sortFieldLabel, sortGroupFirst]);

  const openCreateForm = () => {
    navigate('/characters/create');
  };

  const handleExport = () => {
    const data = JSON.stringify(custom, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pneumata-characters.json';
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
    <Box sx={{ position: 'relative', containerType: 'inline-size', p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 96px)', sm: 12 } }}>
      <Box sx={buildFloatingTabContainerSx()}>
        <FloatingSegmentedTabs
          value={tab}
          onChange={(value) => {
            setTab(value);
            resetSelection();
          }}
          items={[
            { value: 0, label: `${t('character.myCharacters')} (${custom.length})` },
            { value: 1, label: `${t('character.presets')} (${presets.length})` },
          ]}
        />
        {loadError ? (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={<Button color="inherit" size="small" onClick={() => {
              void loadCharacters()
                .then(() => setLoadError(null))
                .catch((error) => setLoadError(error instanceof Error ? error.message : (i18n.language.startsWith('zh') ? '角色加载失败' : 'Failed to load characters')));
            }}>{i18n.language.startsWith('zh') ? '重试' : 'Retry'}</Button>}
          >
            {loadError}
          </Alert>
        ) : null}
        {tab === 0 && duplicateCharacterCount > 0 ? <Alert severity="warning" sx={{ mb: 2 }}>{duplicateCharacterBannerText}</Alert> : null}
      </Box>

      {tab === 0 ? (
        <CharacterGroupFilterBar
          allLabel={i18n.language.startsWith('zh') ? '全部' : 'All'}
          allValue="all"
          allCount={custom.length}
          options={customGroupOptions}
          selectedValue={selectedGroup}
          onSelect={(value) => setSelectedGroup(value || 'all')}
          onGroupPointerDown={(group) => {
            if (canDeleteCharacterGroup(group)) {
              startGroupLongPress(group);
            }
          }}
          onGroupPointerUp={clearGroupPressTimer}
          onGroupPointerLeave={clearGroupPressTimer}
          onGroupPointerCancel={clearGroupPressTimer}
          sx={{ mb: 2 }}
        />
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

      <Box sx={{ pr: 0.5 }}>
      {isLoading && characters.length === 0 ? (
        <ListSkeletonGrid />
      ) : displayChars.length === 0 ? (
        <EmptyState
          variant="plain"
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
            ...buildListGridSx(),
            alignItems: 'stretch',
          }}
        >
          {displayChars.map((char) => {
            const selectable = tab === 0 && isPresetCharacterSelectable(char);
            return (
              <CharacterCard
                key={char.id}
                character={char}
                selected={selectedIdSet.has(char.id) || activeCharacterId === char.id}
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
          ...floatingActionPositionSx,
          ...buildFloatingActionSx(),
        }}
      >
        {t('character.create')}
      </Button>
    </Box>
  );
}
