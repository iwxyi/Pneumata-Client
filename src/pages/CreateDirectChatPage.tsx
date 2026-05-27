import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, IconButton, Avatar, TextField, InputAdornment } from '@mui/material';
import { isImageAvatar } from '../utils/avatar';
import SearchIcon from '@mui/icons-material/Search';
import ChatIcon from '@mui/icons-material/ChatBubbleOutlined';
import { useNavigate } from 'react-router-dom';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import CharacterGroupFilterBar from '../components/character/CharacterGroupFilterBar';
import EmptyState from '../components/common/EmptyState';
import { getCharacterGroupList, isCharacterInGroup, normalizeCharacterGroup } from '../types/character';
import { buildDirectChatDraft } from '../services/chatDraftBuilder';
import { buildInteractiveSurfaceSx, buildListGridSx } from '../styles/interaction';

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
  const groupOptions = useMemo(() => groupList.map((group) => ({
    value: group,
    label: group,
    count: characters.filter((character) => normalizeCharacterGroup(character.group) === group).length,
  })), [characters, groupList]);
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
    <Box sx={{ containerType: 'inline-size', p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 12, sm: 8 }, maxWidth: 860, mx: 'auto' }}>
      <Box
        sx={{
          position: 'sticky',
          top: 'var(--app-floating-tab-top, 12px)',
          zIndex: 8,
          mb: 2,
          pb: 1.25,
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
        <CharacterGroupFilterBar
          allLabel="全部"
          allCount={characters.length}
          options={groupOptions}
          selectedValue={selectedGroup}
          onSelect={setSelectedGroup}
          sx={{ pb: 0.5 }}
        />
      </Box>

      {customCharacters.length === 0 ? (
        <EmptyState
          variant="plain"
          message={search || selectedGroup ? '没有匹配的角色' : '暂无可发起单聊的角色'}
        />
      ) : (
        <Box sx={{ ...buildListGridSx(), pt: 0.5 }}>
          {customCharacters.map((character) => (
            <Box
              key={character.id}
              onClick={() => navigate(`/characters/${character.id}/edit?returnTo=${encodeURIComponent('/direct/create')}`)}
              sx={{
                ...buildInteractiveSurfaceSx(),
                p: { xs: 1.35, sm: 1.5 },
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                cursor: 'pointer',
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
      )}
    </Box>
  );
}
