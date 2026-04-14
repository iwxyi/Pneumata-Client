import { useEffect, useState } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { Box, Typography, Button, Tabs, Tab, Snackbar, Alert } from '@mui/material';
import { Add as AddIcon, Upload as ImportIcon, Download as ExportIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useCharacterStore } from '../stores/useCharacterStore';
import CharacterCard from '../components/character/CharacterCard';
import CharacterForm from '../components/character/CharacterForm';
import ConfirmDialog from '../components/common/ConfirmDialog';
import EmptyState from '../components/common/EmptyState';

const CREATE_PARAM = 'create';

function isCreateRequested(searchParams: URLSearchParams) {
  return searchParams.get(CREATE_PARAM) === '1';
}

export default function CharacterLibraryPage() {
  const { t } = useTranslation();
  const { setHeaderActions } = useLayoutHeaderActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { characters, loadCharacters, addCharacter, updateCharacter, deleteCharacter, importCharacters, initializePresets } =
    useCharacterStore();
  const [tab, setTab] = useState(0);
  const [showForm, setShowForm] = useState(() => isCreateRequested(searchParams));
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    loadCharacters().then(() => initializePresets());
  }, []);

  useEffect(() => {
    setShowForm(isCreateRequested(searchParams));
  }, [searchParams]);

  const presets = characters.filter((c) => c.isPreset);
  const custom = characters.filter((c) => !c.isPreset);

  useEffect(() => {
    if (showForm || editId) {
      setHeaderActions(null);
      return () => setHeaderActions(null);
    }

    setHeaderActions(
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<ImportIcon />} onClick={handleImport}>
          {t('character.import')}
        </Button>
        <Button size="small" startIcon={<ExportIcon />} onClick={handleExport} disabled={custom.length === 0}>
          {t('character.exportAll')}
        </Button>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateForm}>
          {t('character.create')}
        </Button>
      </Box>
    );

    return () => setHeaderActions(null);
  }, [custom.length, editId, setHeaderActions, showForm, t]);

  const displayChars = tab === 0 ? custom : presets;
  const editChar = editId ? characters.find((c) => c.id === editId) : undefined;

  const openCreateForm = () => {
    setSearchParams({ [CREATE_PARAM]: '1' });
  };

  const closeCreateForm = () => {
    setSearchParams({}, { replace: true });
    setShowForm(false);
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

  if (showForm || editId) {
    return (
      <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 600, mx: 'auto' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          {editId ? t('character.edit') : t('character.create')}
        </Typography>
        <CharacterForm
          initial={editChar}
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
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 } }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={`${t('character.myCharacters')} (${custom.length})`} />
        <Tab label={`${t('character.presets')} (${presets.length})`} />
      </Tabs>

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
        <Box sx={{ maxWidth: 600 }}>
          {displayChars.map((char) => (
            <CharacterCard
              key={char.id}
              character={char}
              onEdit={char.isPreset ? undefined : () => setEditId(char.id)}
              onDelete={char.isPreset ? undefined : () => setDeleteId(char.id)}
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
    </Box>
  );
}
