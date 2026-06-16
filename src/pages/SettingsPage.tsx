import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  Button,
  Chip,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  FormControlLabel,
  Switch,
  Tooltip,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import EditIcon from '@mui/icons-material/Edit';
import BackupIcon from '@mui/icons-material/Download';
import RestoreIcon from '@mui/icons-material/Upload';
import ClearIcon from '@mui/icons-material/Delete';
import LogoutIcon from '@mui/icons-material/Logout';
import SyncIcon from '@mui/icons-material/Sync';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ApiError, api } from '../services/api';
import { useAuthStore } from '../stores/useAuthStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useMessageStore } from '../stores/useMessageStore';
import ConfirmDialog from '../components/common/ConfirmDialog';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';
import StatChipRow from '../components/common/StatChipRow';
import AppSnackbar from '../components/common/AppSnackbar';
import { PAPER_SURFACE_VARIANTS, type PaperSurfaceVariant } from '../types/artifactAppearance';
import type { AppSettingsWithMemory } from '../types/settings';
import type { CompanionshipRitualKind } from '../types/settings';
import { migrateLegacyBrandStorageKeys } from '../constants/brand';
import BubbleStylePickerDialog from '../components/bubble/BubbleStylePickerDialog';
import { DEFAULT_AI_BUBBLE_STYLE_ID } from '../constants/bubbleStyles';
import { buildBubblePreview, resolveCharacterBubbleStyle } from '../utils/bubbleStyle';
import { isImageAvatar } from '../utils/avatar';

function buildPageSx() {
  return { p: { xs: 2.5, sm: 3, md: 3.5 }, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 96px)', sm: 3, md: 3.5 }, width: '100%', maxWidth: 960, mx: 'auto' };
}

function buildToggleGroupSx() {
  return { alignItems: 'center', justifyContent: 'flex-start', overflow: 'visible', flexWrap: 'wrap' as const, gap: 0.5 };
}

const THEME_TONES = [
  { value: '#315A9C', zh: '静海蓝', en: 'Still blue' },
  { value: '#0F766E', zh: '深海青', en: 'Deep teal' },
  { value: '#7C3AED', zh: '冷紫', en: 'Violet' },
  { value: '#B45309', zh: '琥珀', en: 'Amber' },
  { value: '#334155', zh: '石墨灰', en: 'Graphite' },
] as const;

const RITUAL_KIND_OPTIONS: Array<{ kind: CompanionshipRitualKind; zh: string; en: string }> = [
  { kind: 'daily_greeting', zh: '日常问候', en: 'Greetings' },
  { kind: 'pet_name', zh: '专属称呼', en: 'Pet names' },
  { kind: 'anniversary', zh: '纪念日', en: 'Anniversaries' },
  { kind: 'inside_joke', zh: '共同梗', en: 'Inside jokes' },
  { kind: 'reconciliation', zh: '和好', en: 'Reconciliation' },
  { kind: 'milestone', zh: '里程碑', en: 'Milestones' },
];

function buildToneGridSx() {
  return {
    display: 'grid',
    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(5, minmax(0, 1fr))' },
    gap: 0.85,
  };
}

function buildToneButtonSx(color: string, selected: boolean) {
  return {
    justifyContent: 'flex-start',
    minHeight: 54,
    px: 1.05,
    py: 0.9,
    borderRadius: 2,
    textTransform: 'none',
    whiteSpace: 'normal',
    borderColor: selected ? color : 'divider',
    bgcolor: selected ? `${color}14` : 'transparent',
    color: 'text.primary',
    '&:hover': {
      borderColor: color,
      bgcolor: `${color}12`,
    },
  };
}

function buildPaperPickerSx() {
  return {
    display: 'grid',
    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
    gap: 1,
    alignItems: 'stretch',
  };
}

function buildPaperToggleSx() {
  return {
    display: 'grid',
    gap: 0.75,
    justifyItems: 'stretch',
    alignContent: 'start',
    minHeight: 128,
    px: 1,
    py: 1,
    borderRadius: 2,
    textTransform: 'none',
    whiteSpace: 'normal',
    '&.Mui-selected': {
      boxShadow: '0 0 0 1px rgba(103, 80, 164, 0.45)',
    },
  };
}

function buildActionGridSx() {
  return { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 };
}

function buildCardBodySx() {
  return { p: { xs: 1.75, sm: 2 }, '&:last-child': { pb: { xs: 1.75, sm: 2 } } };
}

function buildSectionBodySx() {
  return { display: 'flex', flexDirection: 'column', gap: 2.25 };
}

function buildDeveloperBodySx() {
  return { display: 'flex', flexDirection: 'column', gap: 1.35 };
}

function buildTopRowSx() {
  return { display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: 2 };
}

function buildAccountBubblePreviewSx() {
  return {
    mt: 1.5,
    display: 'flex',
    alignItems: 'center',
    gap: 1.25,
    minWidth: 0,
    cursor: 'pointer',
    border: '1px solid',
    borderColor: (theme: { palette: { mode: string } }) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
    borderRadius: 1.5,
    px: 1.25,
    py: 1,
    bgcolor: (theme: { palette: { mode: string } }) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(16px) saturate(1.08)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
    transition: 'border-color 160ms ease, background-color 160ms ease',
    '&:hover': {
      borderColor: 'primary.main',
      bgcolor: (theme: { palette: { mode: string } }) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.075)',
    },
  };
}

function buildDeveloperChips(language: string) {
  return [language.startsWith('zh') ? '调试' : 'Debug', language.startsWith('zh') ? '运行态证据' : 'Runtime evidence'];
}

function buildDeveloperSwitchGroupsSx() {
  return {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
    gap: 1,
    alignItems: 'start',
  };
}

function buildDeveloperSwitchGroupSx() {
  return {
    display: 'grid',
    alignContent: 'start',
    gap: 0.4,
    p: 1.25,
    borderRadius: 2,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.default',
    minWidth: 0,
  };
}

function buildDeveloperSwitchListSx() {
  return {
    display: 'grid',
    gap: 0.1,
    '& .MuiFormControlLabel-root': {
      m: 0,
      minHeight: 34,
      alignItems: 'center',
    },
    '& .MuiFormControlLabel-label': {
      fontSize: '0.875rem',
      lineHeight: 1.35,
    },
  };
}

function buildDataChips(language: string) {
  return [language.startsWith('zh') ? '备份 / 恢复' : 'Backup / Restore', language.startsWith('zh') ? '回收站' : 'Recycle Bin'];
}

type BackupSelection = Record<BackupSectionKey, boolean>;

type BackupTreeNode = {
  key: BackupSectionKey;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
  children?: BackupTreeNode[];
};

type BackupNodeStats = Partial<Record<BackupSectionKey, number>>;

function collectNodeStats(data: BackupFileShape): BackupNodeStats {
  const stats: BackupNodeStats = {};
  const characters = Array.isArray(data.characters) ? data.characters.map((item) => item as Record<string, unknown>) : [];
  const chats = Array.isArray(data.chats) ? data.chats : [];
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const settings = data.settings;

  stats.characters = characters.length;
  stats['characters.core'] = characters.length;
  stats['characters.relationships'] = characters.filter((item) => Boolean(item.relationships)).length;
  stats['characters.memory'] = characters.filter((item) => Boolean(item.memory || item.layeredMemories)).length;
  stats['characters.visual'] = characters.filter((item) => Boolean(item.visualIdentity || item.visualReferenceImages || item.bubbleStyle || item.bubbleStyleId)).length;
  stats['characters.runtime'] = characters.filter((item) => Boolean(item.runtimeTimeline || item.emotionalState || item.behavior)).length;
  stats['characters.modelBindings'] = characters.filter((item) => Boolean(item.modelProfileId || item.modelProfileIds)).length;

  stats.chats = chats.length;
  stats['chats.core'] = chats.length;
  stats['chats.runtime'] = chats.filter((item) => Boolean(item.runtimeSeed || item.runtimeTimeline || item.runtimeEventsV2 || item.modeConfig || item.modeState || item.directorControls)).length;
  stats['chats.relationships'] = chats.filter((item) => Boolean(item.relationshipLedger || item.governance || item.dramaRules)).length;
  stats['chats.world'] = chats.filter((item) => Boolean(item.worldState)).length;

  stats.messages = messages.length;
  stats['messages.content'] = messages.filter((item) => Boolean(item.type || item.content || item.senderId || item.senderName)).length;
  stats['messages.metadata'] = messages.filter((item) => Boolean(item.metadata)).length;

  stats.settings = settings ? 1 : 0;
  stats['settings.api'] = settings?.api ? 1 : 0;
  stats['settings.api.credentials'] = settings?.api?.apiKey ? 1 : 0;
  stats['settings.aiProfiles'] = Array.isArray(settings?.aiProfiles) ? settings.aiProfiles.length : 0;
  stats['settings.aiProfiles.credentials'] = Array.isArray(settings?.aiProfiles) ? settings.aiProfiles.filter((profile) => profile.apiKey).length : 0;
  stats['settings.appearance'] = settings && ('theme' in settings || 'themeColor' in settings || 'language' in settings || 'customBubbleStyles' in settings || 'userBubbleStyleId' in settings || 'userBubbleStyle' in settings || 'artifactAppearance' in settings) ? 1 : 0;
  stats['settings.generation'] = settings && ('avatarGeneration' in settings || 'aiGeneration' in settings || 'companionship' in settings) ? 1 : 0;
  stats['settings.chatDraftDefaults'] = settings && ('defaultSpeed' in settings || 'chatDraftDefaults' in settings) ? 1 : 0;
  stats['settings.developer'] = settings && ('developerMode' in settings || 'developerUI' in settings || 'memoryUI' in settings) ? 1 : 0;
  stats['settings.usageStats'] = settings && 'usageStats' in settings ? 1 : 0;

  return stats;
}

function formatNodeLabel(node: BackupTreeNode, language: string) {
  return language.startsWith('zh') ? node.labelZh : node.labelEn;
}

function formatNodeCount(node: BackupTreeNode, stats?: BackupNodeStats) {
  if (!node.children?.length) return null;
  const count = stats?.[node.key];
  return typeof count === 'number' && count > 0 ? count : null;
}


function shouldShowNodeCount(node: BackupTreeNode, level: number, stats?: BackupNodeStats) {
  return level === 0 ? formatNodeCount(node, stats) : null;
}

function hasStructuredEntries(items: unknown[] | undefined) {
  return Array.isArray(items) && items.some((item) => Boolean(item && typeof item === 'object' && Object.keys(item as Record<string, unknown>).length > 0));
}

function hasAnyNonMetaKeys(item: Record<string, unknown>, ignoredKeys: string[] = []) {
  return Object.keys(item).some((key) => !ignoredKeys.includes(key));
}

function hasSettingsData(settings: BackupFileShape['settings']) {
  return Boolean(settings && Object.keys(settings).length > 0);
}

function hasChatPayload(item: Record<string, unknown>) {
  return hasAnyNonMetaKeys(item);
}

function hasCharacterPayload(item: Record<string, unknown>) {
  return hasAnyNonMetaKeys(item);
}

function hasMessagePayload(item: Record<string, unknown>) {
  return hasAnyNonMetaKeys(item, ['chatId']);
}

function hasExportedCharacterCore(item: Record<string, unknown>) {
  return [
    'id',
    'name',
    'avatar',
    'personality',
    'expertise',
    'speakingStyle',
    'background',
    'group',
    'isPreset',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'fieldVersions',
  ].some((key) => key in item);
}

function hasExportedChatCore(item: Record<string, unknown>) {
  return [
    'id',
    'type',
    'mode',
    'name',
    'topic',
    'style',
    'runtimeEvolutionIntensity',
    'memberIds',
    'speed',
    'isActive',
    'allowIntervention',
    'showRoleActions',
    'topicSeed',
    'sourceChatId',
    'sourceMemberIds',
    'createdAt',
    'updatedAt',
    'lastMessageAt',
    'deletedAt',
    'fieldVersions',
  ].some((key) => key in item);
}

function hasExportedMessageContent(item: Record<string, unknown>) {
  return ['type', 'senderId', 'senderName', 'content', 'emotion', 'timestamp', 'isDeleted'].some((key) => key in item);
}

function hasLeafData(items: unknown[] | undefined, matcher: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(items) && items.some((item) => Boolean(item && typeof item === 'object' && matcher(item as Record<string, unknown>)));
}


type BackupFileShape = {
  characters?: unknown[];
  chats?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  settings?: Partial<AppSettingsWithMemory> & {
    api?: AppSettingsWithMemory['api'];
    aiProfiles?: AppSettingsWithMemory['aiProfiles'];
  };
};

function findTreeNodeByKey(nodes: BackupTreeNode[], key: BackupSectionKey): BackupTreeNode | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    if (node.children?.length) {
      const match = findTreeNodeByKey(node.children, key);
      if (match) return match;
    }
  }
  return null;
}

function getAvailableChildNodes(node: BackupTreeNode, availability?: BackupSelection) {
  return (node.children || []).filter((child) => isNodeAvailable(child, availability));
}

function isNodeAvailable(node: BackupTreeNode, availability?: BackupSelection): boolean {
  if (!availability) return true;
  if (!node.children?.length) return Boolean(availability[node.key]);
  return getAvailableChildNodes(node, availability).length > 0;
}

function normalizeSelection(selection: BackupSelection, availability?: BackupSelection): BackupSelection {
  const next = { ...EMPTY_BACKUP_SELECTION, ...selection };

  const walk = (node: BackupTreeNode): boolean => {
    if (!node.children?.length) {
      const checked = isNodeAvailable(node, availability) ? Boolean(next[node.key]) : false;
      next[node.key] = checked;
      return checked;
    }

    const availableChildren = getAvailableChildNodes(node, availability);
    if (availableChildren.length === 0) {
      next[node.key] = false;
      return false;
    }

    const checkedChildren = availableChildren.map(walk);
    next[node.key] = checkedChildren.every(Boolean);
    return checkedChildren.some(Boolean);
  };

  BACKUP_TREE.forEach(walk);
  return next;
}

function getNodeCheckState(
  node: BackupTreeNode,
  selection: BackupSelection,
  availability?: BackupSelection,
): { checked: boolean; indeterminate: boolean } {
  if (!node.children?.length) {
    return { checked: isNodeAvailable(node, availability) ? Boolean(selection[node.key]) : false, indeterminate: false };
  }

  const availableChildren = getAvailableChildNodes(node, availability);
  if (availableChildren.length === 0) {
    return { checked: false, indeterminate: false };
  }

  const childStates = availableChildren.map((child) => getNodeCheckState(child, selection, availability));
  const checkedCount = childStates.filter((state) => state.checked).length;
  const hasIndeterminate = childStates.some((state) => state.indeterminate);
  return {
    checked: checkedCount === availableChildren.length,
    indeterminate: hasIndeterminate || (checkedCount > 0 && checkedCount < availableChildren.length),
  };
}

function hasSelectionInNode(
  node: BackupTreeNode,
  selection: BackupSelection,
  availability?: BackupSelection,
): boolean {
  if (!isNodeAvailable(node, availability)) return false;
  if (!node.children?.length) return Boolean(selection[node.key]);
  return getAvailableChildNodes(node, availability).some((child) => hasSelectionInNode(child, selection, availability));
}

function hasNodeSelection(
  key: BackupSectionKey,
  selection: BackupSelection,
  availability?: BackupSelection,
): boolean {
  const node = findTreeNodeByKey(BACKUP_TREE, key);
  return node ? hasSelectionInNode(node, selection, availability) : false;
}

function setSubtreeSelection(
  selection: BackupSelection,
  key: BackupSectionKey,
  checked: boolean,
  availability?: BackupSelection,
): BackupSelection {
  const next = { ...selection };
  const node = findTreeNodeByKey(BACKUP_TREE, key);
  if (!node) return next;

  const apply = (target: BackupTreeNode) => {
    if (!isNodeAvailable(target, availability)) {
      next[target.key] = false;
      return;
    }
    if (!target.children?.length) {
      next[target.key] = checked;
      return;
    }
    getAvailableChildNodes(target, availability).forEach(apply);
  };

  apply(node);
  return normalizeSelection(next, availability);
}

function hasAnySelected(selection: BackupSelection, availability?: BackupSelection) {
  return BACKUP_ROOT_KEYS.some((key) => hasNodeSelection(key, selection, availability));
}

function getRestoreHasPayload(data: BackupFileShape) {
  return BACKUP_ROOT_KEYS.some((key) => (collectNodeStats(data)[key] || 0) > 0);
}

function getNodeDescription(node: BackupTreeNode, language: string) {
  return language.startsWith('zh') ? node.descriptionZh : node.descriptionEn;
}

function toggleExpandedKey(current: BackupSectionKey[], key: BackupSectionKey) {
  return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
}

function buildDefaultRestoreSelection(availability: BackupSelection): BackupSelection {
  return normalizeSelection(buildRestoreSelectionFromAvailability(availability), availability);
}

function getRestoreDialogMaxWidth() {
  return 'min(68vh, 720px)';
}

function buildRestoreFileNameSx() {
  return { display: 'block', mb: 1, wordBreak: 'break-all' as const };
}

function buildDialogContentSx() {
  return { display: 'grid', gap: 1.25, overflow: 'hidden' };
}

function buildDialogPaperSx() {
  return { '& .MuiDialog-paper': { maxHeight: 'min(88vh, 960px)' } };
}

function buildDialogActionsSx() {
  return { px: 3, pb: 2, pt: 1 };
}

function buildWarningAlertSx() {
  return { mt: 0.25 };
}

function getRestoreSelectionSummary(selection: BackupSelection, availability: BackupSelection) {
  return hasAnySelected(selection, availability);
}

function getBackupSelectionSummary(selection: BackupSelection) {
  return hasAnySelected(selection);
}

function buildTreeRowButtonSx(disabled: boolean) {
  return {
    ...buildTreeContentButtonSx(disabled),
    alignSelf: 'stretch',
    minHeight: 0,
  };
}

function buildTreeExpandPlaceholderSx() {
  return { width: 28, height: 28 };
}

function shouldRenderExpandButton(node: BackupTreeNode, availability?: BackupSelection) {
  return Boolean(node.children?.length);
}

function getNodeCount(node: BackupTreeNode, level: number, stats?: BackupNodeStats) {
  return shouldShowNodeCount(node, level, stats);
}

function buildDefaultBackupSelection() {
  return normalizeSelection(DEFAULT_BACKUP_SELECTION);
}

function normalizeSelectionForAvailability(selection: BackupSelection, availability: BackupSelection) {
  return normalizeSelection(applyAvailability(selection, availability), availability);
}

function shouldEnableRestoreConfirm(selection: BackupSelection, availability: BackupSelection) {
  return getRestoreSelectionSummary(selection, availability);
}

function shouldEnableBackupConfirm(selection: BackupSelection) {
  return getBackupSelectionSummary(selection);
}

function hasSelectedSecrets(selection: BackupSelection) {
  return selection['settings.api.credentials'] || selection['settings.aiProfiles.credentials'];
}

function getRestoreEmptyHint(data: BackupFileShape, language: string) {
  return getRestoreHasPayload(data)
    ? ''
    : language.startsWith('zh')
      ? '这个备份文件里没有可恢复的数据。'
      : 'This backup file does not contain restorable data.';
}

function buildInitialRestoreState(data: BackupFileShape, language: string) {
  const stats = collectNodeStats(data);
  const availability = buildRestoreAvailabilityFromData(data);
  const selection = buildDefaultRestoreSelection(availability);
  return {
    stats,
    availability,
    selection,
    emptyHint: getRestoreEmptyHint(data, language),
  };
}

function getBackupDialogSelection(selection: BackupSelection) {
  return normalizeSelection(selection);
}

function getRestoreDialogSelection(selection: BackupSelection, availability: BackupSelection) {
  return normalizeSelectionForAvailability(selection, availability);
}

function isRestoreConfirmDisabled(selection: BackupSelection, availability: BackupSelection) {
  return !shouldEnableRestoreConfirm(selection, availability);
}

function isBackupConfirmDisabled(selection: BackupSelection) {
  return !shouldEnableBackupConfirm(selection);
}

function isNodeDisabled(node: BackupTreeNode, availability: BackupSelection) {
  return !isNodeAvailable(node, availability);
}

function getNodeState(node: BackupTreeNode, selection: BackupSelection, availability?: BackupSelection) {
  return getNodeCheckState(node, selection, availability);
}

function toggleNodeSelection(
  node: BackupTreeNode,
  selection: BackupSelection,
  checked: boolean,
  availability?: BackupSelection,
) {
  return setSubtreeSelection(selection, node.key, checked, availability);
}

function isRestoreFileLoaded(data: BackupFileShape | null) {
  return Boolean(data);
}

function buildDialogScrollableContentSx() {
  return { overflow: 'hidden', pb: 1 };
}

function buildTreeNodeClickValue(state: { checked: boolean; indeterminate: boolean }) {
  return !state.checked || state.indeterminate;
}

function getDefaultExpandedKeys() {
  return DEFAULT_EXPANDED_KEYS;
}

function isSecretWarningVisible(selection: BackupSelection) {
  return hasSelectedSecrets(selection);
}

function getTreeNodeCountText(node: BackupTreeNode, level: number, stats?: BackupNodeStats) {
  return getNodeCount(node, level, stats);
}

function shouldDisableConfirm(mode: 'backup' | 'restore', selection: BackupSelection, availability?: BackupSelection) {
  return mode === 'backup' ? isBackupConfirmDisabled(selection) : isRestoreConfirmDisabled(selection, availability || EMPTY_BACKUP_SELECTION);
}

function createDialogSelectionHandler(
  selection: BackupSelection,
  key: BackupSectionKey,
  checked: boolean,
  availability?: BackupSelection,
) {
  return setSubtreeSelection(selection, key, checked, availability);
}

function buildDialogTreeSelection(selection: BackupSelection, availability?: BackupSelection) {
  return availability ? getRestoreDialogSelection(selection, availability) : getBackupDialogSelection(selection);
}

function getNodeRowDisabled(node: BackupTreeNode, availability: BackupSelection) {
  return isNodeDisabled(node, availability);
}

function canToggleNode(node: BackupTreeNode, availability: BackupSelection) {
  return !getNodeRowDisabled(node, availability);
}

function getNodeExpandState(node: BackupTreeNode, expandedKeys: BackupSectionKey[]) {
  return expandedKeys.includes(node.key);
}

function buildTreeNodeLabel(node: BackupTreeNode, language: string) {
  return formatNodeLabel(node, language);
}

function buildTreeNodeDescription(node: BackupTreeNode, language: string) {
  return getNodeDescription(node, language);
}

function getDialogSelectionForSubmit(mode: 'backup' | 'restore', selection: BackupSelection, availability?: BackupSelection) {
  return mode === 'backup' ? getBackupDialogSelection(selection) : getRestoreDialogSelection(selection, availability || EMPTY_BACKUP_SELECTION);
}

function updateExpandedKeys(current: BackupSectionKey[], key: BackupSectionKey) {
  return toggleExpandedKey(current, key);
}

function getTreeState(node: BackupTreeNode, selection: BackupSelection, availability?: BackupSelection) {
  return getNodeState(node, selection, availability);
}

function getTreeNodeCheckedValue(state: { checked: boolean; indeterminate: boolean }) {
  return buildTreeNodeClickValue(state);
}

function isTreeExpandVisible(node: BackupTreeNode, availability?: BackupSelection) {
  return shouldRenderExpandButton(node, availability);
}

function getTreeNodeCount(node: BackupTreeNode, level: number, stats?: BackupNodeStats) {
  return getTreeNodeCountText(node, level, stats);
}

function getTreeDialogHeight() {
  return getRestoreDialogMaxWidth();
}

function isDialogConfirmDisabled(mode: 'backup' | 'restore', selection: BackupSelection, availability?: BackupSelection) {
  return shouldDisableConfirm(mode, selection, availability);
}

function getSelectionAfterToggle(
  selection: BackupSelection,
  key: BackupSectionKey,
  checked: boolean,
  availability?: BackupSelection,
) {
  return createDialogSelectionHandler(selection, key, checked, availability);
}

function getPreparedSelection(selection: BackupSelection, availability?: BackupSelection) {
  return buildDialogTreeSelection(selection, availability);
}

function hasVisibleCount(node: BackupTreeNode, level: number, stats?: BackupNodeStats) {
  return getTreeNodeCount(node, level, stats) !== null;
}

function getVisibleCount(node: BackupTreeNode, level: number, stats?: BackupNodeStats) {
  return getTreeNodeCount(node, level, stats);
}

function buildTreeDialogContainerSx() {
  return buildDialogTreeBodySx();
}

function getDialogExpandedKeys() {
  return getDefaultExpandedKeys();
}

function getSecretWarningState(selection: BackupSelection) {
  return isSecretWarningVisible(selection);
}

function shouldShowEmptyHint(hint: string) {
  return Boolean(hint);
}

function buildDialogTreeDisabledState(node: BackupTreeNode, availability: BackupSelection) {
  return getNodeRowDisabled(node, availability);
}

function buildDialogTreeState(node: BackupTreeNode, selection: BackupSelection, availability?: BackupSelection) {
  return getTreeState(node, selection, availability);
}

function buildDialogTreeCount(node: BackupTreeNode, level: number, stats?: BackupNodeStats) {
  return getVisibleCount(node, level, stats);
}

function buildDialogTreeExpandState(node: BackupTreeNode, expandedKeys: BackupSectionKey[]) {
  return getNodeExpandState(node, expandedKeys);
}

function buildDialogTreeLabel(node: BackupTreeNode, language: string) {
  return buildTreeNodeLabel(node, language);
}

function buildDialogTreeDescription(node: BackupTreeNode, language: string) {
  return buildTreeNodeDescription(node, language);
}
function buildBackupPayload(selection: BackupSelection, source: {
  characters: unknown[];
  chats: unknown[];
  messages: unknown[];
  settings: AppSettingsWithMemory;
}): BackupFileShape {
  const payload: BackupFileShape = {};
  if (selection.characters) payload.characters = source.characters;
  if (selection.chats) payload.chats = source.chats as Array<Record<string, unknown>>;
  if (selection.messages) payload.messages = source.messages as Array<Record<string, unknown>>;
  if (selection.settings) {
    const settingsPayload: NonNullable<BackupFileShape['settings']> = {};
    if (selection['settings.api']) {
      settingsPayload.api = selection['settings.api.credentials']
        ? source.settings.api
        : { ...source.settings.api, apiKey: '' };
    }
    if (selection['settings.aiProfiles']) {
      settingsPayload.aiProfiles = selection['settings.aiProfiles.credentials']
        ? source.settings.aiProfiles
        : source.settings.aiProfiles.map((profile) => ({ ...profile, apiKey: '' }));
    }
    if (selection['settings.appearance']) {
      settingsPayload.theme = source.settings.theme;
      settingsPayload.themeColor = source.settings.themeColor;
      settingsPayload.language = source.settings.language;
      settingsPayload.customBubbleStyles = source.settings.customBubbleStyles;
      settingsPayload.userBubbleStyleId = source.settings.userBubbleStyleId;
      settingsPayload.userBubbleStyle = source.settings.userBubbleStyle;
      settingsPayload.artifactAppearance = source.settings.artifactAppearance;
    }
    if (selection['settings.generation']) {
      settingsPayload.avatarGeneration = source.settings.avatarGeneration;
      settingsPayload.aiGeneration = source.settings.aiGeneration;
      settingsPayload.companionship = source.settings.companionship;
    }
    if (selection['settings.chatDraftDefaults']) {
      settingsPayload.defaultSpeed = source.settings.defaultSpeed;
      settingsPayload.chatDraftDefaults = source.settings.chatDraftDefaults;
    }
    if (selection['settings.developer']) {
      settingsPayload.developerMode = source.settings.developerMode;
      settingsPayload.developerUI = source.settings.developerUI;
      settingsPayload.memoryUI = source.settings.memoryUI;
    }
    if (selection['settings.usageStats']) {
      settingsPayload.usageStats = source.settings.usageStats;
    }
    if (Object.keys(settingsPayload).length) payload.settings = settingsPayload;
  }
  return payload;
}

type BackupSectionKey =
  | 'characters'
  | 'characters.core'
  | 'characters.relationships'
  | 'characters.memory'
  | 'characters.visual'
  | 'characters.runtime'
  | 'characters.modelBindings'
  | 'chats'
  | 'chats.core'
  | 'chats.runtime'
  | 'chats.relationships'
  | 'chats.world'
  | 'messages'
  | 'messages.content'
  | 'messages.metadata'
  | 'settings'
  | 'settings.api'
  | 'settings.api.credentials'
  | 'settings.aiProfiles'
  | 'settings.aiProfiles.credentials'
  | 'settings.appearance'
  | 'settings.generation'
  | 'settings.chatDraftDefaults'
  | 'settings.developer'
  | 'settings.usageStats';

const BACKUP_KEY_ORDER: BackupSectionKey[] = [
  'characters',
  'characters.core',
  'characters.relationships',
  'characters.memory',
  'characters.visual',
  'characters.runtime',
  'characters.modelBindings',
  'chats',
  'chats.core',
  'chats.runtime',
  'chats.relationships',
  'chats.world',
  'messages',
  'messages.content',
  'messages.metadata',
  'settings',
  'settings.api',
  'settings.api.credentials',
  'settings.aiProfiles',
  'settings.aiProfiles.credentials',
  'settings.appearance',
  'settings.generation',
  'settings.chatDraftDefaults',
  'settings.developer',
  'settings.usageStats',
];

const EMPTY_BACKUP_SELECTION: BackupSelection = BACKUP_KEY_ORDER.reduce((acc, key) => {
  acc[key] = false;
  return acc;
}, {} as BackupSelection);

const DEFAULT_BACKUP_SELECTION: BackupSelection = {
  ...EMPTY_BACKUP_SELECTION,
  characters: true,
  'characters.core': true,
  'characters.relationships': true,
  'characters.memory': true,
  'characters.visual': true,
  'characters.runtime': true,
  'characters.modelBindings': true,
  chats: true,
  'chats.core': true,
  'chats.runtime': true,
  'chats.relationships': true,
  'chats.world': true,
  messages: true,
  'messages.content': true,
  'messages.metadata': true,
  settings: true,
  'settings.api': true,
  'settings.api.credentials': false,
  'settings.aiProfiles': true,
  'settings.aiProfiles.credentials': false,
  'settings.appearance': true,
  'settings.generation': true,
  'settings.chatDraftDefaults': true,
  'settings.developer': true,
  'settings.usageStats': true,
};

const DISABLED_BACKUP_SELECTION = EMPTY_BACKUP_SELECTION;

function createSelection(overrides: Partial<BackupSelection> = {}): BackupSelection {
  return { ...EMPTY_BACKUP_SELECTION, ...overrides };
}

function mergeSelection(base: BackupSelection, overrides: Partial<BackupSelection>): BackupSelection {
  return { ...base, ...overrides };
}

function createCharacterBackupEntry(character: Record<string, unknown>, selection: BackupSelection) {
  const next: Record<string, unknown> = {};
  if (selection['characters.core']) {
    Object.assign(next, {
      id: character.id,
      name: character.name,
      avatar: character.avatar,
      personality: character.personality,
      expertise: character.expertise,
      speakingStyle: character.speakingStyle,
      background: character.background,
      group: character.group,
      isPreset: character.isPreset,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      deletedAt: character.deletedAt,
      fieldVersions: character.fieldVersions,
    });
  }
  if (selection['characters.relationships']) next.relationships = character.relationships;
  if (selection['characters.memory']) {
    next.memory = character.memory;
    next.layeredMemories = character.layeredMemories;
  }
  if (selection['characters.visual']) {
    next.visualIdentity = character.visualIdentity;
    next.visualReferenceImages = character.visualReferenceImages;
    next.bubbleStyleId = character.bubbleStyleId;
    next.bubbleStyle = character.bubbleStyle;
    next.speechProfile = character.speechProfile;
    next.voiceConfig = character.voiceConfig;
  }
  if (selection['characters.runtime']) {
    next.personalityDrift = character.personalityDrift;
    next.emotionalState = character.emotionalState;
    next.soulState = character.soulState;
    next.coreProfile = character.coreProfile;
    next.behavior = character.behavior;
    next.runtimeTimeline = character.runtimeTimeline;
    next.intervention = character.intervention;
    next.generationPreferences = character.generationPreferences;
    next.characterDetailLoaded = character.characterDetailLoaded;
  }
  if (selection['characters.modelBindings']) {
    next.modelProfileId = character.modelProfileId;
    next.modelProfileIds = character.modelProfileIds;
  }
  return next;
}

function createChatBackupEntry(chat: Record<string, unknown>, selection: BackupSelection) {
  const next: Record<string, unknown> = {};
  if (selection['chats.core']) {
    Object.assign(next, {
      id: chat.id,
      type: chat.type,
      mode: chat.mode,
      name: chat.name,
      topic: chat.topic,
      style: chat.style,
      runtimeEvolutionIntensity: chat.runtimeEvolutionIntensity,
      memberIds: chat.memberIds,
      speed: chat.speed,
      isActive: chat.isActive,
      allowIntervention: chat.allowIntervention,
      showRoleActions: chat.showRoleActions,
      topicSeed: chat.topicSeed,
      sourceChatId: chat.sourceChatId,
      sourceMemberIds: chat.sourceMemberIds,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      lastMessageAt: chat.lastMessageAt,
      deletedAt: chat.deletedAt,
      fieldVersions: chat.fieldVersions,
    });
  }
  if (selection['chats.runtime']) {
    next.modeConfig = chat.modeConfig;
    next.modeState = chat.modeState;
    next.runtimeSeed = chat.runtimeSeed;
    next.layeredMemories = chat.layeredMemories;
    next.runtimeTimeline = chat.runtimeTimeline;
    next.runtimeEventsV2 = chat.runtimeEventsV2;
    next.directorControls = chat.directorControls;
  }
  if (selection['chats.relationships']) {
    next.relationshipLedger = chat.relationshipLedger;
    next.governance = chat.governance;
    next.dramaRules = chat.dramaRules;
  }
  if (selection['chats.world']) next.worldState = chat.worldState;
  return next;
}

function createMessageBackupEntry(message: Record<string, unknown>, selection: BackupSelection) {
  const next: Record<string, unknown> = { chatId: message.chatId };
  if (selection['messages.content']) {
    Object.assign(next, {
      type: message.type,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      emotion: message.emotion,
      timestamp: message.timestamp,
      isDeleted: message.isDeleted,
    });
  }
  if (selection['messages.metadata']) next.metadata = message.metadata;
  return next;
}

function hasAnyEnabled(selection: BackupSelection, keys: BackupSectionKey[]) {
  return keys.some((key) => selection[key]);
}

function buildFullAvailabilitySelection(): BackupSelection {
  return BACKUP_KEY_ORDER.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, { ...EMPTY_BACKUP_SELECTION } as BackupSelection);
}

function buildLiveBackupStats(source: {
  characters: unknown[];
  chats: unknown[];
  messages: unknown[];
  settings: AppSettingsWithMemory;
}): BackupNodeStats {
  return collectNodeStats({
    characters: source.characters,
    chats: source.chats as Array<Record<string, unknown>>,
    messages: source.messages as Array<Record<string, unknown>>,
    settings: source.settings,
  });
}

function hasAnyOwnValue(record: Record<string, unknown>) {
  return Object.values(record).some((value) => value !== undefined);
}

function deriveAvailabilityFromTree(tree: BackupTreeNode[], selection: BackupSelection): BackupSelection {
  const next = { ...selection };
  const walk = (node: BackupTreeNode): boolean => {
    const self = Boolean(next[node.key]);
    const childAvailable = node.children?.map(walk) || [];
    const available = self || childAvailable.some(Boolean);
    if (node.children?.length) {
      next[node.key] = available;
    }
    return available;
  };
  tree.forEach(walk);
  return next;
}

function applyAvailability(selection: BackupSelection, availability: BackupSelection): BackupSelection {
  const next = BACKUP_KEY_ORDER.reduce((acc, key) => {
    acc[key] = availability[key] ? selection[key] : false;
    return acc;
  }, { ...EMPTY_BACKUP_SELECTION } as BackupSelection);
  return normalizeSelection(next, availability);
}

function buildRestoreAvailabilityFromData(data: BackupFileShape): BackupSelection {
  const stats = collectNodeStats(data);
  const hasCount = (key: BackupSectionKey) => (stats[key] || 0) > 0;
  const settingsAvailability = createSelection({
    settings: hasCount('settings') || hasSettingsData(data.settings),
    'settings.api': hasCount('settings.api') || Boolean(data.settings?.api),
    'settings.api.credentials': hasCount('settings.api.credentials') || Boolean(data.settings?.api?.apiKey),
    'settings.aiProfiles': hasCount('settings.aiProfiles') || (Array.isArray(data.settings?.aiProfiles) && data.settings.aiProfiles.length > 0),
    'settings.aiProfiles.credentials': hasCount('settings.aiProfiles.credentials') || Boolean(data.settings?.aiProfiles?.some((profile) => profile.apiKey)),
    'settings.appearance': hasCount('settings.appearance') || Boolean(data.settings && ('theme' in data.settings || 'themeColor' in data.settings || 'language' in data.settings || 'customBubbleStyles' in data.settings || 'userBubbleStyleId' in data.settings || 'userBubbleStyle' in data.settings || 'artifactAppearance' in data.settings)),
    'settings.generation': hasCount('settings.generation') || Boolean(data.settings && ('avatarGeneration' in data.settings || 'aiGeneration' in data.settings || 'companionship' in data.settings)),
    'settings.chatDraftDefaults': hasCount('settings.chatDraftDefaults') || Boolean(data.settings && ('defaultSpeed' in data.settings || 'chatDraftDefaults' in data.settings)),
    'settings.developer': hasCount('settings.developer') || Boolean(data.settings && ('developerMode' in data.settings || 'developerUI' in data.settings || 'memoryUI' in data.settings)),
    'settings.usageStats': hasCount('settings.usageStats') || Boolean(data.settings && 'usageStats' in data.settings),
  });
  const characters = hasCount('characters') || hasStructuredEntries(data.characters);
  const chats = hasCount('chats') || hasStructuredEntries(data.chats);
  const messages = hasCount('messages') || hasStructuredEntries(data.messages);
  const availability = createSelection();
  availability.characters = characters;
  availability['characters.core'] = hasCount('characters.core') || hasLeafData(data.characters, hasExportedCharacterCore);
  availability['characters.relationships'] = hasCount('characters.relationships') || hasLeafData(data.characters, (item) => 'relationships' in item);
  availability['characters.memory'] = hasCount('characters.memory') || hasLeafData(data.characters, (item) => 'memory' in item || 'layeredMemories' in item);
  availability['characters.visual'] = hasCount('characters.visual') || hasLeafData(data.characters, (item) => 'visualIdentity' in item || 'visualReferenceImages' in item || 'bubbleStyle' in item || 'bubbleStyleId' in item || 'speechProfile' in item || 'voiceConfig' in item);
  availability['characters.runtime'] = hasCount('characters.runtime') || hasLeafData(data.characters, (item) => 'runtimeTimeline' in item || 'emotionalState' in item || 'behavior' in item || 'personalityDrift' in item || 'coreProfile' in item || 'intervention' in item || 'generationPreferences' in item || 'characterDetailLoaded' in item || 'soulState' in item);
  availability['characters.modelBindings'] = hasCount('characters.modelBindings') || hasLeafData(data.characters, (item) => 'modelProfileId' in item || 'modelProfileIds' in item);
  availability.chats = chats;
  availability['chats.core'] = hasCount('chats.core') || hasLeafData(data.chats, hasExportedChatCore);
  availability['chats.runtime'] = hasCount('chats.runtime') || hasLeafData(data.chats, (item) => 'runtimeSeed' in item || 'runtimeTimeline' in item || 'runtimeEventsV2' in item || 'modeConfig' in item || 'modeState' in item || 'directorControls' in item || 'layeredMemories' in item);
  availability['chats.relationships'] = hasCount('chats.relationships') || hasLeafData(data.chats, (item) => 'relationshipLedger' in item || 'governance' in item || 'dramaRules' in item);
  availability['chats.world'] = hasCount('chats.world') || hasLeafData(data.chats, (item) => 'worldState' in item);
  availability.messages = messages;
  availability['messages.content'] = hasCount('messages.content') || hasLeafData(data.messages, hasExportedMessageContent);
  availability['messages.metadata'] = hasCount('messages.metadata') || hasLeafData(data.messages, (item) => 'metadata' in item);
  Object.assign(availability, settingsAvailability);
  return deriveAvailabilityFromTree(BACKUP_TREE, availability);
}

function buildRestoreSelectionFromAvailability(availability: BackupSelection): BackupSelection {
  return BACKUP_KEY_ORDER.reduce((acc, key) => {
    acc[key] = Boolean(availability[key]);
    return acc;
  }, { ...EMPTY_BACKUP_SELECTION } as BackupSelection);
}

function buildRestoreSelectionFromData(data: BackupFileShape): BackupSelection {
  return buildRestoreSelectionFromAvailability(buildRestoreAvailabilityFromData(data));
}

function describeSelection(_language: string, _mode: 'backup' | 'restore') {
  return '';
}

function buildDialogTreeBodySx() {
  return {
    mt: 1.25,
    maxHeight: 'min(62vh, 720px)',
    overflowY: 'auto' as const,
    pr: 0.5,
    borderRadius: 2,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.default',
    p: 1,
  };
}

function buildTreeHeaderSx() {
  return { mb: 1.25, lineHeight: 1.6 };
}

function buildTreeExpandButtonSx() {
  return { minWidth: 28, width: 28, height: 28, p: 0, borderRadius: 1, color: 'text.secondary' };
}

function buildTreeCheckboxSx() {
  return { p: 0.25, alignSelf: 'start', mt: 0.1 };
}

function buildTreeContentButtonSx(disabled: boolean) {
  return {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    textAlign: 'left' as const,
    textTransform: 'none',
    minWidth: 0,
    width: '100%',
    p: 0,
    color: disabled ? 'text.disabled' : 'text.primary',
    '&:hover': {
      bgcolor: 'transparent',
    },
  };
}

function buildTreeTitleRowSx() {
  return { display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 };
}

function buildTreeCountSx(disabled: boolean) {
  return { color: disabled ? 'text.disabled' : 'text.secondary', flexShrink: 0 };
}

function buildTreeNodeRowSx(level: number, disabled: boolean) {
  return {
    position: 'relative' as const,
    display: 'grid',
    gridTemplateColumns: '28px 28px minmax(0, 1fr)',
    alignItems: 'start',
    columnGap: 0.5,
    py: 0.6,
    pl: level * 1.25,
    borderRadius: 1.5,
    opacity: disabled ? 0.45 : 1,
    '&:hover': {
      bgcolor: disabled ? 'transparent' : 'action.hover',
    },
  };
}

function buildTreeLabelSx(disabled: boolean) {
  return { fontWeight: 700, lineHeight: 1.35, color: disabled ? 'text.disabled' : 'text.primary' };
}

function buildTreeDescriptionSx(_level: number, disabled: boolean) {
  return { mt: 0.2, lineHeight: 1.45, color: disabled ? 'text.disabled' : 'text.secondary' };
}

function buildTreeBranchSx(level: number) {
  return {
    ml: `calc(${level * 1.25}rem + 1.25rem)`,
    pl: 1.25,
    borderLeft: '1px dashed',
    borderColor: 'divider',
  };
}

function filterSettingsForRestore(data: NonNullable<BackupFileShape['settings']>, selection: BackupSelection): Partial<AppSettingsWithMemory> {
  const nextSettings: Partial<AppSettingsWithMemory> = {};
  if (selection['settings.api'] && data.api) {
    nextSettings.api = selection['settings.api.credentials'] ? data.api : { ...data.api, apiKey: '' };
  }
  if (selection['settings.aiProfiles'] && Array.isArray(data.aiProfiles)) {
    nextSettings.aiProfiles = selection['settings.aiProfiles.credentials'] ? data.aiProfiles : data.aiProfiles.map((profile) => ({ ...profile, apiKey: '' }));
  }
  if (selection['settings.appearance']) {
    if (data.theme !== undefined) nextSettings.theme = data.theme;
    if (data.themeColor !== undefined) nextSettings.themeColor = data.themeColor;
    if (data.language !== undefined) nextSettings.language = data.language;
    if (data.customBubbleStyles !== undefined) nextSettings.customBubbleStyles = data.customBubbleStyles;
    if (data.userBubbleStyleId !== undefined) nextSettings.userBubbleStyleId = data.userBubbleStyleId;
    if (data.userBubbleStyle !== undefined) nextSettings.userBubbleStyle = data.userBubbleStyle;
    if (data.artifactAppearance !== undefined) nextSettings.artifactAppearance = data.artifactAppearance;
  }
  if (selection['settings.generation']) {
    if (data.avatarGeneration !== undefined) nextSettings.avatarGeneration = data.avatarGeneration;
    if (data.aiGeneration !== undefined) nextSettings.aiGeneration = data.aiGeneration;
    if (data.companionship !== undefined) nextSettings.companionship = data.companionship;
  }
  if (selection['settings.chatDraftDefaults']) {
    if (data.defaultSpeed !== undefined) nextSettings.defaultSpeed = data.defaultSpeed;
    if (data.chatDraftDefaults !== undefined) nextSettings.chatDraftDefaults = data.chatDraftDefaults;
  }
  if (selection['settings.developer']) {
    if (data.developerMode !== undefined) nextSettings.developerMode = data.developerMode;
    if (data.developerUI !== undefined) nextSettings.developerUI = data.developerUI;
    if (data.memoryUI !== undefined) nextSettings.memoryUI = data.memoryUI;
  }
  if (selection['settings.usageStats'] && data.usageStats !== undefined) nextSettings.usageStats = data.usageStats;
  return nextSettings;
}

const BACKUP_TREE: BackupTreeNode[] = [
  {
    key: 'characters',
    labelZh: '角色',
    labelEn: 'Characters',
    descriptionZh: '角色相关数据',
    descriptionEn: 'Character-related data',
    children: [
      { key: 'characters.core', labelZh: '基础资料', labelEn: 'Core profile', descriptionZh: '名称、头像、人格、专长、背景、创建时间等', descriptionEn: 'Name, avatar, personality, expertise, background, timestamps' },
      { key: 'characters.relationships', labelZh: '关系数据', labelEn: 'Relationships', descriptionZh: '角色关系账本与关系条目', descriptionEn: 'Relationship ledgers and entries' },
      { key: 'characters.memory', labelZh: '记忆数据', labelEn: 'Memories', descriptionZh: '长期记忆、分层记忆、记忆摘要等', descriptionEn: 'Long-term memories, layered memories, summaries' },
      { key: 'characters.visual', labelZh: '视觉与表达', labelEn: 'Visual & expression', descriptionZh: '视觉设定、参考图、气泡、语音与说话档案', descriptionEn: 'Visual identity, references, bubbles, voice, speech profile' },
      { key: 'characters.runtime', labelZh: '运行态与偏好', labelEn: 'Runtime & preferences', descriptionZh: '情绪、行为、运行时间线、干预与生成偏好', descriptionEn: 'Emotion, behavior, runtime timeline, interventions, generation prefs' },
      { key: 'characters.modelBindings', labelZh: '模型绑定', labelEn: 'Model bindings', descriptionZh: '角色绑定的模型档案', descriptionEn: 'Model profile bindings for characters' },
    ],
  },
  {
    key: 'chats',
    labelZh: '聊天',
    labelEn: 'Chats',
    descriptionZh: '聊天与会话数据',
    descriptionEn: 'Chat and session data',
    children: [
      { key: 'chats.core', labelZh: '基础信息', labelEn: 'Core info', descriptionZh: '名称、类型、成员、主题、速度、删除状态等', descriptionEn: 'Name, type, members, topic, speed, deletion state' },
      { key: 'chats.runtime', labelZh: '运行态', labelEn: 'Runtime state', descriptionZh: '模式配置、运行种子、时间线、事件、导演控制等', descriptionEn: 'Mode config, runtime seeds, timeline, events, director controls' },
      { key: 'chats.relationships', labelZh: '治理与关系', labelEn: 'Governance & relationships', descriptionZh: '关系账本、治理规则、戏剧规则等', descriptionEn: 'Relationship ledgers, governance, drama rules' },
      { key: 'chats.world', labelZh: '世界状态', labelEn: 'World state', descriptionZh: '世界状态与公共运行态摘要', descriptionEn: 'World state and public runtime summaries' },
    ],
  },
  {
    key: 'messages',
    labelZh: '消息',
    labelEn: 'Messages',
    descriptionZh: '消息历史',
    descriptionEn: 'Message history',
    children: [
      { key: 'messages.content', labelZh: '消息正文', labelEn: 'Content', descriptionZh: '消息内容、发送者、时间、情绪', descriptionEn: 'Content, sender, timestamp, emotion' },
      { key: 'messages.metadata', labelZh: '消息元数据', labelEn: 'Metadata', descriptionZh: '富媒体、结构化元数据等', descriptionEn: 'Rich media and structured metadata' },
    ],
  },
  {
    key: 'settings',
    labelZh: '设置',
    labelEn: 'Settings',
    descriptionZh: '应用与模型设置',
    descriptionEn: 'App and model settings',
    children: [
      {
        key: 'settings.api', labelZh: '默认模型配置', labelEn: 'Default model config', descriptionZh: '默认提供商、模型、接口地址', descriptionEn: 'Default provider, model, and endpoint', children: [
          { key: 'settings.api.credentials', labelZh: '默认模型密钥', labelEn: 'Default model key', descriptionZh: '默认模型 API 密钥明文', descriptionEn: 'Plaintext API key for the default model' },
        ],
      },
      {
        key: 'settings.aiProfiles', labelZh: '模型档案', labelEn: 'Model profiles', descriptionZh: '文本/图片/语音/文档模型档案', descriptionEn: 'Text/image/audio/document model profiles', children: [
          { key: 'settings.aiProfiles.credentials', labelZh: '档案密钥', labelEn: 'Profile keys', descriptionZh: '各模型档案的 API 密钥明文', descriptionEn: 'Plaintext API keys for model profiles' },
        ],
      },
      { key: 'settings.appearance', labelZh: '外观与界面', labelEn: 'Appearance & UI', descriptionZh: '主题、颜色、语言、用户气泡、信纸样式、自定义气泡', descriptionEn: 'Theme, color, language, user bubble, letter background, custom bubbles' },
      { key: 'settings.generation', labelZh: '生成与陪伴', labelEn: 'Generation & companionship', descriptionZh: '头像生成、朋友圈、日记、主动陪伴等', descriptionEn: 'Avatar generation, moments, diaries, proactive companionship' },
      { key: 'settings.chatDraftDefaults', labelZh: '聊天默认行为', labelEn: 'Chat defaults', descriptionZh: '默认聊天草稿与群聊变化强度', descriptionEn: 'Default chat draft behavior and evolution intensity' },
      { key: 'settings.developer', labelZh: '开发者与调试', labelEn: 'Developer & debug', descriptionZh: '开发者模式、调试面板、记忆调试开关', descriptionEn: 'Developer mode, debug panels, memory debug toggles' },
      { key: 'settings.usageStats', labelZh: '使用统计', labelEn: 'Usage stats', descriptionZh: '本地使用统计与计数', descriptionEn: 'Local usage stats and counters' },
    ],
  },
];

const BACKUP_ROOT_KEYS: BackupSectionKey[] = ['characters', 'chats', 'messages', 'settings'];

const DEFAULT_EXPANDED_KEYS: BackupSectionKey[] = ['characters', 'chats', 'messages', 'settings', 'settings.api', 'settings.aiProfiles'];
const RAW_FULL_BACKUP_AVAILABILITY = buildFullAvailabilitySelection();
const FULL_BACKUP_AVAILABILITY = deriveAvailabilityFromTree(BACKUP_TREE, RAW_FULL_BACKUP_AVAILABILITY);

function getPaperVariantLabel(variant: PaperSurfaceVariant, language: string) {
  const zh: Record<PaperSurfaceVariant, string> = {
    lined: '横线纸',
    plain: '素纸',
    letter: '信纸',
    night: '夜色',
  };
  const en: Record<PaperSurfaceVariant, string> = {
    lined: 'Lined',
    plain: 'Plain',
    letter: 'Letter',
    night: 'Night',
  };
  return language.startsWith('zh') ? zh[variant] : en[variant];
}

function buildPaperPreviewSx(variant: PaperSurfaceVariant) {
  const shared = {
    width: '100%',
    aspectRatio: '1.45 / 1',
    minHeight: 74,
    maxHeight: 112,
    borderRadius: 1.25,
    overflow: 'hidden',
    position: 'relative',
    border: '1px solid',
  };
  const variants: Record<PaperSurfaceVariant, object> = {
    lined: {
      ...shared,
      borderColor: 'rgba(180, 150, 90, 0.34)',
      bgcolor: '#fffdf4',
      backgroundImage: 'linear-gradient(rgba(90, 120, 170, 0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(180, 80, 70, 0.24) 1px, transparent 1px)',
      backgroundSize: '100% 12px, 20px 100%',
      backgroundPosition: '0 12px, 18px 0',
    },
    plain: {
      ...shared,
      borderColor: 'rgba(190, 176, 138, 0.42)',
      bgcolor: '#fffaf0',
      backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.75), rgba(245,232,198,0.42))',
    },
    letter: {
      ...shared,
      borderColor: 'rgba(128, 96, 54, 0.34)',
      bgcolor: '#fbf3df',
      backgroundImage: 'linear-gradient(rgba(94, 70, 38, 0.08) 1px, transparent 1px), radial-gradient(circle at 18% 14%, rgba(255,255,255,0.62), transparent 36%), linear-gradient(135deg, rgba(130, 88, 36, 0.14), transparent 46%)',
      backgroundSize: '100% 13px, 100% 100%, 100% 100%',
      backgroundPosition: '0 14px, 0 0, 0 0',
    },
    night: {
      ...shared,
      borderColor: 'rgba(139, 164, 203, 0.42)',
      bgcolor: '#202632',
      backgroundImage: 'linear-gradient(rgba(174, 196, 230, 0.15) 1px, transparent 1px), linear-gradient(135deg, rgba(71, 88, 121, 0.52), rgba(32, 38, 50, 0.95))',
      backgroundSize: '100% 12px, 100% 100%',
      backgroundPosition: '0 12px, 0 0',
    },
  };
  return variants[variant];
}

function BackupTreeSection({
  nodes,
  selection,
  availability,
  stats,
  expandedKeys,
  onToggleExpand,
  onToggleCheck,
  language,
  level = 0,
}: {
  nodes: BackupTreeNode[];
  selection: BackupSelection;
  availability: BackupSelection;
  stats?: BackupNodeStats;
  expandedKeys: BackupSectionKey[];
  onToggleExpand: (key: BackupSectionKey) => void;
  onToggleCheck: (key: BackupSectionKey, checked: boolean) => void;
  language: string;
  level?: number;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 0.15 }}>
      {nodes.map((node) => {
        const state = getNodeCheckState(node, selection, availability);
        const expanded = expandedKeys.includes(node.key);
        const disabled = !isNodeAvailable(node, availability);
        const toggleChecked = !state.checked || state.indeterminate;
        const showExpandButton = Boolean(node.children?.length);
        return (
          <Box key={node.key}>
            <Box
              sx={buildTreeNodeRowSx(level, disabled)}
              onClick={() => {
                if (!disabled) onToggleCheck(node.key, toggleChecked);
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 0.15 }}>
                {showExpandButton ? (
                  <Button
                    size="small"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleExpand(node.key);
                    }}
                    sx={buildTreeExpandButtonSx()}
                  >
                    {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                  </Button>
                ) : <Box sx={buildTreeExpandPlaceholderSx()} />}
              </Box>
              <Checkbox
                checked={state.checked}
                indeterminate={state.indeterminate}
                disabled={disabled}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onToggleCheck(node.key, event.target.checked)}
                sx={buildTreeCheckboxSx()}
              />
              <Button
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCheck(node.key, toggleChecked);
                }}
                sx={buildTreeRowButtonSx(disabled)}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={buildTreeTitleRowSx()}>
                    <Typography variant="body2" sx={buildTreeLabelSx(disabled)}>
                      {formatNodeLabel(node, language)}
                    </Typography>
                    {shouldShowNodeCount(node, level, stats) ? (
                      <Typography variant="caption" sx={buildTreeCountSx(disabled)}>
                        ({shouldShowNodeCount(node, level, stats)})
                      </Typography>
                    ) : null}
                  </Box>
                  <Typography variant="caption" sx={buildTreeDescriptionSx(level, disabled)}>
                    {language.startsWith('zh') ? node.descriptionZh : node.descriptionEn}
                  </Typography>
                </Box>
              </Button>
            </Box>
            {node.children?.length ? (
              <Collapse in={expanded} timeout="auto" unmountOnExit>
                <Box sx={buildTreeBranchSx(level)}>
                  <BackupTreeSection
                    nodes={node.children}
                    selection={selection}
                    availability={availability}
                    stats={stats}
                    expandedKeys={expandedKeys}
                    onToggleExpand={onToggleExpand}
                    onToggleCheck={onToggleCheck}
                    language={language}
                    level={level + 1}
                  />
                </Box>
              </Collapse>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettingsStore();
  const compactBubbleMode = settings.compactBubbleMode;
  const compactPrivateBubbleMode = settings.compactPrivateBubbleMode;
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const [userBubblePickerOpen, setUserBubblePickerOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [backupSelection, setBackupSelection] = useState<BackupSelection>(DEFAULT_BACKUP_SELECTION);
  const [restoreSelection, setRestoreSelection] = useState<BackupSelection>(DEFAULT_BACKUP_SELECTION);
  const [restoreAvailability, setRestoreAvailability] = useState<BackupSelection>(DISABLED_BACKUP_SELECTION);
  const [restoreStats, setRestoreStats] = useState<BackupNodeStats>({});
  const [restoreData, setRestoreData] = useState<BackupFileShape | null>(null);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restoreEmptyHint, setRestoreEmptyHint] = useState('');
  const [expandedBackupKeys, setExpandedBackupKeys] = useState<BackupSectionKey[]>(DEFAULT_EXPANDED_KEYS);
  const [expandedRestoreKeys, setExpandedRestoreKeys] = useState<BackupSectionKey[]>(DEFAULT_EXPANDED_KEYS);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const userBubbleStyle = useMemo(
    () => resolveCharacterBubbleStyle({
      bubbleStyle: settings.userBubbleStyle,
      bubbleStyleId: settings.userBubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID,
      customStyles: settings.customBubbleStyles || [],
    }),
    [settings.customBubbleStyles, settings.userBubbleStyle, settings.userBubbleStyleId]
  );
  const userBubblePreview = useMemo(() => buildBubblePreview(userBubbleStyle, true), [userBubbleStyle]);
  const selfAvatarValue = user?.avatar?.trim() || (user?.nickname?.trim() || '我').slice(0, 1);
  const selfAvatarIsImage = isImageAvatar(selfAvatarValue);
  const selfBubblePreviewText = i18n.language.startsWith('zh') ? '这是我发送消息时的气泡' : 'This is my chat bubble';
  const backupStats = useMemo(() => buildLiveBackupStats({
    characters: useCharacterStore.getState().characters,
    chats: useChatStore.getState().chats,
    messages: Object.values(useMessageStore.getState().messageWindowsByChatId).flatMap((window) => window.messages),
    settings,
  }), [settings]);

  const handleBackup = () => {
    setBackupSelection(DEFAULT_BACKUP_SELECTION);
    setExpandedBackupKeys(DEFAULT_EXPANDED_KEYS);
    setBackupDialogOpen(true);
  };

  const handleConfirmBackup = async () => {
    try {
      const characterStore = useCharacterStore.getState();
      const chatStore = useChatStore.getState();
      const messageStore = useMessageStore.getState();

      await Promise.all([
        characterStore.loadCharacters(),
        chatStore.loadChats(),
      ]);

      const refreshedCharacterStore = useCharacterStore.getState();
      const refreshedChatStore = useChatStore.getState();
      const messageWindows = useMessageStore.getState().messageWindowsByChatId;
      const allMessages = Object.values(messageWindows).flatMap((window) => window.messages);

      if (allMessages.length === 0) {
        await Promise.all(
          refreshedChatStore.chats.map((chat) => messageStore.loadMessages(chat.id).catch(() => undefined))
        );
      }

      const finalCharacterStore = useCharacterStore.getState();
      const finalChatStore = useChatStore.getState();
      const finalMessages = Object.values(useMessageStore.getState().messageWindowsByChatId)
        .flatMap((window) => window.messages);

      const data = buildBackupPayload(backupSelection, {
        characters: finalCharacterStore.characters.map((character) => createCharacterBackupEntry(character as unknown as Record<string, unknown>, backupSelection)).filter((item) => hasAnyOwnValue(item)),
        chats: finalChatStore.chats.map((chat) => createChatBackupEntry(chat as unknown as Record<string, unknown>, backupSelection)).filter((item) => hasAnyOwnValue(item)),
        messages: finalMessages.map((message) => createMessageBackupEntry(message as unknown as Record<string, unknown>, backupSelection)).filter((item) => hasAnyOwnValue(item)),
        settings,
      });

      const stats = collectNodeStats(data);
      const hasPayload = Boolean((stats.characters || 0) + (stats.chats || 0) + (stats.messages || 0) + (stats.settings || 0));
      if (!hasPayload) {
        setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '当前没有可导出的数据，请先等待数据加载完成。' : 'No exportable data is currently loaded. Please wait for data to finish loading.' , severity: 'error' });
        return;
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pneumata-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupDialogOpen(false);
      setSnackbar({ open: true, message: t('settings.backupSuccess'), severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' });
    }
  };

  const handleRestore = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as BackupFileShape;
        const nextRestoreState = buildInitialRestoreState(data, i18n.language);
        setRestoreData(data);
        setRestoreFileName(file.name);
        setRestoreEmptyHint(nextRestoreState.emptyHint);
        setRestoreAvailability(nextRestoreState.availability);
        setRestoreStats(nextRestoreState.stats);
        setRestoreSelection(nextRestoreState.selection);
        setExpandedRestoreKeys(DEFAULT_EXPANDED_KEYS);
        setRestoreDialogOpen(true);
      } catch {
        setSnackbar({ open: true, message: t('common.error'), severity: 'error' });
      }
    };
    input.click();
  };

  const handleConfirmRestore = async () => {
    if (!restoreData) return;
    try {
      const existingCharacters = await api.getCharacters();
      const existingCharacterNames = new Set(
        existingCharacters
          .filter((character) => !character.isPreset)
          .map((character) => character.name.trim().toLowerCase())
          .filter(Boolean),
      );
      if (restoreSelection.characters && Array.isArray(restoreData.characters)) {
        for (const c of restoreData.characters) {
          if (!c || typeof c !== 'object' || (c as { isPreset?: boolean }).isPreset || typeof (c as { name?: unknown }).name !== 'string') continue;
          const normalizedName = (c as { name: string }).name.trim().toLowerCase();
          if (!normalizedName || existingCharacterNames.has(normalizedName)) continue;
          try {
            await api.createCharacter(c as Record<string, unknown> as Parameters<typeof api.createCharacter>[0]);
            existingCharacterNames.add(normalizedName);
          } catch (error) {
            if (error instanceof ApiError && error.code === 'DUPLICATE_CHARACTER_NAME') {
              existingCharacterNames.add(normalizedName);
              continue;
            }
            throw error;
          }
        }
      }
      if (restoreSelection.chats && Array.isArray(restoreData.chats)) {
        for (const chat of restoreData.chats) {
          if (typeof chat.name !== 'string' || !Array.isArray(chat.memberIds)) continue;
          const created = await api.createChat(chat as Parameters<typeof api.createChat>[0]);
          const createdChatId = (created as { id: string }).id;
          if (restoreSelection.messages && Array.isArray(restoreData.messages)) {
            const originalChatId = typeof chat?.id === 'string' ? chat.id : null;
            const chatMessages = originalChatId ? restoreData.messages.filter((m) => m.chatId === originalChatId) : [];
            for (const msg of chatMessages) {
              if (typeof msg.type !== 'string' || typeof msg.senderId !== 'string' || typeof msg.senderName !== 'string' || typeof msg.content !== 'string') continue;
              await api.createMessage(createdChatId, {
                type: msg.type,
                senderId: msg.senderId,
                senderName: msg.senderName,
                content: msg.content,
                emotion: typeof msg.emotion === 'number' ? msg.emotion : undefined,
                metadata: msg.metadata,
                timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : undefined,
              });
            }
          }
        }
      }
      if (restoreSelection.settings && restoreData.settings && typeof restoreData.settings === 'object') {
        const nextSettings = filterSettingsForRestore(restoreData.settings, restoreSelection);
        if (Object.keys(nextSettings).length) {
          useSettingsStore.setState((state) => ({
            ...state,
            ...nextSettings,
            _loaded: true,
            syncStatus: 'idle',
            syncError: null,
          }));
        }
      }
      const characterStore = useCharacterStore.getState();
      const chatStore = useChatStore.getState();
      characterStore.markCharactersWarm();
      chatStore.markChatsWarm();
      void characterStore.prefetchCharacters();
      void chatStore.prefetchChats();
      setRestoreDialogOpen(false);
      setRestoreData(null);
      setSnackbar({ open: true, message: t('settings.restoreSuccess'), severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' });
    }
  };

  const handleClearAll = async () => {
    try {
      const chatStore = useChatStore.getState();
      const characterStore = useCharacterStore.getState();
      const chats = chatStore.chats;
      for (const chat of chats) {
        await chatStore.deleteChat(chat.id);
      }
      const customCharacterIds = characterStore.characters
        .filter((char) => !char.isPreset)
        .map((char) => char.id);
      if (customCharacterIds.length) {
        await characterStore.deleteCharacters(customCharacterIds);
      }
      settings.resetSettings();
      characterStore.markCharactersWarm();
      chatStore.markChatsWarm();
      void characterStore.prefetchCharacters();
      void chatStore.prefetchChats();
      setClearConfirm(false);
      setSnackbar({ open: true, message: t('common.success'), severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' });
    }
  };

  const handleLanguageChange = (lang: 'zh' | 'en') => {
    settings.setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  const handleBrandStorageMigration = () => {
    const result = migrateLegacyBrandStorageKeys();
    const message = i18n.language.startsWith('zh')
      ? `迁移完成：搬迁 ${result.moved} 项，删除旧 key ${result.removed} 项，跳过 ${result.skipped} 项。页面即将刷新。`
      : `Migration complete: moved ${result.moved}, removed ${result.removed} old key(s), skipped ${result.skipped}. Reloading.`;
    setSnackbar({ open: true, message, severity: 'success' });
    window.setTimeout(() => window.location.reload(), 800);
  };

  const developerToolsSection = settings.developerMode ? (
    <SurfaceCard contentSx={buildCardBodySx()}>
      <Box sx={buildDeveloperBodySx()}>
        <SectionHeader
          title={i18n.language.startsWith('zh') ? '开发者工具' : 'Developer Tools'}
          subtitle={i18n.language.startsWith('zh')
            ? '这些开关用于排查运行逻辑，会显示事件、证据、分数和调试提示。普通使用可以保持关闭。'
            : 'These switches expose events, evidence, metrics, and debug hints for runtime inspection. Leave them off for everyday use.'}
        />
        <StatChipRow items={buildDeveloperChips(i18n.language)} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'auto minmax(0, 1fr)' }, gap: 1.25, alignItems: 'center', p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
          <Button startIcon={<SyncIcon />} size="small" variant="outlined" onClick={handleBrandStorageMigration} sx={{ justifySelf: 'start', width: 'fit-content', px: 1.25, whiteSpace: 'nowrap' }}>
            {i18n.language.startsWith('zh') ? '迁移旧本地数据' : 'Migrate old local data'}
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            {i18n.language.startsWith('zh')
              ? '把旧品牌前缀的本地存储和临时草稿一次性搬到 Pneumata 前缀，完成后刷新页面重新加载。'
              : 'Move old brand-prefixed local storage and session drafts to the Pneumata prefix, then reload.'}
          </Typography>
        </Box>
        <Box sx={buildDeveloperSwitchGroupsSx()}>
          <Box sx={buildDeveloperSwitchGroupSx()}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {i18n.language.startsWith('zh') ? '事件提示' : 'Event hints'}
            </Typography>
            <Box sx={buildDeveloperSwitchListSx()}>
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showRelationshipEvents} onChange={(e) => settings.setDeveloperUI({ showRelationshipEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '角色关系事件' : 'Character relationship events'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showAffectEvents} onChange={(e) => settings.setDeveloperUI({ showAffectEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '情绪与人格漂移事件' : 'Emotion and drift events'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showStateEvents} onChange={(e) => settings.setDeveloperUI({ showStateEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '房间态势事件' : 'Room state events'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showMemoryDistillationEvents} onChange={(e) => settings.setDeveloperUI({ showMemoryDistillationEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '记忆蒸馏事件' : 'Memory distillation events'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showCalendarEvents} onChange={(e) => settings.setDeveloperUI({ showCalendarEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '日历活动事件' : 'Calendar activity events'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showLocalInterceptionHints} onChange={(e) => settings.setDeveloperUI({ showLocalInterceptionHints: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示拦截提示' : 'Show interception hints'} />
            </Box>
          </Box>
          <Box sx={buildDeveloperSwitchGroupSx()}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {i18n.language.startsWith('zh') ? '面板与证据' : 'Panels and evidence'}
            </Typography>
            <Box sx={buildDeveloperSwitchListSx()}>
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showSpeechStyle} onChange={(e) => settings.setDeveloperUI({ showSpeechStyle: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '发言风格面板' : 'Speech style panel'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showAdvancedRuntimePanels} onChange={(e) => settings.setDeveloperUI({ showAdvancedRuntimePanels: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '高级运行面板' : 'Advanced runtime panels'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showMemoryDebug} onChange={(e) => settings.setDeveloperUI({ showMemoryDebug: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '记忆证据与参数' : 'Memory evidence and metrics'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showCompanionshipDebug} onChange={(e) => settings.setDeveloperUI({ showCompanionshipDebug: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '陪伴运行诊断' : 'Companionship diagnostics'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showConflictEvents} onChange={(e) => settings.setDeveloperUI({ showConflictEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '矛盾焦点与发展钩子' : 'Conflict focus and development hooks'} />
            </Box>
          </Box>
          <Box sx={buildDeveloperSwitchGroupSx()}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {i18n.language.startsWith('zh') ? '交互与实验' : 'Interaction and experiments'}
            </Typography>
            <Box sx={buildDeveloperSwitchListSx()}>
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showWithdrawnMessageContent} onChange={(e) => settings.setDeveloperUI({ showWithdrawnMessageContent: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '悬浮查看撤回原文' : 'Reveal withdrawn content on hover'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.showMomentDebug} onChange={(e) => settings.setDeveloperUI({ showMomentDebug: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '朋友圈调试' : 'Moments debug'} />
              <FormControlLabel control={<Switch size="small" checked={settings.developerUI.dramaBoost} onChange={(e) => settings.setDeveloperUI({ dramaBoost: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '增强戏剧冲突' : 'Boost dramatic conflict'} />
            </Box>
          </Box>
        </Box>
      </Box>
    </SurfaceCard>
  ) : null;

  return (
    <Box sx={buildPageSx()}>
      <PageSection spacing={2.25}>
        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildTopRowSx()}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{i18n.language.startsWith('zh') ? '账号' : 'Account'}</Typography>
              <Typography variant="body2" color="text.secondary">{authMode === 'local' ? (i18n.language.startsWith('zh') ? '离线本地模式 · 未登录' : 'Local-only mode · Not signed in') : `${user?.nickname || '-'} · ${user?.phone || '-'}`}</Typography>
            </Box>
            <Button variant="outlined" onClick={() => navigate('/account')}>{authMode === 'local' ? (i18n.language.startsWith('zh') ? '登录并同步' : 'Sign in & sync') : (i18n.language.startsWith('zh') ? '查看' : 'Open')}</Button>
          </Box>
          <Box sx={buildAccountBubblePreviewSx()} onClick={() => setUserBubblePickerOpen(true)}>
            <Box sx={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', bgcolor: 'action.hover', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
              {selfAvatarIsImage ? <Box component="img" src={selfAvatarValue} alt={user?.nickname || 'me'} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : selfAvatarValue}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>{i18n.language.startsWith('zh') ? '我的气泡' : 'My bubble'}</Typography>
              <Box sx={{ width: 'fit-content', maxWidth: '100%', px: 1.35, py: 0.85, border: userBubblePreview.border, borderRadius: userBubblePreview.borderRadius, boxShadow: userBubblePreview.boxShadow, color: userBubblePreview.color, background: userBubblePreview.background }}>
                <Typography variant="body2" noWrap>{selfBubblePreviewText}</Typography>
              </Box>
            </Box>
            <Button size="small" variant="text" startIcon={<EditIcon fontSize="small" />} sx={{ flexShrink: 0 }}>
              {i18n.language.startsWith('zh') ? '设置' : 'Set'}
            </Button>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildTopRowSx()}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{i18n.language.startsWith('zh') ? 'AI模型' : 'AI Models'}</Typography>
            </Box>
            <Button variant="outlined" onClick={() => navigate('/models')}>{i18n.language.startsWith('zh') ? '管理' : 'Manage'}</Button>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={t('settings.appearance')} />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{t('settings.theme')}</Typography>
              <ToggleButtonGroup value={settings.theme} exclusive onChange={(_, v) => v && settings.setTheme(v)} size="small" sx={buildToggleGroupSx()}>
                <ToggleButton value="light">{t('settings.themeLight')}</ToggleButton>
                <ToggleButton value="dark">{t('settings.themeDark')}</ToggleButton>
                <ToggleButton value="system">{t('settings.themeSystem')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '色调' : 'Tone'}</Typography>
              <Box sx={buildToneGridSx()}>
                {THEME_TONES.map((tone) => {
                  const selected = settings.themeColor.toLowerCase() === tone.value.toLowerCase();
                  return (
                    <Button
                      key={tone.value}
                      variant="outlined"
                      onClick={() => settings.setThemeColor(tone.value)}
                      sx={buildToneButtonSx(tone.value, selected)}
                    >
                      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: tone.value, mr: 1, display: 'grid', placeItems: 'center', color: '#fff', flex: '0 0 auto', boxShadow: `0 0 0 4px ${tone.value}18` }}>
                        {selected ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
                      </Box>
                      <Typography variant="caption" sx={{ fontWeight: selected ? 760 : 620, lineHeight: 1.25 }}>
                        {i18n.language.startsWith('zh') ? tone.zh : tone.en}
                      </Typography>
                    </Button>
                  );
                })}
              </Box>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{t('settings.language')}</Typography>
              <ToggleButtonGroup value={settings.language} exclusive onChange={(_, v) => v && handleLanguageChange(v)} size="small" sx={buildToggleGroupSx()}>
                <ToggleButton value="zh">中文</ToggleButton>
                <ToggleButton value="en">English</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '信件背景' : 'Letter background'}</Typography>
              <ToggleButtonGroup value={settings.artifactAppearance.paperVariant} exclusive onChange={(_, v) => v && settings.setArtifactAppearance({ paperVariant: v })} size="small" sx={buildPaperPickerSx()}>
                {PAPER_SURFACE_VARIANTS.map((variant) => (
                  <ToggleButton key={variant} value={variant} sx={buildPaperToggleSx()}>
                    <Box sx={buildPaperPreviewSx(variant)} />
                    <Typography variant="caption" sx={{ fontWeight: 650 }}>{getPaperVariantLabel(variant, i18n.language)}</Typography>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              <FormControlLabel
                sx={{ m: 0 }}
                control={<Switch checked={compactBubbleMode} onChange={(e) => settings.setCompactBubbleMode(e.target.checked)} />}
                label={
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <span>{i18n.language.startsWith('zh') ? '简洁模式' : 'Compact bubble mode'}</span>
                    <Tooltip title={i18n.language.startsWith('zh') ? '除自己发送和话题引导外，其余消息统一显示为默认白底黑字。以角色身份发送仍按角色气泡显示。' : 'All bubbles except your own messages and topic guidance use the default white bubble. Speaking as a character still keeps the character bubble.'}>
                      <HelpOutlineIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                    </Tooltip>
                  </Box>
                }
              />
              <FormControlLabel
                sx={{ m: 0 }}
                control={<Switch checked={compactPrivateBubbleMode} onChange={(e) => settings.setCompactPrivateBubbleMode(e.target.checked)} />}
                label={
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <span>{i18n.language.startsWith('zh') ? '私聊简洁模式' : 'Compact private bubbles'}</span>
                    <Tooltip title={i18n.language.startsWith('zh') ? '在单聊和 AI 私聊里不显示彩色角色气泡，统一使用默认白底黑字。' : 'Direct and AI-private chats use default white bubbles instead of colored character bubbles.'}>
                      <HelpOutlineIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                    </Tooltip>
                  </Box>
                }
              />
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={i18n.language.startsWith('zh') ? 'AI生成' : 'AI Generation'} subtitle={i18n.language.startsWith('zh') ? '控制头像、朋友圈与日记等自动生成能力' : 'Control avatar, moments, and diary generation behaviors'} />
            <Box sx={{ display: 'grid', gap: 1 }}>
              <FormControlLabel control={<Switch checked={settings.avatarGeneration.autoGenerateCharacterAvatar} onChange={(e) => settings.setAutoGenerateCharacterAvatar(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '自动生成角色头像' : 'Auto-generate character avatars'} />
              <FormControlLabel control={<Switch checked={settings.avatarGeneration.preferNonPhotorealAvatar} onChange={(e) => settings.setAvatarGeneration({ preferNonPhotorealAvatar: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '非写实头像' : 'Non-photoreal avatars'} />
              <FormControlLabel control={<Switch checked={settings.aiGeneration.enableMoments} onChange={(e) => settings.setAIGeneration({ enableMoments: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '启用朋友圈自动生成' : 'Enable moments auto-generation'} />
              <FormControlLabel control={<Switch checked={settings.aiGeneration.enableDiaries} onChange={(e) => settings.setAIGeneration({ enableDiaries: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '启用日记自动生成' : 'Enable diary auto-generation'} />
              <FormControlLabel control={<Switch checked={settings.companionship.enableProactiveCare} onChange={(e) => settings.setCompanionship({ enableProactiveCare: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '启用主动陪伴' : 'Enable proactive companionship'} />
              <FormControlLabel control={<Switch checked={settings.companionship.showStatusHints} onChange={(e) => settings.setCompanionship({ showStatusHints: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示陪伴状态提示' : 'Show companionship status hints'} />
              <FormControlLabel control={<Switch checked={settings.companionship.enableAttachmentAdaptation} onChange={(e) => settings.setCompanionship({ enableAttachmentAdaptation: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '启用互动模式适配' : 'Enable interaction-pattern adaptation'} />
              <FormControlLabel control={<Switch checked={settings.companionship.enableRelationshipRituals} onChange={(e) => settings.setCompanionship({ enableRelationshipRituals: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '启用关系仪式' : 'Enable relationship rituals'} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', opacity: settings.companionship.enableRelationshipRituals ? 1 : 0.55 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, mr: 0.25 }}>{i18n.language.startsWith('zh') ? '仪式类型' : 'Ritual types'}</Typography>
                {RITUAL_KIND_OPTIONS.map((option) => {
                  const enabled = settings.companionship.ritualKindToggles[option.kind] !== false;
                  return (
                    <Chip
                      key={option.kind}
                      size="small"
                      label={i18n.language.startsWith('zh') ? option.zh : option.en}
                      color={enabled ? 'primary' : 'default'}
                      variant={enabled ? 'filled' : 'outlined'}
                      disabled={!settings.companionship.enableRelationshipRituals}
                      onClick={() => settings.setCompanionship({
                        ritualKindToggles: {
                          ...settings.companionship.ritualKindToggles,
                          [option.kind]: !enabled,
                        },
                      })}
                      sx={{ height: 26, borderRadius: 999 }}
                    />
                  );
                })}
              </Box>
              <FormControlLabel control={<Switch checked={settings.companionship.enableCharacterPrivateThreads} onChange={(e) => settings.setCompanionship({ enableCharacterPrivateThreads: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '启用角色陪伴 AI 私聊' : 'Enable character companionship AI private threads'} />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '陪伴敏感边界' : 'Companionship sensitivity boundary'}</Typography>
                  <ToggleButtonGroup value={settings.companionship.sensitiveBoundaryMode} exclusive onChange={(_, v) => v && settings.setCompanionship({ sensitiveBoundaryMode: v })} size="small" sx={buildToggleGroupSx()}>
                    <ToggleButton value="normal">{i18n.language.startsWith('zh') ? '正常' : 'Normal'}</ToggleButton>
                    <ToggleButton value="restrained">{i18n.language.startsWith('zh') ? '克制' : 'Restrained'}</ToggleButton>
                    <ToggleButton value="off">{i18n.language.startsWith('zh') ? '关闭' : 'Off'}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '主动冷却（分钟）' : 'Proactive cooldown (min)'}</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 0.75 }}>
                    <TextField type="number" size="small" label={i18n.language.startsWith('zh') ? '私聊' : 'Check-in'} value={settings.companionship.proactiveCooldownMinutes.checkIn} onChange={(e) => settings.setCompanionship({ proactiveCooldownMinutes: { ...settings.companionship.proactiveCooldownMinutes, checkIn: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} slotProps={{ htmlInput: { min: 0, max: 1440, step: 1 } }} />
                    <TextField type="number" size="small" label={i18n.language.startsWith('zh') ? '动态' : 'React'} value={settings.companionship.proactiveCooldownMinutes.reactToMoment} onChange={(e) => settings.setCompanionship({ proactiveCooldownMinutes: { ...settings.companionship.proactiveCooldownMinutes, reactToMoment: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} slotProps={{ htmlInput: { min: 0, max: 1440, step: 1 } }} />
                    <TextField type="number" size="small" label={i18n.language.startsWith('zh') ? '邀约' : 'Outing'} value={settings.companionship.proactiveCooldownMinutes.socialOuting} onChange={(e) => settings.setCompanionship({ proactiveCooldownMinutes: { ...settings.companionship.proactiveCooldownMinutes, socialOuting: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} slotProps={{ htmlInput: { min: 0, max: 1440, step: 1 } }} />
                    <TextField type="number" size="small" label={i18n.language.startsWith('zh') ? '状态' : 'Status'} value={settings.companionship.proactiveCooldownMinutes.statusUpdate} onChange={(e) => settings.setCompanionship({ proactiveCooldownMinutes: { ...settings.companionship.proactiveCooldownMinutes, statusUpdate: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} slotProps={{ htmlInput: { min: 0, max: 1440, step: 1 } }} />
                  </Box>
                </Box>
              </Box>
              <TextField
                type="number"
                size="small"
                label={i18n.language.startsWith('zh') ? '未完成约定保留天数' : 'Pending promise retention days'}
                value={settings.companionship.pendingPromiseRetentionDays}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  settings.setCompanionship({ pendingPromiseRetentionDays: Number.isFinite(value) ? Math.min(365, Math.max(1, Math.round(value))) : 30 });
                }}
                slotProps={{ htmlInput: { min: 1, max: 365, step: 1 } }}
                sx={{ maxWidth: 260 }}
              />
              <TextField
                type="number"
                size="small"
                label={i18n.language.startsWith('zh') ? 'AI 私聊冷却（小时）' : 'AI private thread cooldown (h)'}
                value={settings.companionship.privateThreadCooldownHours}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  settings.setCompanionship({ privateThreadCooldownHours: Number.isFinite(value) ? Math.min(168, Math.max(0, Math.round(value * 100) / 100)) : 6 });
                }}
                slotProps={{ htmlInput: { min: 0, max: 168, step: 0.5 } }}
                sx={{ maxWidth: 260 }}
              />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '陪伴表达强度' : 'Companionship intensity'}</Typography>
                <ToggleButtonGroup value={settings.companionship.careIntensity} exclusive onChange={(_, v) => v && settings.setCompanionship({ careIntensity: v })} size="small" sx={buildToggleGroupSx()}>
                  <ToggleButton value="restrained">{i18n.language.startsWith('zh') ? '克制' : 'Restrained'}</ToggleButton>
                  <ToggleButton value="balanced">{i18n.language.startsWith('zh') ? '平衡' : 'Balanced'}</ToggleButton>
                  <ToggleButton value="expressive">{i18n.language.startsWith('zh') ? '主动' : 'Expressive'}</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1, alignItems: 'center' }}>
                <FormControlLabel control={<Switch checked={settings.companionship.allowGoodMorning} onChange={(e) => settings.setCompanionship({ allowGoodMorning: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '允许早安' : 'Good morning'} />
                <FormControlLabel control={<Switch checked={settings.companionship.allowGoodNight} onChange={(e) => settings.setCompanionship({ allowGoodNight: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '允许晚安' : 'Good night'} />
                <FormControlLabel control={<Switch checked={settings.companionship.allowMissYou} onChange={(e) => settings.setCompanionship({ allowMissYou: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '允许想念表达' : 'Miss-you expression'} />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1.1fr) repeat(2, minmax(0, 0.8fr))' }, gap: 1, alignItems: 'center' }}>
                <FormControlLabel control={<Switch checked={settings.companionship.quietHours.enabled} onChange={(e) => settings.setCompanionship({ quietHours: { ...settings.companionship.quietHours, enabled: e.target.checked } })} />} label={i18n.language.startsWith('zh') ? '陪伴免打扰' : 'Companionship quiet hours'} />
                <TextField type="time" size="small" label={i18n.language.startsWith('zh') ? '开始' : 'Start'} value={settings.companionship.quietHours.start} onChange={(e) => settings.setCompanionship({ quietHours: { ...settings.companionship.quietHours, start: e.target.value } })} disabled={!settings.companionship.quietHours.enabled} slotProps={{ inputLabel: { shrink: true } }} />
                <TextField type="time" size="small" label={i18n.language.startsWith('zh') ? '结束' : 'End'} value={settings.companionship.quietHours.end} onChange={(e) => settings.setCompanionship({ quietHours: { ...settings.companionship.quietHours, end: e.target.value } })} disabled={!settings.companionship.quietHours.enabled} slotProps={{ inputLabel: { shrink: true } }} />
              </Box>
              <FormControlLabel control={<Switch checked={settings.companionship.quietHours.suppressStatusHints} onChange={(e) => settings.setCompanionship({ quietHours: { ...settings.companionship.quietHours, suppressStatusHints: e.target.checked } })} disabled={!settings.companionship.quietHours.enabled} />} label={i18n.language.startsWith('zh') ? '免打扰时隐藏陪伴状态提示' : 'Hide status hints during quiet hours'} />
              <FormControlLabel control={<Switch checked={settings.developerMode} onChange={(e) => settings.setDeveloperMode(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '开发者模式' : 'Developer mode'} />
            </Box>
          </Box>
        </SurfaceCard>

        {developerToolsSection}

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={i18n.language.startsWith('zh') ? '群聊默认行为' : 'Chat defaults'} />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '群聊默认变化强度' : 'Default evolution intensity for group chats'}</Typography>
              <ToggleButtonGroup value={settings.chatDraftDefaults.runtimeEvolutionIntensity} exclusive onChange={(_, v) => v && settings.setChatDraftDefaults({ runtimeEvolutionIntensity: v })} size="small" sx={buildToggleGroupSx()}>
                <ToggleButton value="slow">{i18n.language.startsWith('zh') ? '慢' : 'Slow'}</ToggleButton>
                <ToggleButton value="balanced">{i18n.language.startsWith('zh') ? '平衡' : 'Balanced'}</ToggleButton>
                <ToggleButton value="fast">{i18n.language.startsWith('zh') ? '快' : 'Fast'}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={t('settings.dataManagement')} />
            <StatChipRow items={buildDataChips(i18n.language)} />
            <Box sx={buildActionGridSx()}>
              <Button startIcon={<BackupIcon />} variant="outlined" onClick={handleBackup}>{t('settings.backup')}</Button>
              <Button startIcon={<RestoreIcon />} variant="outlined" onClick={handleRestore}>{t('settings.restore')}</Button>
              <Button variant="outlined" onClick={() => navigate('/settings/recycle-bin')}>{i18n.language.startsWith('zh') ? '回收站' : 'Recycle Bin'}</Button>
              <Button startIcon={<ClearIcon />} variant="outlined" color="error" onClick={() => setClearConfirm(true)}>{t('settings.clearAll')}</Button>
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <SectionHeader title={t('settings.about')} dense />
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>Pneumata</Typography>
          <Chip size="small" label="v1.0.0" variant="outlined" onClick={() => navigate('/intro')} sx={{ cursor: 'pointer' }} />
        </SurfaceCard>

        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => {
            useAuthStore.getState().logout();
            window.location.href = '/login';
          }}
          sx={{ mb: 1 }}
        >
          {i18n.language.startsWith('zh') ? '退出登录' : 'Log out'}
        </Button>
      </PageSection>

      <ConfirmDialog
        open={clearConfirm}
        title={t('settings.clearAll')}
        message={t('settings.clearAllConfirm')}
        onConfirm={handleClearAll}
        onCancel={() => setClearConfirm(false)}
        destructive
      />

      <Dialog open={backupDialogOpen} onClose={() => setBackupDialogOpen(false)} fullWidth maxWidth="sm" sx={buildDialogPaperSx()}>
        <DialogTitle>{i18n.language.startsWith('zh') ? '选择要备份的内容' : 'Choose what to back up'}</DialogTitle>
        <DialogContent sx={buildDialogScrollableContentSx()}>
          <Box sx={buildDialogContentSx()}>
            <Box sx={buildDialogTreeBodySx()}>
              <BackupTreeSection
                nodes={BACKUP_TREE}
                selection={backupSelection}
                availability={FULL_BACKUP_AVAILABILITY}
                stats={backupStats}
                expandedKeys={expandedBackupKeys}
                onToggleExpand={(key) => setExpandedBackupKeys((prev) => updateExpandedKeys(prev, key))}
                onToggleCheck={(key, checked) => setBackupSelection((prev) => getSelectionAfterToggle(prev, key, checked))}
                language={i18n.language}
              />
            </Box>
            {hasSelectedSecrets(backupSelection) ? (
              <Alert severity="error" sx={buildWarningAlertSx()}>
                {i18n.language.startsWith('zh') ? '当前勾选包含密钥明文，导出的 JSON 将写入 API 密钥。务必避免泄露、误传、截图或上传到不受控存储。' : 'The current selection includes plaintext keys. Exported JSON will contain API keys. Avoid leaks, accidental sharing, screenshots, or uploading to uncontrolled storage.'}
              </Alert>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={buildDialogActionsSx()}>
          <Button onClick={() => setBackupDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleConfirmBackup} variant="contained" disabled={!hasAnySelected(backupSelection)}>{t('common.confirm')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={restoreDialogOpen} onClose={() => setRestoreDialogOpen(false)} fullWidth maxWidth="sm" sx={buildDialogPaperSx()}>
        <DialogTitle>{i18n.language.startsWith('zh') ? '选择要恢复的内容' : 'Choose what to restore'}</DialogTitle>
        <DialogContent sx={buildDialogScrollableContentSx()}>
          <Box sx={buildDialogContentSx()}>
            <Typography variant="caption" color="text.secondary" sx={buildRestoreFileNameSx()}>
              {restoreFileName}
            </Typography>
            {restoreEmptyHint ? (
              <Alert severity="warning">{restoreEmptyHint}</Alert>
            ) : null}
            <Box sx={buildDialogTreeBodySx()}>
              <BackupTreeSection
                nodes={BACKUP_TREE}
                selection={restoreSelection}
                availability={restoreAvailability}
                stats={restoreStats}
                expandedKeys={expandedRestoreKeys}
                onToggleExpand={(key) => setExpandedRestoreKeys((prev) => updateExpandedKeys(prev, key))}
                onToggleCheck={(key, checked) => setRestoreSelection((prev) => getSelectionAfterToggle(prev, key, checked, restoreAvailability))}
                language={i18n.language}
              />
            </Box>
            {hasSelectedSecrets(restoreSelection) ? (
              <Alert severity="error" sx={buildWarningAlertSx()}>
                {i18n.language.startsWith('zh') ? '当前恢复包含密钥明文，导入后本地设置会写入 API 密钥。请确认备份来源可信，并避免泄露该 JSON。' : 'The current restore includes plaintext keys. Importing will write API keys into local settings. Ensure the backup source is trusted and avoid leaking the JSON.'}
              </Alert>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={buildDialogActionsSx()}>
          <Button onClick={() => setRestoreDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleConfirmRestore} variant="contained" disabled={!hasAnySelected(restoreSelection, restoreAvailability)}>{t('common.confirm')}</Button>
        </DialogActions>
      </Dialog>

      <AppSnackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        severity={snackbar.severity}
        message={snackbar.message}
      />
      <BubbleStylePickerDialog
        open={userBubblePickerOpen}
        title={i18n.language.startsWith('zh') ? '我的气泡' : 'My bubble'}
        valueStyleId={settings.userBubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID}
        valueStyle={settings.userBubbleStyle}
        customStyles={settings.customBubbleStyles || []}
        avatar={selfAvatarValue}
        isImageAvatar={selfAvatarIsImage}
        previewText={selfBubblePreviewText}
        onClose={() => setUserBubblePickerOpen(false)}
        onConfirm={(styleId, style) => {
          settings.setUserBubbleStyle(styleId, { ...style, id: styleId });
          setUserBubblePickerOpen(false);
        }}
        onCustomStylesChange={settings.setCustomBubbleStyles}
      />
    </Box>
  );
}
