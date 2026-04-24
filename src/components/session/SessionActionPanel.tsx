import { Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import type { SessionActionDefinition } from '../../types/sessionEngine';

interface SessionActionPanelProps {
  title?: string;
  actions: SessionActionDefinition[];
  onRunAction: (action: SessionActionDefinition, payload: Record<string, unknown>) => void;
}

function getActionLabel(action: SessionActionDefinition) {
  if (action.type === 'ask_question') return '提问动作';
  if (action.type === 'director_intervention') return '导演干预';
  if (action.type === 'start_private_thread') return '发起私聊';
  if (action.type === 'wolf_vote') return '夜晚袭击';
  if (action.type === 'inspect_player') return '夜晚查验';
  if (action.type === 'vote_player') return '白天投票';
  if (action.type === 'send_message') return '发言';
  return action.type;
}

function getActionHint(action: SessionActionDefinition) {
  if (action.type === 'ask_question') return '验证非聊天动作流：推进一个问题/环节，而不是直接发消息。';
  if (action.type === 'director_intervention') return '主持/导演对房间状态做一次明确干预。';
  if (action.type === 'start_private_thread') return '派生局部私聊或双边互动。';
  if (action.type === 'wolf_vote') return '狼人夜晚协商并选择刀口。';
  if (action.type === 'inspect_player') return '预言家夜晚查验一名目标。';
  if (action.type === 'vote_player') return '白天公开投票并附带理由。';
  if (action.type === 'send_message') return '普通发言动作。';
  return '执行该 session action。';
}

export default function SessionActionPanel({ title = '动作面板', actions, onRunAction }: SessionActionPanelProps) {
  const initialState = useMemo(() => Object.fromEntries(actions.flatMap((action) => (action.fields || []).map((field) => [field.key, '']))), [actions]);
  const [payloads, setPayloads] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(actions.map((action) => [action.type, { ...initialState }])));

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
        {actions.length ? (
          <Stack spacing={1}>
            {actions.map((action, index) => (
              <Box key={`${action.type}-${index}`} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{getActionLabel(action)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, mb: 1 }}>{action.description || getActionHint(action)}</Typography>
                <Stack spacing={1} sx={{ mb: 1 }}>
                  {(action.fields || []).map((field) => field.type === 'single_select' ? (
                    <TextField
                      key={`${action.type}-${field.key}`}
                      size="small"
                      select
                      label={field.label}
                      value={payloads[action.type]?.[field.key] || ''}
                      onChange={(e) => setPayloads((current) => ({
                        ...current,
                        [action.type]: {
                          ...(current[action.type] || {}),
                          [field.key]: e.target.value,
                        },
                      }))}
                    >
                      {(field.options || []).map((option) => <MenuItem key={`${field.key}-${option.value}`} value={option.value}>{option.label}</MenuItem>)}
                    </TextField>
                  ) : (
                    <TextField
                      key={`${action.type}-${field.key}`}
                      size="small"
                      type={field.type === 'number' ? 'number' : 'text'}
                      multiline={field.type === 'textarea'}
                      minRows={field.type === 'textarea' ? 2 : undefined}
                      label={field.label}
                      placeholder={field.placeholder}
                      value={payloads[action.type]?.[field.key] || ''}
                      onChange={(e) => setPayloads((current) => ({
                        ...current,
                        [action.type]: {
                          ...(current[action.type] || {}),
                          [field.key]: e.target.value,
                        },
                      }))}
                    />
                  ))}
                </Stack>
                <Button size="small" variant="outlined" onClick={() => onRunAction(action, payloads[action.type] || {})} disabled={(action.fields || []).some((field) => field.required && !(payloads[action.type]?.[field.key] || '').trim())}>执行</Button>
              </Box>
            ))}
          </Stack>
        ) : <Typography variant="caption" color="text.secondary">当前阶段暂无额外动作</Typography>}
      </CardContent>
    </Card>
  );
}
