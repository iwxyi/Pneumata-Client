import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from '@mui/material';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import NavigateBeforeOutlinedIcon from '@mui/icons-material/NavigateBeforeOutlined';
import NavigateNextOutlinedIcon from '@mui/icons-material/NavigateNextOutlined';
import { copyTextToClipboard } from '../../utils/clipboard';
import { ensureAssistantArtifactStoreHydrated, useAssistantArtifactStore } from '../../stores/useAssistantArtifactStore';
import type { AssistantArtifactItem, AssistantArtifactVersion } from '../../types/assistantArtifact';
import AssistantHtmlFrame, { type AssistantHtmlInteractionPayload, type AssistantHtmlRuntimeError } from './AssistantHtmlFrame';

function currentVersion(item: AssistantArtifactItem) {
  return item.versions.find((version) => version.id === item.currentVersionId) || item.versions.at(-1) || null;
}

function visibleVersion(item: AssistantArtifactItem, versionId: string | null) {
  return item.versions.find((version) => version.id === versionId) || currentVersion(item);
}

function versionLabel(item: AssistantArtifactItem, version: AssistantArtifactVersion | null) {
  if (!version) return '';
  const index = item.versions.findIndex((entry) => entry.id === version.id);
  return index < 0 ? '' : `${index + 1} / ${item.versions.length}`;
}

function downloadHtml(item: AssistantArtifactItem, version: AssistantArtifactVersion) {
  const blob = new Blob([version.content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${item.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'assistant-artifact'}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function AssistantHtmlFullscreenDialog({ artifactId, onClose, onAutosave, onSubmit, onRepair }: {
  artifactId: string | null;
  onClose: () => void;
  onAutosave?: (input: AssistantHtmlInteractionPayload) => void | Promise<void>;
  onSubmit?: (input: AssistantHtmlInteractionPayload) => void | Promise<void>;
  onRepair?: (error: AssistantHtmlRuntimeError) => void | Promise<void>;
}) {
  const artifact = useAssistantArtifactStore((state) => state.items.find((item) => item.id === artifactId && item.kind === 'html' && item.deletedAt == null) || null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const historyMarkerRef = useRef(`assistant-html-fullscreen:${artifactId || 'none'}`);

  useEffect(() => {
    if (artifactId) void ensureAssistantArtifactStoreHydrated();
  }, [artifactId]);

  useEffect(() => {
    const nextVersionId = artifact ? currentVersion(artifact)?.id || null : null;
    const timer = window.setTimeout(() => setVersionId(nextVersionId), 0);
    return () => window.clearTimeout(timer);
  }, [artifact]);

  useEffect(() => {
    if (!artifactId) return undefined;
    const marker = historyMarkerRef.current;
    const currentState = window.history.state;
    const baseState = currentState && typeof currentState === 'object' ? currentState as Record<string, unknown> : {};
    if (baseState.assistantHtmlFullscreen !== marker) {
      window.history.pushState({ ...baseState, assistantHtmlFullscreen: marker }, '', window.location.href);
    }
    const handlePopState = () => onClose();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [artifactId, onClose]);

  const requestClose = useCallback(() => {
    onClose();
    if (window.history.state?.assistantHtmlFullscreen === historyMarkerRef.current) {
      window.history.back();
    }
  }, [onClose]);

  const version = useMemo(() => artifact ? visibleVersion(artifact, versionId) : null, [artifact, versionId]);
  const latestVersion = artifact ? currentVersion(artifact) : null;
  const versionIndex = artifact && version ? artifact.versions.findIndex((entry) => entry.id === version.id) : -1;
  const stepVersion = (direction: -1 | 1) => {
    if (!artifact || versionIndex < 0) return;
    const next = artifact.versions[versionIndex + direction];
    if (next) setVersionId(next.id);
  };

  return (
    <Dialog open={Boolean(artifactId)} onClose={requestClose} fullScreen slotProps={{ paper: { sx: { bgcolor: 'background.default', color: 'text.primary' } } }}>
      {artifact && version?.htmlRuntime ? (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: { xs: 1, sm: 2 }, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifact.title}</Typography>
            </Box>
            <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0 }}>
              <IconButton onClick={() => stepVersion(-1)} disabled={versionIndex <= 0} aria-label="上一版本"><NavigateBeforeOutlinedIcon /></IconButton>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 48, textAlign: 'center' }}>{versionLabel(artifact, version)}</Typography>
              {version.stage === 'autosave' ? <Chip size="small" color="warning" variant="outlined" label="自动保存" sx={{ height: 22 }} /> : null}
              <IconButton onClick={() => stepVersion(1)} disabled={versionIndex < 0 || versionIndex >= artifact.versions.length - 1} aria-label="下一版本"><NavigateNextOutlinedIcon /></IconButton>
              <IconButton onClick={() => void copyTextToClipboard(version.content)} aria-label="复制 HTML"><ContentCopyOutlinedIcon /></IconButton>
              <IconButton onClick={() => downloadHtml(artifact, version)} aria-label="下载 HTML"><DownloadOutlinedIcon /></IconButton>
              <IconButton onClick={requestClose} aria-label="关闭 HTML 页面"><CloseOutlinedIcon /></IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent sx={{ p: 0, bgcolor: 'background.default', display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <AssistantHtmlFrame
              artifactId={artifact.id}
              version={version}
              manifest={version.htmlRuntime}
              fillContainer
              readOnly={version.id !== latestVersion?.id && version.stage !== 'autosave'}
              onAutosave={onAutosave}
              onSubmit={onSubmit}
              onRequestRepair={onRepair}
            />
          </DialogContent>
        </>
      ) : null}
    </Dialog>
  );
}
