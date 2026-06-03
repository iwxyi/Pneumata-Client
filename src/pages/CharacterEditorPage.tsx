import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import CharacterForm from '../components/character/CharacterForm';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { enqueueAvatarGenerationForCharacter } from '../services/avatarGeneration';
import { initializeDefaultRelationshipsForCreatedCharacters } from '../services/defaultRelationshipInitializer';
import { getPreferredAIProfile } from '../types/settings';

export default function CharacterEditorPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  const returnTo = new URLSearchParams(location.search).get('returnTo');
  const isCreate = location.pathname === '/characters/create';
  const editId = isCreate ? null : (id || null);
  const settings = useSettingsStore();
  const { setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const { characters, loadCharacters, loadCharacter, addCharacter, updateCharacter, updateCharacters, deleteCharacter, initializePresets } = useCharacterStore();
  const chats = useChatStore((state) => state.chats);
  const loadChats = useChatStore((state) => state.loadChats);
  const loadWorldRuntime = useChatStore((state) => state.loadWorldRuntime);
  const updateChatSession = useChatStore((state) => state.updateChat);
  const syncArtifactCloud = useCharacterArtifactStore((state) => state.syncCloud);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const characterDataReady = bootstrapComplete || characters.length > 0;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftNameState, setDraftNameState] = useState<{ editId: string | null; name: string }>({ editId: null, name: '' });

  const handleDraftNameChange = useCallback((name: string) => {
    setDraftNameState((prev) => {
      if (prev.editId === editId && prev.name === name) return prev;
      return { editId, name };
    });
  }, [editId]);

  const goBack = useCallback(() => {
    if (returnTo) {
      navigate(`${decodeURIComponent(returnTo)}${decodeURIComponent(returnTo).includes('?') ? '&' : '?'}restoreDraft=1`, { replace: true });
      return;
    }
    navigate('/characters', { replace: true });
  }, [navigate, returnTo]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([editId ? loadCharacter(editId) : loadCharacters(), loadChats(), loadWorldRuntime()])
      .then(() => initializePresets())
      .finally(() => {
        if (!cancelled) setBootstrapComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, [editId, initializePresets, loadCharacter, loadCharacters, loadChats, loadWorldRuntime]);

  useEffect(() => {
    void loadChats();
    void loadWorldRuntime();
  }, [loadChats, loadWorldRuntime]);

  useEffect(() => {
    if (!editId) return;
    void syncArtifactCloud({ kind: 'diary', characterId: editId });
  }, [editId, syncArtifactCloud]);

  const editChar = useMemo(() => (editId ? characters.find((character) => character.id === editId) : undefined), [characters, editId]);
  const headerTitle = useMemo(() => {
    const normalizedName = draftNameState.editId === editId ? draftNameState.name.trim() : '';
    if (editId) return normalizedName || editChar?.name || t('character.edit');
    return t('character.create');
  }, [draftNameState, editChar?.name, editId, t]);

  useEffect(() => {
    setHeaderTitle(headerTitle);
    setHeaderBackAction(() => () => goBack());
    setHideMobileBottomNav(true);
    setHeaderActions(null);

    return () => {
      setHeaderActions(null);
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
    };
  }, [editId, goBack, headerTitle, setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav, t]);

  const duplicateNameErrorText = i18n.language.startsWith('zh') ? '已存在同名角色' : 'A character with the same name already exists';
  const shouldWaitForCharacter = Boolean(editId && (!editChar || !editChar.characterDetailLoaded) && !(bootstrapComplete && !editChar));
  if (editId && !editChar && !shouldWaitForCharacter) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto' }}>
        <Typography variant="body2" color="text.secondary">
          {characterDataReady
            ? (i18n.language.startsWith('zh') ? '未找到这个角色' : 'Character not found')
            : (i18n.language.startsWith('zh') ? '正在打开角色...' : 'Opening character...')}
        </Typography>
      </Box>
    );
  }

  if (shouldWaitForCharacter) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto' }}>
        <Typography variant="body2" color="text.secondary">
          {i18n.language.startsWith('zh') ? '正在打开角色...' : 'Opening character...'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, width: '100%', maxWidth: 'none', mx: 'auto' }}>
      <CharacterForm
        key={editId || 'create'}
        initial={editChar}
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
        onSave={async (data) => {
          setSaveError(null);
          try {
            if (editId) {
              await updateCharacter(editId, data);
            } else {
              const created = await addCharacter(data);
              const profile = getPreferredAIProfile(settings.aiProfiles, 'text');
              if (profile?.apiKey && profile.model) {
                void initializeDefaultRelationshipsForCreatedCharacters({
                  config: profile,
                  createdCharacters: [created],
                  allCharacters: [...characters, created],
                  language: i18n.language.startsWith('zh') ? 'zh' : 'en',
                  updateCharacters,
                }).catch((error) => {
                  console.error('[character-editor:default-relationships:error]', error);
                });
              }
              if (settings.avatarGeneration.autoGenerateCharacterAvatar && data.generatedByAI) {
                try {
                  enqueueAvatarGenerationForCharacter(created, settings.aiProfiles, i18n.language.startsWith('zh') ? 'zh' : 'en', settings.avatarGeneration);
                } catch (error) {
                  console.error('[character-editor:auto-avatar:error]', error);
                }
              }
            }
            goBack();
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

      <ConfirmDialog
        open={deleteOpen}
        title={t('character.delete')}
        message={t('character.deleteConfirm')}
        onConfirm={async () => {
          if (editId) {
            await deleteCharacter(editId);
          }
          setDeleteOpen(false);
          goBack();
        }}
        onCancel={() => setDeleteOpen(false)}
        destructive
      />
    </Box>
  );
}
