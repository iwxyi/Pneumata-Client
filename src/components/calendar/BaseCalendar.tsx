import { useMemo, useState } from 'react';
import { Box, Button, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';

export type CalendarViewMode = 'month' | 'week';

export interface CalendarDayRenderMeta {
  disabled?: boolean;
  selected?: boolean;
  inMonth?: boolean;
  hasDot?: boolean;
  titles?: string[];
}

interface BaseCalendarProps {
  isZh: boolean;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  mode: CalendarViewMode;
  monthFormat?: Intl.DateTimeFormatOptions;
  toggle?: {
    expanded: boolean;
    onToggle: () => void;
    expandedLabel: string;
    collapsedLabel: string;
    expandedAria: string;
    collapsedAria: string;
  };
  getDayMeta?: (date: Date, inMonth: boolean) => CalendarDayRenderMeta;
  dayCellMinHeight?: number;
  dayContentMinHeight?: number;
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getWeekStart(date: Date) {
  const start = new Date(date);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  return start;
}

function getWeekDays(date: Date) {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function getCalendarDays(monthDate: Date) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + index);
    return day;
  });
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

export default function BaseCalendar({
  isZh,
  selectedDate,
  onSelectDate,
  mode,
  monthFormat,
  toggle,
  getDayMeta,
  dayCellMinHeight,
  dayContentMinHeight,
}: BaseCalendarProps) {
  const selectedDateKey = toDateKey(selectedDate);
  const selectedMonth = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), [selectedDate]);
  const [visibleMonthState, setVisibleMonthState] = useState(() => ({
    selectedDateKey,
    month: selectedMonth,
  }));
  const [yearMenuAnchor, setYearMenuAnchor] = useState<null | HTMLElement>(null);
  const [monthMenuAnchor, setMonthMenuAnchor] = useState<null | HTMLElement>(null);
  const visibleMonth = visibleMonthState.selectedDateKey === selectedDateKey ? visibleMonthState.month : selectedMonth;
  const setVisibleMonth = (updater: Date | ((previous: Date) => Date)) => {
    setVisibleMonthState((previous) => ({
      selectedDateKey,
      month: typeof updater === 'function' ? updater(previous.selectedDateKey === selectedDateKey ? previous.month : selectedMonth) : updater,
    }));
  };
  const monthKey = toMonthKey(visibleMonth);
  const yearLabel = `${visibleMonth.getFullYear()}${isZh ? '年' : ''}`;
  const monthLabel = visibleMonth.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', monthFormat || { month: 'long' });
  const weekdays = isZh ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const yearOptions = useMemo(
    () => Array.from({ length: 121 }, (_, i) => visibleMonth.getFullYear() - 60 + i),
    [visibleMonth],
  );
  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, month) => ({
      month,
      label: new Date(2026, month, 1).toLocaleDateString(isZh ? 'zh-CN' : 'en-US', monthFormat || { month: 'long' }),
    })),
    [isZh, monthFormat],
  );

  const anchor = toMonthKey(selectedDate) === monthKey ? selectedDate : visibleMonth;
  const calendarDays = useMemo(() => mode === 'month' ? getCalendarDays(visibleMonth) : getWeekDays(anchor), [mode, visibleMonth, anchor]);

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 36px auto', alignItems: 'center', gap: 0.5 }}>
        <IconButton size="small" onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))} aria-label={isZh ? '上个月' : 'Previous month'}>
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, minWidth: 0 }}>
          <CalendarMonthIcon fontSize="small" color="primary" />
          <Button
            size="small"
            disableRipple
            onClick={(event) => setYearMenuAnchor(event.currentTarget)}
            sx={{ minWidth: 0, px: 0.5, fontWeight: 750, textTransform: 'none' }}
          >
            {yearLabel}
          </Button>
          <Button
            size="small"
            disableRipple
            onClick={(event) => setMonthMenuAnchor(event.currentTarget)}
            sx={{ minWidth: 0, px: 0.5, fontWeight: 750, textTransform: 'none' }}
          >
            {monthLabel}
          </Button>
        </Box>
        <IconButton size="small" onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))} aria-label={isZh ? '下个月' : 'Next month'}>
          <ChevronRightIcon fontSize="small" />
        </IconButton>
        {toggle ? (
          <Button
            size="small"
            disableRipple
            onClick={toggle.onToggle}
            aria-label={toggle.expanded ? toggle.expandedAria : toggle.collapsedAria}
            endIcon={toggle.expanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
          >
            {toggle.expanded ? toggle.expandedLabel : toggle.collapsedLabel}
          </Button>
        ) : <Box />}
      </Box>
      <Menu
        anchorEl={yearMenuAnchor}
        open={Boolean(yearMenuAnchor)}
        onClose={() => setYearMenuAnchor(null)}
        slotProps={{
          paper: {
            sx: { maxHeight: 300, width: 120 },
          },
        }}
      >
        {yearOptions.map((year) => (
          <MenuItem
            key={year}
            selected={year === visibleMonth.getFullYear()}
            onClick={() => {
              setVisibleMonth((prev) => new Date(year, prev.getMonth(), 1));
              setYearMenuAnchor(null);
            }}
          >
            {isZh ? `${year}年` : year}
          </MenuItem>
        ))}
      </Menu>
      <Menu
        anchorEl={monthMenuAnchor}
        open={Boolean(monthMenuAnchor)}
        onClose={() => setMonthMenuAnchor(null)}
        slotProps={{
          paper: {
            sx: { maxHeight: 320, width: 132 },
          },
        }}
      >
        {monthOptions.map((option) => (
          <MenuItem
            key={option.month}
            selected={option.month === visibleMonth.getMonth()}
            onClick={() => {
              setVisibleMonth((prev) => new Date(prev.getFullYear(), option.month, 1));
              setMonthMenuAnchor(null);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
        {weekdays.map((weekday, index) => <Typography key={`${weekday}-${index}`} variant="caption" color="text.secondary" sx={{ textAlign: 'center', fontWeight: 700 }}>{weekday}</Typography>)}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
        {calendarDays.map((day) => {
          const inMonth = toMonthKey(day) === monthKey;
          const meta = getDayMeta?.(day, inMonth) || {};
          const selected = meta.selected ?? (toDateKey(day) === toDateKey(selectedDate));
          const disabled = meta.disabled ?? false;
          return (
            <Button
              key={toDateKey(day)}
              size="small"
              disableRipple
              disabled={disabled}
              onClick={() => onSelectDate(day)}
              sx={{
                minWidth: 0,
                minHeight: dayCellMinHeight ?? (mode === 'month' ? 38 : 34),
                p: 0.4,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                color: selected ? 'primary.contrastText' : inMonth ? 'text.primary' : 'text.disabled',
                bgcolor: selected ? 'primary.main' : 'transparent',
                border: '1px solid',
                borderColor: selected ? 'primary.main' : 'transparent',
                opacity: inMonth ? 1 : 0.42,
                '&:hover': { bgcolor: selected ? 'primary.dark' : 'rgba(25, 118, 210, 0.12)' },
                '&.Mui-disabled': { opacity: inMonth ? 0.58 : 0.22 },
              }}
            >
              <Stack spacing={0.15} sx={{ alignItems: 'center', width: '100%', minHeight: dayContentMinHeight ?? (mode === 'month' ? 30 : 22) }}>
                <Typography sx={{ fontSize: 12, lineHeight: 1 }}>{day.getDate()}</Typography>
                {meta.titles?.slice(0, 2).map((title, idx) => (
                  <Typography
                    key={`${title}-${idx}`}
                    sx={{ fontSize: 9, lineHeight: 1.1, maxWidth: '100%', px: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {title}
                  </Typography>
                ))}
                {!meta.titles?.length && meta.hasDot ? (
                  <Box sx={{ width: 5, height: 5, borderRadius: '999px', bgcolor: selected ? 'primary.contrastText' : 'primary.main' }} />
                ) : null}
              </Stack>
            </Button>
          );
        })}
      </Box>
    </Box>
  );
}
