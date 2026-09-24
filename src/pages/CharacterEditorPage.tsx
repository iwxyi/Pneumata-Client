import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { usePaneLayout } from '../components/layout/PaneLayoutContext';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { ensureCharacterArtifactStoreHydrated, useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import CharacterForm from '../components/character/CharacterForm';
import ConfirmDialog from '../components/common/ConfirmDialog';
import LoadingState from '../components/common/LoadingState';
import MarketUploadDialog, { type MarketUploadDraft } from '../components/market/MarketUploadDialog';
import { enqueueAvatarGenerationForCharacter } from '../services/avatarGeneration';
import { marketApi } from '../services/marketApi';
import { buildImportedCharacterDraft, getMarketImportDraftState } from '../services/marketImportDraft';
import { buildCharacterMarketPayload, getMarketCoverForCharacter, getMarketSummaryForCharacter, getMarketTitleForCharacter } from '../services/templateMarketPayload';

export default function CharacterEditorPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  const pane = usePaneLayout();
  const isSplitDetailPane = pane.role === 'detail';
  const returnTo = new URLSearchParams(location.search).get('returnTo');
  const isCreate = location.pathname === '/characters/create';
  const marketImportDraft = isCreate ? getMarketImportDraftState(location.state) : null;
  const editId = isCreate ? null : (id || null);
  const settings = useSettingsStore(useShallow((state) => ({
    aiProfiles: state.aiProfiles,
    avatarGeneration: state.avatarGeneration,
  })));
  const { setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const { characters, loadCharacter, addCharacter, updateCharacter, updateCharacters, applyLocalCharacterVisualAssets, deleteCharacter, initializePresets, remoteDeletedCharacterIds, markCharactersWarm, prefetchCharacters } = useCharacterStore(useShallow((state) => ({
    characters: state.characters,
    loadCharacter: state.loadCharacter,
    addCharacter: state.addCharacter,
    updateCharacter: state.updateCharacter,
    updateCharacters: state.updateCharacters,
    applyLocalCharacterVisualAssets: state.applyLocalCharacterVisualAssets,
    deleteCharacter: state.deleteCharacter,
    initializePresets: state.initializePresets,
    remoteDeletedCharacterIds: state.remoteDeletedCharacterIds,
    markCharactersWarm: state.markCharactersWarm,
    prefetchCharacters: state.prefetchCharacters,
  })));
  const chats = useChatStore((state) => state.chats);
  const updateChatSession = useChatStore((state) => state.updateChat);
  const syncArtifactCloud = useCharacterArtifactStore((state) => state.syncCloud);
  const marketUploadEntitled = useAuthStore((state) => state.user?.marketUploadEntitled === true);
  const syncedDiaryCharacterIdsRef = useRef(new Set<string>());
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const characterDataReady = bootstrapComplete || characters.length > 0;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [marketMenuAnchor, setMarketMenuAnchor] = useState<HTMLElement | null>(null);
  const [marketUploadDraft, setMarketUploadDraft] = useState<MarketUploadDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftNameState, setDraftNameState] = useState<{ editId: string | null; name: string }>({ editId: null, name: '' });

  const handleDraftNameChange = useCallback((name: string) => {
    setDraftNameState((prev) => {
      if (prev.editId === editId && prev.name === name) return prev;
      return { editId, name };
    });
  }, [editId]);

  useLayoutEffect(() => {
    if (!useCharacterStore.persist.hasHydrated()) void useCharacterStore.persist.rehydrate();
    if (!useChatStore.persist.hasHydrated()) void useChatStore.persist.rehydrate();
    void ensureCharacterArtifactStoreHydrated();
  }, []);

  const goBack = useCallback(() => {
    if (returnTo) {
      navigate(`${decodeURIComponent(returnTo)}${decodeURIComponent(returnTo).includes('?') ? '&' : '?'}restoreDraft=1`, { replace: true });
      return;
    }
    navigate('/characters', { replace: true });
  }, [navigate, returnTo]);

  useEffect(() => {
    let cancelled = false;
    if (editId) {
      void loadCharacter(editId)
        .finally(() => {
          if (!cancelled) setBootstrapComplete(true);
        });
      void initializePresets();
    } else {
      markCharactersWarm();
      void prefetchCharacters();
      void initializePresets()
        .finally(() => {
          if (!cancelled) setBootstrapComplete(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [editId, initializePresets, loadCharacter, markCharactersWarm, prefetchCharacters]);

  const handleDiaryTabOpen = useCallback(() => {
    if (!editId || syncedDiaryCharacterIdsRef.current.has(editId)) return;
    syncedDiaryCharacterIdsRef.current.add(editId);
    void syncArtifactCloud({ kind: 'diary', characterId: editId });
  }, [editId, syncArtifactCloud]);

  const editChar = useMemo(() => (editId ? characters.find((character) => character.id === editId) : undefined), [characters, editId]);
  const importedCharacterInitial = useMemo(() => (
    marketImportDraft?.item.kind === 'character_template'
      ? buildImportedCharacterDraft(marketImportDraft.item)
      : undefined
  ), [marketImportDraft]);
  const isRemoteDeletedCharacter = Boolean(editId && remoteDeletedCharacterIds.includes(editId));
  const headerTitle = useMemo(() => {
    const normalizedName = draftNameState.editId === editId ? draftNameState.name.trim() : '';
    if (editId) return normalizedName || editChar?.name || t('character.edit');
    return t('character.create');
  }, [draftNameState, editChar?.name, editId, t]);

  useEffect(() => {
    setHeaderTitle(headerTitle);
    setHeaderBackAction(() => () => goBack());
    setHideMobileBottomNav(true);
    setHeaderActions(editChar && editId && !editChar.isPreset && marketUploadEntitled ? (
      <IconButton
        size="small"
        onClick={(event) => setMarketMenuAnchor(event.currentTarget)}
        aria-label={i18n.language.startsWith('zh') ? '更多操作' : 'More actions'}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
    ) : null);

    return () => {
      setHeaderActions(null);
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
    };
  }, [editChar, editId, goBack, headerTitle, i18n.language, marketUploadEntitled, setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav, t]);

  const openCharacterMarketUpload = useCallback(() => {
    if (!editChar || !editId) return;
    setMarketMenuAnchor(null);
    setMarketUploadDraft({
      kind: 'character_template',
      title: getMarketTitleForCharacter(editChar),
      summary: getMarketSummaryForCharacter(editChar),
      coverImage: getMarketCoverForCharacter(editChar),
      payload: buildCharacterMarketPayload(editChar),
      sourceEntityId: editId,
      marketItemId: null,
    });
  }, [editChar, editId]);

  const duplicateNameErrorText = i18n.language.startsWith('zh') ? '已存在同名角色' : 'A character with the same name already exists';
  const shouldWaitForCharacter = Boolean(editId && !editChar && !bootstrapComplete);
  if (isRemoteDeletedCharacter) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto', display: 'grid', gap: 1.5 }}>
        <Typography variant="h6">
          {i18n.language.startsWith('zh') ? '角色已在其他设备删除' : 'Character deleted on another device'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {i18n.language.startsWith('zh')
            ? '当前页面已停止编辑，避免把旧缓存重新同步回云端。你可以到回收站恢复，或返回角色列表。'
            : 'Editing is stopped to avoid syncing stale cached data back to the cloud. Restore it from the recycle bin or return to the library.'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => navigate('/settings/recycle-bin')}>
            {i18n.language.startsWith('zh') ? '查看回收站' : 'Open recycle bin'}
          </Button>
          <Button onClick={goBack}>{i18n.language.startsWith('zh') ? '返回' : 'Back'}</Button>
        </Box>
      </Box>
    );
  }
  if (editId && !editChar && !shouldWaitForCharacter) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto' }}>
        {characterDataReady ? (
          <Typography variant="body2" color="text.secondary">
            {i18n.language.startsWith('zh') ? '未找到这个角色' : 'Character not found'}
          </Typography>
        ) : (
          <LoadingState
            title={i18n.language.startsWith('zh') ? '正在打开角色' : 'Opening character'}
          />
        )}
      </Box>
    );
  }

  if (shouldWaitForCharacter) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 760, mx: 'auto' }}>
        <LoadingState
          title={i18n.language.startsWith('zh') ? '正在打开角色' : 'Opening character'}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, width: '100%', maxWidth: 'none', mx: 'auto' }}>
      <CharacterForm
        key={editId || marketImportDraft?.item.id || 'create'}
        initial={editChar || importedCharacterInitial}
        existingNames={characters.map((character) => character.name)}
        saveError={saveError}
        onDraftNameChange={handleDraftNameChange}
        onDelete={editId ? () => setDeleteOpen(true) : undefined}
        deleteLabel={t('common.delete')}
        calendarContext={editId ? {
          chats,
          characters,
          updateChat: updateChatSession,
          actorId: editId,
        } : undefined}
        onDiaryTabOpen={handleDiaryTabOpen}
        onVisualAssetsChange={editId
          ? (assets, primaryReferenceImageId) => applyLocalCharacterVisualAssets(editId, assets, primaryReferenceImageId)
          : undefined}
        onSave={async (data) => {
          setSaveError(null);
          try {
            if (editId) {
              await updateCharacter(editId, data);
            } else {
              const created = await addCharacter({
                ...data,
                sourceMarketItemId: importedCharacterInitial?.sourceMarketItemId,
                sourceMarketItemVersion: importedCharacterInitial?.sourceMarketItemVersion,
                sourceMarketKind: importedCharacterInitial?.sourceMarketKind,
              });
              if (marketImportDraft?.item.id) {
                void marketApi.recordImported(marketImportDraft.item.id).catch((error) => {
                  console.warn('[market:record-imported:error]', error);
                });
              }
              if (settings.avatarGeneration.autoGenerateCharacterAvatar && data.generatedByAI) {
                try {
                  await enqueueAvatarGenerationForCharacter(created, settings.aiProfiles, i18n.language.startsWith('zh') ? 'zh' : 'en', settings.avatarGeneration);
                } catch (error) {
                  console.error('[character-editor:auto-avatar:error]', error);
                }
              }
            }
            // In the desktop master-detail layout, a successful edit should
            // leave the selected role open for continued work.
            if (!editId || !isSplitDetailPane) goBack();
          } catch (error) {
            if (error instanceof Error && error.message === 'DUPLICATE_CHARACTER_NAME') {
              setSaveError(duplicateNameErrorText);
              return;
            }
            throw error;
          }
        }}
        onCancel={goBack}
      />

      {marketUploadEntitled ? (
        <>
          <Menu
            anchorEl={marketMenuAnchor}
            open={Boolean(marketMenuAnchor)}
            onClose={() => setMarketMenuAnchor(null)}
          >
            <MenuItem onClick={openCharacterMarketUpload}>
              提交角色到市场
            </MenuItem>
          </Menu>

          <MarketUploadDialog
            open={Boolean(marketUploadDraft)}
            draft={marketUploadDraft}
            onClose={() => setMarketUploadDraft(null)}
            onUploaded={(item) => {
              if (!editId) return;
              void updateCharacter(editId, {
                sourceMarketItemId: item.id,
                sourceMarketItemVersion: item.payloadVersion,
                sourceMarketKind: item.kind,
              });
            }}
          />
        </>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title={t('character.delete')}
        message={t('character.deleteConfirm')}
        onConfirm={async () => {
          if (editId) {
            await deleteCharacter(editId);
          }
          setDeleteOpen(false);
          if (returnTo) {
            navigate(decodeURIComponent(returnTo), { replace: true });
          } else {
            navigate('/characters', { replace: true });
          }
        }}
        onCancel={() => setDeleteOpen(false)}
        destructive
        loadingLabel="删除中"
      />
    </Box>
  );
}
