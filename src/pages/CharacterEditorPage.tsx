import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import CharacterForm from '../components/character/CharacterForm';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { enqueueAvatarGenerationForCharacter } from '../services/avatarGeneration';

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
  const { characters, loadCharacters, addCharacter, updateCharacter, deleteCharacter, initializePresets } = useCharacterStore();
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const goBack = useCallback(() => {
    if (returnTo) {
      navigate(`${decodeURIComponent(returnTo)}${decodeURIComponent(returnTo).includes('?') ? '&' : '?'}restoreDraft=1`, { replace: true });
      return;
    }
    navigate('/characters', { replace: true });
  }, [navigate, returnTo]);

  useEffect(() => {
    let cancelled = false;
    if (characters.length > 0) {
      setBootstrapComplete(true);
      return undefined;
    }
    setBootstrapComplete(false);
    void loadCharacters()
      .then(() => initializePresets())
      .finally(() => {
        if (!cancelled) setBootstrapComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, [characters.length, initializePresets, loadCharacters]);

  useEffect(() => {
    setHeaderTitle(editId ? t('character.edit') : t('character.create'));
    setHeaderBackAction(() => () => goBack());
    setHideMobileBottomNav(true);
    setHeaderActions(
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {editId ? (
          <Button color="error" variant="outlined" onClick={() => setDeleteOpen(true)}>
            {t('common.delete')}
          </Button>
        ) : null}
      </Box>
    );

    return () => {
      setHeaderActions(null);
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
    };
  }, [editId, goBack, setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav, t]);

  const editChar = useMemo(() => (editId ? characters.find((character) => character.id === editId) : undefined), [characters, editId]);

  if (editId && !editChar) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto' }}>
        <Typography variant="body2" color="text.secondary">
          {bootstrapComplete
            ? (i18n.language.startsWith('zh') ? '未找到这个角色' : 'Character not found')
            : (i18n.language.startsWith('zh') ? '正在打开角色...' : 'Opening character...')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto' }}>
      <CharacterForm
        initial={editChar}
        existingNames={characters.map((character) => character.name)}
        onSave={async (data) => {
          if (editId) {
            await updateCharacter(editId, data);
          } else {
            const created = await addCharacter(data);
            if (settings.autoGenerateCharacterAvatar && data.generatedByAI) {
              enqueueAvatarGenerationForCharacter(created, settings.aiProfiles, i18n.language.startsWith('zh') ? 'zh' : 'en');
            }
          }
          goBack();
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
