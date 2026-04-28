import { Box, Card, CardContent, Divider, LinearProgress, Stack, Typography } from '@mui/material';
import type { AICharacter } from '../../types/character';
import type { GroupChat } from '../../types/chat';
import { isMeaningfulRelationshipLedgerEntry } from '../../services/relationshipLedger';

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
  const ledgerEntries = (chat.relationshipLedger || [])
    .filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId))
    .filter(isMeaningfulRelationshipLedgerEntry)
    .slice()
    .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);

  const describeRecentEvidence = (summary: string) => summary.replace(/^[^\s]+\s(?:support|challenge|mock|dismiss|defend|evade|probe|pile_on|redirect|side_comment)(?:\s→\s[^\s]+)?\s*/, '').trim();

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{isGroupChat ? '关系账本' : '成员信息'}</Typography>
        {ledgerEntries.length ? (
          <Stack spacing={1.25}>
            {ledgerEntries.slice(0, 8).map((entry) => {
              const actor = members.find((member) => member.id === entry.actorId);
              const target = members.find((member) => member.id === entry.targetId);
              return (
                <Box key={entry.pairKey} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{actor?.name || entry.actorId} → {target?.name || entry.targetId}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    趋势：{entry.trend === 'flat' ? '平' : entry.trend === 'volatile' ? '震荡' : entry.trend === 'down' ? '下降' : '上升'}
                  </Typography>
                  <RelationshipMeters affinity={entry.current.affinity} respect={entry.current.respect} hostility={entry.current.hostility} contempt={entry.current.contempt} />
                  {entry.recentEvents[entry.recentEvents.length - 1] ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                      最近证据：{describeRecentEvidence(entry.recentEvents[entry.recentEvents.length - 1].summary) || '无'}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        ) : members.length === 0 ? <Typography variant="body2">暂无成员</Typography> : (
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
  );
}
