import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

interface Props<T extends { id: string }> {
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  /** Rendered after the items (e.g. an "add more" tile); not sortable */
  trailing?: ReactNode;
  label: (item: T, index: number) => string;
}

/**
 * Drag-and-drop grid (mouse, touch and keyboard: focus a card, Space to lift,
 * arrows to move, Space to drop). Clicks on buttons inside cards still work: a drag
 * only starts after the pointer moves 6px.
 */
export function SortableGrid<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  trailing,
  label,
}: Props<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Screen-reader announcements in plain words (dnd-kit's defaults read out internal ids).
  const name = (id: string | number) => {
    const i = items.findIndex((x) => x.id === id);
    return i >= 0 ? label(items[i], i) : "item";
  };
  const position = (id: string | number | undefined) => items.findIndex((x) => x.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${name(active.id)}. Use the arrow keys to move, Space to drop.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${name(active.id)} is over position ${position(over.id)} of ${items.length}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${name(active.id)} at position ${position(over.id)} of ${items.length}.`
        : `Dropped ${name(active.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${name(active.id)} is back where it was.`,
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.id === e.active.id);
    const to = items.findIndex((i) => i.id === e.over!.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To reorder, press Space to pick up, use the arrow keys to move, then Space to drop. Press Escape to cancel.",
        },
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {items.map((item, index) => (
            <SortableTile key={item.id} id={item.id} label={label(item, index)}>
              {renderItem(item, index)}
            </SortableTile>
          ))}
          {trailing}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableTile({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={label}
      className={cn(
        "touch-none cursor-grab rounded-lg border border-border bg-card p-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        isDragging && "z-10 shadow-lg ring-2 ring-primary",
      )}
    >
      {children}
    </div>
  );
}
