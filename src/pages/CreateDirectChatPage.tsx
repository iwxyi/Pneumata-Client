import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, IconButton, Avatar, TextField, InputAdornment } from '@mui/material';
import { Search as SearchIcon, ChatBubbleOutlined as ChatIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE, DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../types/chat';

export default function CreateDirectChatPage() {
  const navigate = useNavigate();
  const { characters, loadCharacters } = useCharacterStore();
  const { chats, loadChats, addChat } = useChatStore();
  const { setHeaderTitle, setHeaderBackAction, setHeaderActions } = useLayoutHeaderActions();
  const [search, setSearch] = useState('');
  const [creatingId, setCreatingId] = useState<string | null>(null);

  useEffect(() => {
    loadCharacters();
    loadChats();
  }, [loadCharacters, loadChats]);

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

  const customCharacters = useMemo(() => characters.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())), [characters, search]);

  const handleCreate = async (characterId: string, characterName: string) => {
    const existing = chats.find((chat) => chat.type === 'direct' && chat.memberIds.length === 1 && chat.memberIds[0] === characterId);
    if (existing) {
      navigate(`/chats/${existing.id}`);
      return;
    }

    setCreatingId(characterId);
    try {
      const chat = await addChat({
        type: 'direct',
        mode: 'open_chat',
        modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
        modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
        name: characterName,
        topic: '',
        style: 'free',
        memberIds: [characterId],
        speed: 1,
        isActive: false,
        allowIntervention: true,
        showRoleActions: true,
        topicSeed: '',
        governance: { ...DEFAULT_CONVERSATION_GOVERNANCE, allowMute: false, allowPrivateThreads: false },
        dramaRules: { ...DEFAULT_CONVERSATION_DRAMA_RULES, allowCliques: false, allowMockery: false },
        worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, mood: 'private', focus: '', recentEvent: '' },
        directorControls: { ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, allowEventInjection: false, allowForcedReply: false },
      });
      navigate(`/chats/${chat.id}?fromTab=1`);
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 12, sm: 8 }, maxWidth: 860, mx: 'auto' }}>
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
        sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
        {customCharacters.map((character) => (
          <Box
            key={character.id}
            onClick={() => navigate(`/characters/${character.id}/edit?returnTo=${encodeURIComponent('/direct/create')}`)}
            sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', transition: 'all 0.18s ease', '&:hover': { boxShadow: 1, borderColor: 'primary.main' } }}
          >
            <Avatar sx={{ width: 44, height: 44, bgcolor: 'primary.light' }}>{character.avatar}</Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>{character.name}</Typography>
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
