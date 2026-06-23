import { Box, Button, Card, CardContent, FormControlLabel, Switch, Typography } from '@mui/material';
import type { RuntimeEvolutionIntensity } from '../../types/chat';

interface DirectorControlsSectionProps {
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
  setRuntimeEvolutionIntensity: (value: RuntimeEvolutionIntensity) => void;
  allowSpeakAs: boolean;
  setAllowSpeakAs: (value: boolean) => void;
  allowDirectorMode: boolean;
  setAllowDirectorMode: (value: boolean) => void;
  allowEventInjection: boolean;
  setAllowEventInjection: (value: boolean) => void;
  allowForcedReply: boolean;
  setAllowForcedReply: (value: boolean) => void;
  allowCliques?: boolean;
  setAllowCliques?: (value: boolean) => void;
  allowMockery?: boolean;
  setAllowMockery?: (value: boolean) => void;
  onSaveAsChat?: () => void;
  saveAsChatDisabled?: boolean;
}

export default function DirectorControlsSection(props: DirectorControlsSectionProps) {
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>变化强度</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}><Button variant={props.runtimeEvolutionIntensity === 'slow' ? 'contained' : 'outlined'} onClick={() => props.setRuntimeEvolutionIntensity('slow')} sx={{ borderRadius: 999 }}>慢</Button><Button variant={props.runtimeEvolutionIntensity === 'balanced' ? 'contained' : 'outlined'} onClick={() => props.setRuntimeEvolutionIntensity('balanced')} sx={{ borderRadius: 999 }}>平衡</Button><Button variant={props.runtimeEvolutionIntensity === 'fast' ? 'contained' : 'outlined'} onClick={() => props.setRuntimeEvolutionIntensity('fast')} sx={{ borderRadius: 999 }}>快</Button></Box><Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>控制关系、情绪和人格漂移是快速显现，还是多轮对话后慢慢沉淀。</Typography></CardContent></Card>
      <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>导演权限</Typography><Box sx={{ display: 'grid', gap: 1 }}><FormControlLabel control={<Switch checked={props.allowSpeakAs} onChange={(e) => props.setAllowSpeakAs(e.target.checked)} />} label="允许以角色身份发言" /><FormControlLabel control={<Switch checked={props.allowDirectorMode} onChange={(e) => props.setAllowDirectorMode(e.target.checked)} />} label="允许导演模式" /><FormControlLabel control={<Switch checked={props.allowEventInjection} onChange={(e) => props.setAllowEventInjection(e.target.checked)} />} label="允许事件投放" /><FormControlLabel control={<Switch checked={props.allowForcedReply} onChange={(e) => props.setAllowForcedReply(e.target.checked)} />} label="允许强制指定回复" /></Box></CardContent></Card>
      {props.setAllowCliques && props.setAllowMockery ? <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>戏剧规则</Typography><Box sx={{ display: 'grid', gap: 1 }}><FormControlLabel control={<Switch checked={Boolean(props.allowCliques)} onChange={(e) => props.setAllowCliques?.(e.target.checked)} />} label="允许小团体" /><FormControlLabel control={<Switch checked={Boolean(props.allowMockery)} onChange={(e) => props.setAllowMockery?.(e.target.checked)} />} label="允许公开嘲讽" /></Box></CardContent></Card> : null}
      {props.onSaveAsChat ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>操作</Typography>
            <Button variant="contained" onClick={props.onSaveAsChat} disabled={props.saveAsChatDisabled}>
              另存为群聊
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              复制当前设定和成员到新群聊，不复制聊天记录、运行时、记忆和关系账本。
            </Typography>
          </CardContent>
        </Card>
      ) : null}
    </Box>
  );
}
