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
      <Box sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.default', pb: 2 }}>
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
          sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'nowrap', overflowX: 'auto', pb: 0.5 }}>
          <Chip
            size="small"
            label="全部"
            color={selectedGroup === null ? 'primary' : 'default'}
            variant={selectedGroup === null ? 'filled' : 'outlined'}
            onClick={() => setSelectedGroup(null)}
          />
          {groupList.map((group) => (
            <Chip
              key={group}
              size="small"
              label={group}
              color={selectedGroup === group ? 'primary' : 'default'}
              variant={selectedGroup === group ? 'filled' : 'outlined'}
              onClick={() => setSelectedGroup(group)}
            />
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
        {customCharacters.map((character) => (
          <Box
            key={character.id}
            onClick={() => navigate(`/characters/${character.id}/edit?returnTo=${encodeURIComponent('/direct/create')}`)}
            sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', transition: 'all 0.18s ease', '&:hover': { boxShadow: 1, borderColor: 'primary.main' } }}
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
