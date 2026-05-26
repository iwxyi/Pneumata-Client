import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, IconButton, Avatar, TextField, InputAdornment, Chip } from '@mui/material';
import { isImageAvatar } from '../utils/avatar';
import SearchIcon from '@mui/icons-material/Search';
import ChatIcon from '@mui/icons-material/ChatBubbleOutlined';
import { useNavigate } from 'react-router-dom';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { getCharacterGroupList, isCharacterInGroup } from '../types/character';
import { buildDirectChatDraft } from '../services/chatDraftBuilder';

function buildFilterChipSx(active: boolean) {
  return {
    height: 30,
    borderRadius: 1,
    fontWeight: active ? 720 : 560,
    bgcolor: active ? 'primary.main' : 'transparent',
    borderColor: active ? 'primary.main' : 'divider',
    color: active ? 'primary.contrastText' : 'text.secondary',
    '&:hover': {
      bgcolor: active ? 'primary.dark' : 'action.hover',
      borderColor: active ? 'primary.dark' : 'primary.main',
      color: active ? 'primary.contrastText' : 'text.primary',
    },
  };
}

export default function CreateDirectChatPage() {
  const navigate = useNavigate();
  const { characters } = useCharacterStore();
  const { chats, addChat } = useChatStore();
  const { setHeaderTitle, setHeaderBackAction, setHeaderActions } = useLayoutHeaderActions();
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);


  useEffect(() => {
    setHeaderTitle('创建单聊');
    setHeaderBackAction(() => () => navigate('/chats?tab=1'));
    setHeaderActions(null);
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHeaderActions(null);
    };
  }, [navigate, setHeaderActions, setHeaderBackAction, setHeaderTitle]);

  const groupList = useMemo(() => getCharacterGroupList(characters), [characters]);
  const customCharacters = useMemo(
    () => characters.filter((item) => isCharacterInGroup(item, selectedGroup) && item.name.toLowerCase().includes(search.toLowerCase())),
    [characters, search, selectedGroup]
  );

  const handleCreate = async (characterId: string, characterName: string) => {
    const existing = chats.find((chat) => chat.type === 'direct' && chat.memberIds.length === 1 && chat.memberIds[0] === characterId);
    if (existing) {
      navigate(`/chats/${existing.id}`);
      return;
    }

    setCreatingId(characterId);
    try {
      const chat = await addChat(buildDirectChatDraft(characterId, characterName));
      navigate(`/chats/${chat.id}?fromTab=1`);
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 12, sm: 8 }, maxWidth: 860, mx: 'auto' }}>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          pb: 2,
          pt: 0.25,
          bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(245,245,247,0.78)' : 'rgba(10,10,15,0.78)',
          backdropFilter: 'blur(18px) saturate(1.12)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.12)',
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="搜索角色"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
            }
          }}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
            },
          }}
          sx={{
            mb: 1.25,
            '& .MuiOutlinedInput-root': {
              borderRadius: 1,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.07)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
            },
          }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'nowrap', overflowX: 'auto', pb: 0.5, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
          <Chip
            size="small"
            label="全部"
            variant="outlined"
            onClick={() => setSelectedGroup(null)}
            sx={buildFilterChipSx(selectedGroup === null)}
          />
          {groupList.map((group) => (
            <Chip
              key={group}
              size="small"
              label={group}
              variant="outlined"
              onClick={() => setSelectedGroup(group)}
              sx={buildFilterChipSx(selectedGroup === group)}
            />
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
        {customCharacters.map((character) => (
          <Box
            key={character.id}
            onClick={() => navigate(`/characters/${character.id}/edit?returnTo=${encodeURIComponent('/direct/create')}`)}
            sx={{
              p: { xs: 1.35, sm: 1.5 },
              border: '1px solid',
              borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
              borderRadius: 1,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(18,20,28,0.72)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              cursor: 'pointer',
              transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: (theme) => theme.palette.mode === 'light' ? '0 18px 40px rgba(15,23,42,0.09)' : '0 18px 42px rgba(0,0,0,0.34)',
                borderColor: 'primary.main',
              },
            }}
          >
            <Avatar src={isImageAvatar(character.avatar) ? character.avatar : undefined} sx={{ width: 44, height: 44, bgcolor: 'primary.light' }}>{isImageAvatar(character.avatar) ? undefined : character.avatar}</Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>{character.name}</Typography>
              {character.group ? <Typography variant="caption" color="text.secondary" noWrap>{character.group}</Typography> : null}
            </Box>
            <IconButton
              color="primary"
              onClick={(e) => {
                e.stopPropagation();
                handleCreate(character.id, character.name);
              }}
              disabled={creatingId === character.id}
              aria-label="开始单聊"
            >
              <ChatIcon />
            </IconButton>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
