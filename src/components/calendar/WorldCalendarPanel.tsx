import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, FormControl, MenuItem, Select, Stack, Typography } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PlaceIcon from '@mui/icons-material/Place';
import ScheduleIcon from '@mui/icons-material/Schedule';
import GroupsIcon from '@mui/icons-material/Groups';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import type { WorldCalendarItem } from '../../services/worldRuntimeProjection';
import EmptyState from '../common/EmptyState';
import AppSnackbar from '../common/AppSnackbar';
import SurfaceCard from '../common/SurfaceCard';
import { projectWorldCalendar } from '../../services/worldRuntimeProjection';
import { buildWorldCalendarPatchApplyPlan } from '../../services/worldCalendarPatchPlanner';
import { applyWorldCalendarPatchDraftQueue } from '../../services/worldCalendarPatchApply';
import { summarizeParticipantStateCounts } from '../../services/worldCalendarPresentation';
import {
  filterAndSortCalendarItems,
  groupCalendarItemsByDay,
  startOfDay,
  type CalendarKindFilter,
  type CalendarStatusFilter,
} from '../../services/worldCalendarViewModel';
import { buildInteractiveSurfaceSx, compactPillChipSx } from '../../styles/interaction';
import BaseCalendar from './BaseCalendar';

const calendarFilterChipSx = {
  ...compactPillChipSx,
  height: 30,
  fontSize: 12,
  '& .MuiChip-label': { px: 1.2, lineHeight: '30px' },
};

const calendarMetaChipSx = {
  ...compactPillChipSx,
  height: 24,
  maxWidth: '100%',
  '& .MuiChip-label': {
    px: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatDayTitle(timestamp: number, isZh: boolean) {
  const day = new Date(startOfDay(timestamp));
  const today = startOfDay(Date.now());
  const diffDays = Math.round((startOfDay(timestamp) - today) / 86400000);
  if (isZh) {
    if (diffDays === 0) return `今天 · ${day.toLocaleDateString()}`;
    if (diffDays === 1) return `明天 · ${day.toLocaleDateString()}`;
    if (diffDays === -1) return `昨天 · ${day.toLocaleDateString()}`;
    return day.toLocaleDateString();
  }
  if (diffDays === 0) return `Today · ${day.toLocaleDateString()}`;
  if (diffDays === 1) return `Tomorrow · ${day.toLocaleDateString()}`;
  if (diffDays === -1) return `Yesterday · ${day.toLocaleDateString()}`;
  return day.toLocaleDateString();
}

function formatScheduleHint(item: { startAt?: number | null; endAt?: number | null; durationMinutes?: number | null; timeHint?: string | null }, isZh: boolean) {
  const hasStart = typeof item.startAt === 'number';
  const hasEnd = typeof item.endAt === 'number';
  const hasDuration = typeof item.durationMinutes === 'number' && item.durationMinutes > 0;
  if (hasStart && hasEnd) return `${new Date(item.startAt as number).toLocaleString()} - ${new Date(item.endAt as number).toLocaleString()}`;
  if (hasStart && hasDuration) return isZh ? `${new Date(item.startAt as number).toLocaleString()}（约${item.durationMinutes}分钟）` : `${new Date(item.startAt as number).toLocaleString()} (~${item.durationMinutes} min)`;
  if (hasStart) return new Date(item.startAt as number).toLocaleString();
  return item.timeHint || null;
}

function getCalendarStatusMeta(status: WorldCalendarItem['status'], isZh: boolean) {
  const zh: Record<WorldCalendarItem['status'], string> = {
    tentative: '待确认',
    planned: '已计划',
    confirmed: '已确认',
    in_progress: '进行中',
    completed: '已完成',
    cancelled: '已取消',
  };
  const en: Record<WorldCalendarItem['status'], string> = {
    tentative: 'Tentative',
    planned: 'Planned',
    confirmed: 'Confirmed',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  const color: 'default' | 'primary' | 'success' | 'warning' = status === 'confirmed'
    ? 'primary'
    : status === 'completed'
      ? 'success'
      : status === 'cancelled'
        ? 'warning'
        : 'default';
  return { label: isZh ? zh[status] : en[status], color };
}

interface WorldCalendarPanelProps {
  chats: GroupChat[];
  characters: AICharacter[];
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  isZh: boolean;
  conversationId?: string | null;
  actorId?: string | null;
  compact?: boolean;
  title?: string;
  subtitle?: string;
  showHeader?: boolean;
}

export default function WorldCalendarPanel({
  chats,
  characters,
  updateChat,
  isZh,
  conversationId,
  actorId,
  compact = false,
  title,
  subtitle,
  showHeader = true,
}: WorldCalendarPanelProps) {
  const isGlobalCalendarPage = !compact && !conversationId && !actorId;
  const [kindFilter, setKindFilter] = useState<CalendarKindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<CalendarStatusFilter>('all');
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const userAdjustedCalendarRef = useRef(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [isApplyingPatchQueue, setIsApplyingPatchQueue] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const projection = useMemo(() => projectWorldCalendar(chats, characters, { conversationId: conversationId || undefined }), [chats, characters, conversationId]);
  const calendarItems = projection.items;
  const patchPlan = useMemo(() => buildWorldCalendarPatchApplyPlan(projection), [projection]);
  const patchDraftQueue = patchPlan.queue;
  const chainDraftGroupCount = useMemo(
    () => new Set(patchDraftQueue.map((item) => item.chainGroupId).filter((item): item is string => Boolean(item))).size,
    [patchDraftQueue],
  );
  const currentConversation = useMemo(() => (conversationId ? chats.find((chat) => chat.id === conversationId) : null), [chats, conversationId]);
  const actorNameMap = useMemo(() => new Map(characters.map((character) => [character.id, character.name])), [characters]);
  const selectedDayStart = startOfDay(selectedDate.getTime());
  const baseFilteredItems = useMemo(() => filterAndSortCalendarItems({
    items: calendarItems,
    actorId,
    kindFilter,
    statusFilter,
    selectedDayStart: null,
  }), [actorId, calendarItems, kindFilter, statusFilter]);

  useEffect(() => {
    if (!compact || userAdjustedCalendarRef.current) return;
    const firstItem = baseFilteredItems[0];
    setIsCalendarExpanded(Boolean(firstItem));
    if (firstItem) setSelectedDate(new Date(startOfDay(firstItem.startAt ?? firstItem.updatedAt)));
  }, [baseFilteredItems, compact]);

  const filteredItems = useMemo(
    () => baseFilteredItems.filter((item) => startOfDay(item.startAt ?? item.updatedAt) === selectedDayStart),
    [baseFilteredItems, selectedDayStart],
  );

  const groupedItems = useMemo(() => groupCalendarItemsByDay(filteredItems), [filteredItems]);
  const dayTitlesByStart = useMemo(() => {
    const map = new Map<number, string[]>();
    baseFilteredItems.forEach((item) => {
      const key = startOfDay(item.startAt ?? item.updatedAt);
      const titles = map.get(key);
      if (titles) {
        titles.push(item.title);
      } else {
        map.set(key, [item.title]);
      }
    });
    return map;
  }, [baseFilteredItems]);
  const detailItem = useMemo(() => filteredItems.find((item) => item.id === detailItemId) || null, [detailItemId, filteredItems]);

  const handleApplyPatchQueue = async () => {
    if (!patchDraftQueue.length || isApplyingPatchQueue) return;
    setIsApplyingPatchQueue(true);
    try {
      const execution = await applyWorldCalendarPatchDraftQueue({
        chats,
        characters,
        updateChat,
        conversationId,
        trigger: compact ? 'sidebar_projection' : 'manual',
        continueOnPersistError: true,
      });
      setSnackbar({
        open: true,
        message: isZh
          ? `已应用 ${execution.appliedCount} 条草案${execution.skippedCount ? `，跳过 ${execution.skippedCount} 条` : ''}${execution.failedCount ? `，失败 ${execution.failedCount} 条` : ''}`
          : `Applied ${execution.appliedCount} draft(s)${execution.skippedCount ? `, skipped ${execution.skippedCount}` : ''}${execution.failedCount ? `, failed ${execution.failedCount}` : ''}`,
        severity: 'success',
      });
    } catch (error) {
      setSnackbar({
        open: true,
        message: error instanceof Error ? error.message : (isZh ? '应用草案失败' : 'Failed to apply drafts'),
        severity: 'error',
      });
    } finally {
      setIsApplyingPatchQueue(false);
    }
  };

  return (
    <Box sx={{ px: compact ? 0 : { xs: 1.25, sm: 1.75, md: 2 }, py: compact ? 0 : { xs: 1.25, sm: 1.75, md: 2 }, maxWidth: 'none', mx: 'auto' }}>
      {showHeader ? (
        <Stack direction="row" spacing={1.25} sx={{ mb: 2, alignItems: 'center' }}>
          <CalendarMonthIcon color="primary" />
          <Box>
            <Typography variant={compact ? 'h6' : 'h5'} sx={{ fontWeight: 820, letterSpacing: 0 }}>
              {title || (isZh ? '日历' : 'Calendar')}
            </Typography>
            {subtitle ? <Typography variant="body2" color="text.secondary">{subtitle}</Typography> : null}
          </Box>
        </Stack>
      ) : null}

      {conversationId ? (
        <Chip
          size="small"
          variant="outlined"
          sx={{ ...calendarMetaChipSx, mb: 2 }}
          label={isZh ? `当前会话：${currentConversation?.name || '已删除会话'}` : `Conversation: ${currentConversation?.name || 'Deleted conversation'}`}
        />
      ) : null}
      {actorId ? (
        <Chip
          size="small"
          variant="outlined"
          sx={{ ...calendarMetaChipSx, mb: 2, ml: conversationId ? 1 : 0 }}
          label={isZh ? `参与者：${actorId === 'user' ? '用户' : (actorNameMap.get(actorId) || actorId)}` : `Participant: ${actorId === 'user' ? 'User' : (actorNameMap.get(actorId) || actorId)}`}
        />
      ) : null}

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <SurfaceCard
          sx={{
            width: '100%',
            flex: {
              xs: '1 1 auto',
              lg: isGlobalCalendarPage
                ? '0 1 clamp(420px, 44vw, 560px)'
                : '0 0 clamp(360px, 34vw, 450px)',
            },
            alignSelf: compact ? 'flex-start' : 'stretch',
          }}
          contentSx={{ p: { xs: 1, sm: 1.25 }, '&:last-child': { pb: { xs: 1, sm: 1.25 } } }}
        >
          <BaseCalendar
            isZh={isZh}
            selectedDate={selectedDate}
            onSelectDate={(date) => {
              userAdjustedCalendarRef.current = true;
              setSelectedDate(date);
            }}
            mode="month"
            dayCellMinHeight={isCalendarExpanded ? 72 : 38}
            dayContentMinHeight={isCalendarExpanded ? 62 : 30}
            toggle={{
              expanded: isCalendarExpanded,
              onToggle: () => {
                userAdjustedCalendarRef.current = true;
                setIsCalendarExpanded((prev) => !prev);
              },
              expandedLabel: isZh ? '收起' : 'Collapse',
              collapsedLabel: isZh ? '展开' : 'Expand',
              expandedAria: isZh ? '收起日期详情' : 'Collapse date details',
              collapsedAria: isZh ? '展开日期详情' : 'Expand date details',
            }}
            monthFormat={{ month: 'long' }}
            getDayMeta={(day, inMonth) => {
              const key = startOfDay(day.getTime());
              const titles = dayTitlesByStart.get(key) || [];
              return {
                inMonth,
                hasDot: !isCalendarExpanded && titles.length > 0,
                titles: isCalendarExpanded ? titles.slice(0, 2) : [],
              };
            }}
          />
        </SurfaceCard>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ mb: 1.35, display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              <Chip size="small" clickable sx={calendarFilterChipSx} color={kindFilter === 'all' ? 'primary' : 'default'} variant={kindFilter === 'all' ? 'filled' : 'outlined'} label={isZh ? '全部' : 'All'} onClick={() => setKindFilter('all')} />
              <Chip size="small" clickable sx={calendarFilterChipSx} color={kindFilter === 'activity' ? 'primary' : 'default'} variant={kindFilter === 'activity' ? 'filled' : 'outlined'} label={isZh ? '活动' : 'Activities'} onClick={() => setKindFilter('activity')} />
              <Chip size="small" clickable sx={calendarFilterChipSx} color={kindFilter === 'travel' ? 'primary' : 'default'} variant={kindFilter === 'travel' ? 'filled' : 'outlined'} label={isZh ? '行程' : 'Travel'} onClick={() => setKindFilter('travel')} />
              <Chip size="small" clickable sx={calendarFilterChipSx} color={kindFilter === 'reminder' ? 'primary' : 'default'} variant={kindFilter === 'reminder' ? 'filled' : 'outlined'} label={isZh ? '提醒' : 'Reminders'} onClick={() => setKindFilter('reminder')} />
            </Box>
            <FormControl
              size="small"
              sx={{
                flexShrink: 0,
                flex: '0 1 auto',
                width: { xs: 'clamp(120px, 34vw, 166px)', sm: 'clamp(150px, 24vw, 220px)' },
                minWidth: { xs: 120, sm: 150 },
                maxWidth: { xs: 166, sm: 220 },
                '& .MuiOutlinedInput-root': {
                  height: 30,
                  borderRadius: '14px',
                  bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.64)' : 'rgba(16,18,26,0.58)',
                  backdropFilter: 'blur(18px) saturate(1.05)',
                  WebkitBackdropFilter: 'blur(18px) saturate(1.05)',
                  boxShadow: (theme) => theme.palette.mode === 'light'
                    ? '0 10px 24px rgba(15,23,42,0.06), 0 1px 0 rgba(255,255,255,0.7) inset'
                    : '0 12px 28px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.05) inset',
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.11)' : 'rgba(226,232,240,0.12)',
                },
                '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.34)' : 'rgba(120,156,220,0.28)',
                },
              }}
            >
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as CalendarStatusFilter)}
                sx={{
                  minWidth: 0,
                  '& .MuiSelect-select': {
                    py: 0.25,
                    px: { xs: 1, sm: 1.75 },
                    fontSize: 13,
                    lineHeight: 1.25,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }}
              >
                <MenuItem value="all">{isZh ? '全部状态' : 'All status'}</MenuItem>
                <MenuItem value="upcoming">{isZh ? '待进行' : 'Upcoming'}</MenuItem>
                <MenuItem value="in_progress">{isZh ? '进行中' : 'In progress'}</MenuItem>
                <MenuItem value="completed">{isZh ? '已完成' : 'Completed'}</MenuItem>
                <MenuItem value="cancelled">{isZh ? '已取消' : 'Cancelled'}</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Typography variant="subtitle2" sx={{ mb: 1.25, fontWeight: 760, color: 'text.secondary' }}>
            {formatDayTitle(selectedDayStart || Date.now(), isZh)}
          </Typography>

      {patchDraftQueue.length ? (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" color="warning" sx={calendarMetaChipSx} label={isZh ? `冲突修正草案队列 ${patchDraftQueue.length} 条` : `Conflict Draft Queue ${patchDraftQueue.length}`} />
          {chainDraftGroupCount > 0 ? (
            <Chip
              size="small"
              variant="outlined"
              color="info"
              sx={calendarMetaChipSx}
              label={isZh ? `链式顺延 ${chainDraftGroupCount} 组` : `Chained shifts ${chainDraftGroupCount} group(s)`}
            />
          ) : null}
          <Button
            size="small"
            variant="contained"
            color="warning"
            startIcon={<DoneAllIcon />}
            disabled={isApplyingPatchQueue}
            onClick={() => { void handleApplyPatchQueue(); }}
          >
            {isApplyingPatchQueue ? (isZh ? '应用中...' : 'Applying...') : (isZh ? '应用草案队列' : 'Apply Draft Queue')}
          </Button>
        </Stack>
      ) : null}

          {!groupedItems.length ? (
        <EmptyState
          icon="📅"
          message={isZh ? '当前筛选下还没有日程。可以切换类型或状态筛选查看其他活动。' : 'No schedule under current filters. Try switching type or status filters.'}
        />
      ) : (
            <Stack spacing={1.1}>
              {groupedItems.flatMap((group) => group.items).map((item) => {
                const scheduleHint = formatScheduleHint(item, isZh);
                const statusMeta = getCalendarStatusMeta(item.status, isZh);
                return (
                  <SurfaceCard
                    key={item.id}
                    sx={{ cursor: 'pointer', ...buildInteractiveSurfaceSx() }}
                    contentSx={{ p: compact ? 1.2 : 1.45, '&:last-child': { pb: compact ? 1.2 : 1.45 } }}
                    onClick={() => setDetailItemId(item.id)}
                  >
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 760, letterSpacing: 0 }}>{item.title}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.2 }}>{item.summary}</Typography>
                        </Box>
                        <Chip size="small" color={statusMeta.color} variant="outlined" sx={calendarMetaChipSx} label={statusMeta.label} />
                      </Stack>
                      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
                        {scheduleHint ? <Chip size="small" icon={<ScheduleIcon />} sx={calendarMetaChipSx} label={scheduleHint} /> : null}
                        {item.locationHint ? <Chip size="small" icon={<PlaceIcon />} sx={calendarMetaChipSx} label={item.locationHint} /> : null}
                        {item.participantNames.length ? <Chip size="small" icon={<GroupsIcon />} sx={calendarMetaChipSx} label={item.participantNames.join('、')} /> : null}
                        {Object.keys(item.participantStates).length ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            sx={calendarMetaChipSx}
                            label={(isZh ? '参与状态' : 'Participant states') + ' · ' + summarizeParticipantStateCounts(item.participantStates, isZh).slice(0, 2).join(' / ')}
                          />
                        ) : null}
                        <Chip size="small" variant="outlined" sx={calendarMetaChipSx} label={`${isZh ? '来源' : 'Sources'} ${item.sourceRefs.length}`} />
                      </Stack>
                  </SurfaceCard>
                );
              })}
            </Stack>
          )}
        </Box>
      </Stack>
      <AppSnackbar
        open={snackbar.open}
        severity={snackbar.severity}
        message={snackbar.message}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      />
      <Dialog open={Boolean(detailItem)} onClose={() => setDetailItemId(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detailItem?.title || (isZh ? '活动详情' : 'Event details')}</DialogTitle>
        <DialogContent>
          {detailItem ? (
            <Stack spacing={1.2} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">{detailItem.summary}</Typography>
              <Typography variant="body2">{isZh ? '时间：' : 'Time: '}{formatScheduleHint(detailItem, isZh) || '-'}</Typography>
              <Typography variant="body2">{isZh ? '地点：' : 'Location: '}{detailItem.locationHint || '-'}</Typography>
              <Typography variant="body2">{isZh ? '参与者：' : 'Participants: '}{detailItem.participantNames.join(isZh ? '、' : ', ') || '-'}</Typography>
              <Typography variant="body2">{isZh ? '来源事件数：' : 'Source events: '}{detailItem.sourceRefs.length}</Typography>
              <Typography variant="caption" color="text.secondary">{isZh ? '更新时间：' : 'Updated: '}{formatTime(detailItem.updatedAt)}</Typography>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
