import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Collapse, TextField, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SendIcon from '@mui/icons-material/Send';
import { useNavigate } from 'react-router-dom';
import SurfaceCard from '../../components/common/SurfaceCard';
import AppSnackbar from '../../components/common/AppSnackbar';
import { useAppLinkHandler } from '../../hooks/useAppLinkHandler';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import VoiceInputButton from '../../components/common/VoiceInputButton';
import { useSettingsStore } from '../../stores/useSettingsStore';
import type { AppCommandCandidate, AppCommandChoice, AppCommandRoute, LocalActionPlan } from '../appCommand/commandTypes';
import { getRandomHomeCommandPlaceholderIndex, HOME_COMMAND_PLACEHOLDERS, resolveHomeCommandSubmissionValue } from './placeholders';

type PendingConfirmation = {
  input: string;
  route: AppCommandRoute;
  secrets: Record<string, string>;
  title: string;
  message: string;
  candidates?: AppCommandCandidate[];
  choices?: AppCommandChoice[];
};

type CommandFeedback = {
  severity: 'success' | 'info' | 'error';
  title: string;
  message: string;
};

function buildDefaultChoices(pending: PendingConfirmation): AppCommandChoice[] {
  if (pending.choices?.length) return pending.choices;
  if (pending.candidates?.length) {
    return pending.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      description: candidate.description,
      url: candidate.url,
      kind: 'execute',
    }));
  }
  return [
    { id: 'confirm', label: pending.title || '确认执行', kind: 'confirm' },
    { id: 'cancel', label: '取消', kind: 'cancel' },
  ];
}

function resolveChoicePresentation(choices: AppCommandChoice[]) {
  const longest = Math.max(...choices.map((choice) => choice.label.length + (choice.description?.length || 0)), 0);
  if (choices.length > 5) return 'select';
  if (choices.length > 3 || longest > 18) return 'list';
  return 'chips';
}

export default function HomeCommandLauncher() {
  const navigate = useNavigate();
  const appLink = useAppLinkHandler();
  const [input, setInput] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(() => getRandomHomeCommandPlaceholderIndex(-1));
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<CommandFeedback | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const preloadedRef = useRef(false);
  const sttModel = useSettingsStore((state) => state.aiProfiles.find((profile) => profile.type === 'stt' && (profile.isDefault || profile.provider))
    || state.aiProfiles.find((profile) => profile.type === 'audio' && (profile.audioCapability === 'stt' || profile.audioCapability === 'both')));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlaceholderIndex((index) => getRandomHomeCommandPlaceholderIndex(index));
    }, 3600);
    return () => window.clearInterval(timer);
  }, []);

  const placeholder = useMemo(() => HOME_COMMAND_PLACEHOLDERS[placeholderIndex], [placeholderIndex]);
  const preload = () => {
    if (preloadedRef.current) return;
    preloadedRef.current = true;
    void import('./handleHomeCommand');
  };

  const submit = async (rawInput = input) => {
    const hasTypedInput = rawInput.trim().length > 0;
    const value = resolveHomeCommandSubmissionValue(rawInput, placeholder);
    if (!value || loading) return;
    if (!hasTypedInput) {
      setInput(value);
    }
    setLoading(true);
    setFeedback(null);
    setPending(null);
    try {
      const { handleHomeCommand } = await import('./handleHomeCommand');
      const handled = await handleHomeCommand(value, navigate);
      if (handled.result.status === 'needs_confirmation') {
        setPending({
          input: value,
          route: handled.route,
          secrets: handled.secrets,
          title: handled.result.title,
          message: handled.result.message,
          candidates: handled.result.candidates,
          choices: handled.result.choices,
        });
      } else {
        setFeedback({ severity: handled.result.status === 'success' ? 'success' : 'info', title: handled.result.title, message: handled.result.message });
        setInput('');
      }
    } catch (error) {
      setFeedback({ severity: 'error', title: '无法执行指令', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  const speechInput = useSpeechInput({
    profile: sttModel,
    disabled: loading,
    getBaseText: () => input,
    onTranscript: setInput,
    onFinalized: (text) => { if (text.trim()) { setInput(text); void submit(text); } },
    onError: (message) => setFeedback({ severity: 'error', title: '语音输入失败', message }),
  });

  const confirm = async () => {
    if (!pending || loading) return;
    setLoading(true);
    setFeedback(null);
    try {
      const { confirmHomeCommand } = await import('./handleHomeCommand');
      const result = await confirmHomeCommand(pending.input, pending.route, pending.secrets, navigate);
      if (result.status === 'needs_confirmation') {
        setPending({
          ...pending,
          title: result.title,
          message: result.message,
          candidates: result.candidates,
          choices: result.choices,
        });
      } else {
        setFeedback({ severity: result.status === 'success' ? 'success' : 'info', title: result.title, message: result.message });
        setPending(null);
        setInput('');
      }
    } catch (error) {
      setFeedback({ severity: 'error', title: '执行失败', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  const choose = async (choice: AppCommandChoice) => {
    if (!pending || loading) return;
    if (choice.kind === 'cancel') {
      setPending(null);
      return;
    }
    if (choice.url && !choice.plan) {
      if (!appLink.openAppHref(choice.url)) navigate(choice.url);
      setPending(null);
      setInput('');
      return;
    }
    if (choice.plan && (pending.route.mode === 'local_action' || pending.route.mode === 'workflow')) {
      const basePlan = pending.route.mode === 'local_action'
        ? pending.route.plan
        : choice.plan.plan?.action
          ? choice.plan.plan
          : null;
      const action = choice.plan.action || choice.plan.plan?.action || basePlan?.action;
      if (!basePlan || !action) {
        setFeedback({ severity: 'error', title: '无法执行选项', message: '这个选项缺少可执行计划，请重新描述一次。' });
        return;
      }
      const nextPlan: LocalActionPlan = {
        ...basePlan,
        ...(choice.plan.plan || {}),
        action,
      };
      const nextRoute: AppCommandRoute = {
        mode: 'local_action',
        action: nextPlan.action,
        plan: nextPlan,
        riskLevel: pending.route.riskLevel,
        requiresConfirmation: false,
      };
      setLoading(true);
      setFeedback(null);
      try {
        const { confirmHomeCommand } = await import('./handleHomeCommand');
        const result = await confirmHomeCommand(pending.input, nextRoute, pending.secrets, navigate);
        setFeedback({ severity: result.status === 'success' ? 'success' : 'info', title: result.title, message: result.message });
        setPending(null);
        setInput('');
      } catch (error) {
        setFeedback({ severity: 'error', title: '执行失败', message: error instanceof Error ? error.message : String(error) });
      } finally {
        setLoading(false);
      }
      return;
    }
    await confirm();
  };

  return (
    <SurfaceCard
      sx={{
        borderColor: 'divider',
      }}
      contentSx={{
        pb: { xs: 1, sm: 1.25 },
        '&:last-child': { pb: { xs: 1, sm: 1.25 } },
      }}
    >
      <Box sx={{ display: 'grid', gap: 1.25, '& > .MuiCollapse-hidden': { display: 'none' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <AutoAwesomeIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>你想做什么</Typography>
          </Box>
          <VoiceInputButton
            isRecording={speechInput.isRecording}
            isTranscribing={speechInput.isTranscribing}
            disabled={loading}
            onStart={speechInput.startRecording}
            onStop={speechInput.stopRecording}
            sx={{
              width: 38,
              height: 38,
            }}
          />
        </Box>
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
            gap: 1,
            alignItems: 'stretch',
          }}
        >
          <TextField
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            onFocus={preload}
            placeholder={placeholder}
            size="small"
            fullWidth
            multiline
            minRows={1}
            maxRows={4}
            sx={{ minWidth: 0 }}
            slotProps={{ htmlInput: { 'aria-label': '自然语言指令' } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            sx={{ minWidth: 0, px: 2, whiteSpace: 'nowrap', justifySelf: { xs: 'end', sm: 'auto' } }}
          >
            执行
          </Button>
        </Box>
        <Collapse in={Boolean(pending)}>
          {pending ? (
            <Alert severity="info">
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{pending.title}</Typography>
              <Typography variant="body2">{pending.message}</Typography>
              {(() => {
                const choices = buildDefaultChoices(pending);
                const presentation = resolveChoicePresentation(choices);
                if (presentation === 'list') {
                  return (
                    <Box sx={{ display: 'grid', gap: 0.75, mt: 1 }}>
                      {choices.map((choice) => (
                        <Button key={choice.id} size="small" variant={choice.kind === 'cancel' ? 'text' : 'outlined'} onClick={() => void choose(choice)} sx={{ justifyContent: 'flex-start', textAlign: 'left' }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{choice.label}</Typography>
                            {choice.description ? <Typography variant="caption" color="text.secondary">{choice.description}</Typography> : null}
                          </Box>
                        </Button>
                      ))}
                    </Box>
                  );
                }
                return (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                    {choices.map((choice) => (
                      <Button key={choice.id} size="small" variant={choice.kind === 'cancel' ? 'text' : 'outlined'} onClick={() => void choose(choice)}>
                        {choice.label}
                      </Button>
                    ))}
                  </Box>
                );
              })()}
            </Alert>
          ) : null}
        </Collapse>
        <Collapse in={Boolean(feedback)}>
          {feedback ? (
            <Alert severity={feedback.severity}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{feedback.title}</Typography>
              <Typography variant="body2">{feedback.message}</Typography>
            </Alert>
          ) : null}
        </Collapse>
        <AppSnackbar
          open={appLink.feedback.open}
          message={appLink.feedback.message}
          severity="warning"
          action={appLink.feedback.action}
          onClose={appLink.closeFeedback}
        />
      </Box>
    </SurfaceCard>
  );
}
