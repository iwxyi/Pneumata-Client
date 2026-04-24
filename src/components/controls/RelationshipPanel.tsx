import { Box, Card, CardContent, Chip, Divider, LinearProgress, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';

interface RelationshipPanelProps {
  chat: GroupChat;
  members: AICharacter[];
}

function RelationshipMeters({ affinity, respect, hostility, contempt }: { affinity: number; respect: number; hostility: number; contempt: number }) {
  return (
    <Stack spacing={0.75} sx={{ mt: 0.75 }}>
      {[
        { label: '亲近', value: affinity, color: 'success.main' },
        { label: '尊重', value: respect, color: 'info.main' },
        { label: '敌意', value: hostility, color: 'warning.main' },
        { label: '轻视', value: contempt, color: 'error.main' },
      ].map((item) => (
        <Box key={item.label}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" color="text.secondary">{item.label}</Typography>
            <Typography variant="caption" color="text.secondary">{item.value}</Typography>
          </Box>
          <LinearProgress variant="determinate" value={item.value} sx={{ height: 6, borderRadius: 999, '& .MuiLinearProgress-bar': { bgcolor: item.color } }} />
        </Box>
      ))}
    </Stack>
  );
}

export default function RelationshipPanel({ chat, members }: RelationshipPanelProps) {
  const isGroupChat = chat.type === 'group';
  const owner = members.find((member) => member.id === chat.governance.ownerCharacterId);
  const admins = members.filter((member) => chat.governance.adminCharacterIds.includes(member.id));

  return (
    <Stack spacing={2}>
      {isGroupChat ? (
        <>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>世界状态</Typography>
              <Stack spacing={1}>
                <Typography variant="body2"><strong>阶段：</strong>{chat.worldState.phase || 'idle'}</Typography>
                <Typography variant="body2"><strong>气氛：</strong>{chat.worldState.mood || '未设置'}</Typography>
                <Typography variant="body2"><strong>焦点：</strong>{chat.worldState.focus || '未设置'}</Typography>
                <Typography variant="body2"><strong>最近事件：</strong>{chat.worldState.recentEvent || '暂无'}</Typography>
                <Typography variant="body2"><strong>变化强度：</strong>{chat.runtimeEvolutionIntensity === 'slow' ? '慢' : chat.runtimeEvolutionIntensity === 'fast' ? '快' : '平衡'}</Typography>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>管理</Typography>
              <Stack spacing={1}>
                <Typography variant="body2"><strong>群主：</strong>{owner?.name || '未设置'}</Typography>
                <Typography variant="body2"><strong>管理员：</strong>{admins.length ? admins.map((item) => item.name).join('、') : '无'}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  <Chip size="small" label={chat.governance.autoModeration ? '自动管理开启' : '自动管理关闭'} />
                  <Chip size="small" label={chat.governance.allowMute ? '允许禁言' : '不允许禁言'} />
                  <Chip size="small" label={chat.governance.allowPrivateThreads ? '允许AI私聊' : '不允许AI私聊'} />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{isGroupChat ? '关系提示' : '成员信息'}</Typography>
          {members.length === 0 ? <Typography variant="body2">暂无成员</Typography> : (
            <Stack spacing={1.25}>
              {members.map((member) => (
                <Box key={member.id}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{member.name}</Typography>
                  {member.relationships.length ? (
                    <Stack spacing={1} sx={{ mt: 0.5 }}>
                      {member.relationships.slice(0, 3).map((relation, index) => {
                        const target = members.find((item) => item.id === relation.characterId);
                        return (
                          <Box key={`${member.id}-${index}`} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                              对 {target?.name || relation.characterId}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {relation.note || '暂无备注'}
                            </Typography>
                            <RelationshipMeters affinity={relation.affinity} respect={relation.respect} hostility={relation.hostility} contempt={relation.contempt} />
                          </Box>
                        );
                      })}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">暂无明确关系备注</Typography>
                  )}
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
