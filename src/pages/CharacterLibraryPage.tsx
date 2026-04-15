import { useEffect, useState } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { Box, Button, Tabs, Tab, Snackbar, Alert, IconButton, Menu, MenuItem } from '@mui/material';
import { Add as AddIcon, MoreVert as MoreIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCharacterStore } from '../stores/useCharacterStore';
import CharacterCard from '../components/character/CharacterCard';
import CharacterForm from '../components/character/CharacterForm';
import ConfirmDialog from '../components/common/ConfirmDialog';
import EmptyState from '../components/common/EmptyState';

const CREATE_PARAM = 'create';
const EDIT_PARAM = 'edit';

function isCreateRequested(searchParams: URLSearchParams) {
  return searchParams.get(CREATE_PARAM) === '1';
}

function getEditRequested(searchParams: URLSearchParams) {
  return searchParams.get(EDIT_PARAM);
}

export default function CharacterLibraryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { characters, loadCharacters, addCharacter, updateCharacter, deleteCharacter, importCharacters, initializePresets } = useCharacterStore();
  const [tab, setTab] = useState(0);
  const [showForm, setShowForm] = useState(() => isCreateRequested(searchParams));
  const [editId, setEditId] = useState<string | null>(() => getEditRequested(searchParams));
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    loadCharacters().then(() => initializePresets());
  }, [initializePresets, loadCharacters]);

  useEffect(() => {
    setShowForm(isCreateRequested(searchParams));
    setEditId(getEditRequested(searchParams));
  }, [searchParams]);

  const presets = characters.filter((c) => c.isPreset);
  const custom = characters.filter((c) => !c.isPreset);
  const displayChars = tab === 0 ? custom : presets;
  const editChar = editId ? characters.find((c) => c.id === editId) : undefined;

  useEffect(() => {
    if (showForm || editId) {
      setHeaderTitle(editId ? t('character.edit') : t('character.create'));
      setHeaderBackAction(() => () => navigate(-1));
      setHideMobileBottomNav(true);
      setHeaderActions(
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {editId ? (
            <Button color="error" variant="outlined" onClick={() => setDeleteId(editId)}>
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
    }

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
  }, [editId, setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav, showForm, t]);

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

  const showInlineMenu = !showForm && !editId;

  const openCreateForm = () => {
    setSearchParams({ [CREATE_PARAM]: '1' });
  };

  const closeCreateForm = () => {
    setSearchParams({}, { replace: true });
    setShowForm(false);
    setEditId(null);
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
      } catch {
        setSnackbar({ open: true, message: t('character.importError'), severity: 'error' });
      }
    };
    input.click();
  };

  if (showForm || editId || deleteId) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto' }}>
        <CharacterForm
          initial={editChar}
          existingNames={characters.map((char) => char.name)}
          onSave={async (data) => {
            if (editId) {
              await updateCharacter(editId, data);
            } else {
              await addCharacter(data);
            }
            closeCreateForm();
            setEditId(null);
          }}
          onCancel={() => {
            closeCreateForm();
            setEditId(null);
          }}
        />

        <ConfirmDialog
          open={Boolean(deleteId)}
          title={t('character.delete')}
          message={t('character.deleteConfirm')}
          onConfirm={async () => {
            if (deleteId) {
              await deleteCharacter(deleteId);
            }
            setDeleteId(null);
            closeCreateForm();
            setEditId(null);
          }}
          onCancel={() => setDeleteId(null)}
          destructive
        />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minWidth: 0, flex: 1 }}>
          <Tab label={`${t('character.myCharacters')} (${custom.length})`} />
          <Tab label={`${t('character.presets')} (${presets.length})`} />
        </Tabs>
        {showInlineMenu ? renderListMenu : null}
      </Box>

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
          {displayChars.map((char) => (
            <CharacterCard
              key={char.id}
              character={char}
              onClick={char.isPreset ? undefined : () => setEditId(char.id)}
            />
          ))}
        </Box>
      )}

      <ConfirmDialog
        open={Boolean(deleteId)}
        title={t('character.delete')}
        message={t('character.deleteConfirm')}
        onConfirm={() => {
          if (deleteId) deleteCharacter(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
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
