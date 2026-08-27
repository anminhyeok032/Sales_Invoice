import { useState } from 'react';

export function useDragReorder(onReorder) {
  const [draggedItemIndex, setDraggedItemIndex] = useState(null);
  const [activeDragHandleIndex, setActiveDragHandleIndex] = useState(null);

  const handleDragStart = (e, index) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;
    onReorder(draggedItemIndex, targetIndex);
    setDraggedItemIndex(null);
    setActiveDragHandleIndex(null);
  };

  return {
    draggedItemIndex,
    activeDragHandleIndex,
    setActiveDragHandleIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
  };
}
