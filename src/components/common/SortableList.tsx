import { Box } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';

interface SortableListProps<T extends { id: string }> {
  items: T[];
  onChange?: (items: T[]) => void;
  renderItem: (params: { item: T; index: number; isDragging: boolean; isDropTarget: boolean; dropEdge: 'top' | 'bottom' | null }) => React.ReactNode;
  getItemSx?: (params: { item: T; index: number; isDragging: boolean; isDropTarget: boolean; dropEdge: 'top' | 'bottom' | null }) => Record<string, unknown>;
  getGapIndicatorSx?: (params: { item: T; index: number; isDropTarget: boolean; dropEdge: 'top' | 'bottom' | null }) => Record<string, unknown>;
  gap?: number;
}

function shouldShowGapBefore(index: number, dropTargetIndex: number, dropEdge: 'top' | 'bottom' | null) {
  return dropTargetIndex === index && dropEdge === 'top';
}

function shouldShowGapAfter(index: number, dropTargetIndex: number, dropEdge: 'top' | 'bottom' | null) {
  return dropTargetIndex === index && dropEdge === 'bottom';
}

function buildDefaultGapIndicatorSx(visible: boolean) {
  return {
    height: visible ? 8 : 0,
    mx: 1,
    borderRadius: 999,
    bgcolor: visible ? 'primary.main' : 'transparent',
    transition: 'height 120ms ease',
    pointerEvents: 'none' as const,
  };
}

function mergeSx(base: Record<string, unknown>, extra?: Record<string, unknown>) {
  return extra ? { ...base, ...extra } : base;
}

export default function SortableList<T extends { id: string }>({ items, onChange, renderItem, getItemSx, getGapIndicatorSx, gap = 1 }: SortableListProps<T>) {

  const [orderedItems, setOrderedItems] = useState(items);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null);
  const [dropTargetEdge, setDropTargetEdge] = useState<'top' | 'bottom' | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const draggingItemIdRef = useRef<string | null>(null);
  const orderedItemsRef = useRef(items);

  useEffect(() => {
    if (!draggingItemIdRef.current) {
      setOrderedItems(items);
    }
  }, [items]);

  useEffect(() => {
    orderedItemsRef.current = orderedItems;
  }, [orderedItems]);

  const lastEmittedOrderRef = useRef<string>('');

  useEffect(() => {
    const nextOrderKey = orderedItems.map((item) => item.id).join('|');
    if (lastEmittedOrderRef.current === nextOrderKey) return;
    lastEmittedOrderRef.current = nextOrderKey;
    onChange?.(orderedItems);
  }, [onChange, orderedItems]);

  useEffect(() => {
    draggingItemIdRef.current = draggingItemId;
  }, [draggingItemId]);

  const orderedEntries = useMemo(() => orderedItems.map((item) => ({ id: item.id, item })), [orderedItems]);

  function reorderItems(activeItemId: string, targetItemId: string, edge: 'top' | 'bottom') {
    if (activeItemId === targetItemId) return;
    const current = orderedItemsRef.current;
    const fromIndex = current.findIndex((item) => item.id === activeItemId);
    const targetIndex = current.findIndex((item) => item.id === targetItemId);
    if (fromIndex === -1 || targetIndex === -1) return;
    const next = [...current];
    const [activeItem] = next.splice(fromIndex, 1);
    const adjustedTargetIndex = next.findIndex((item) => item.id === targetItemId);
    const insertIndex = edge === 'top' ? adjustedTargetIndex : adjustedTargetIndex + 1;
    const clampedIndex = Math.max(0, Math.min(insertIndex, next.length));
    next.splice(clampedIndex, 0, activeItem);
    if (next.every((item, index) => item.id === current[index]?.id)) return;
    orderedItemsRef.current = next;
    setOrderedItems(next);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap }}>
      {orderedEntries.map(({ id, item }, index) => {
        const isDragging = draggingItemId === id;
        const isDropTarget = dropTargetItemId === id && draggingItemId !== id;
        const dropEdge = isDropTarget ? dropTargetEdge : null;
        return (
          <Box
            key={id}
            data-sortable-item-id={id}
              onPointerDown={(event) => {
              dragPointerIdRef.current = event.pointerId;
              draggingItemIdRef.current = id;
              setDraggingItemId(id);
              setDropTargetItemId(null);
              setDropTargetEdge(null);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const activeItemId = draggingItemIdRef.current;
              if (!activeItemId || dragPointerIdRef.current !== event.pointerId) return;
              const element = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-sortable-item-id]') as HTMLElement | null;
              const targetItemId = element?.dataset.sortableItemId;
              if (!targetItemId || targetItemId === activeItemId) return;
              const rect = element.getBoundingClientRect();
              const edge = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
              setDropTargetItemId(targetItemId);
              setDropTargetEdge(edge);
              reorderItems(activeItemId, targetItemId, edge);
            }}
            onPointerUp={(event) => {
              if (dragPointerIdRef.current === event.pointerId) {
                dragPointerIdRef.current = null;
                draggingItemIdRef.current = null;
                setDraggingItemId(null);
                setDropTargetItemId(null);
                setDropTargetEdge(null);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (dragPointerIdRef.current === event.pointerId) {
                dragPointerIdRef.current = null;
                draggingItemIdRef.current = null;
                setDraggingItemId(null);
                setDropTargetItemId(null);
                setDropTargetEdge(null);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            sx={getItemSx?.({ item, index, isDragging, isDropTarget, dropEdge }) || {}}
          >
            {renderItem({ item, index, isDragging, isDropTarget, dropEdge })}
          </Box>
        );
      })}
    </Box>
  );
}
