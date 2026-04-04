/**
 * mediaDragContext
 * ─────────────────────────────────────────────────────────────────────────────
 * A tiny shared module that lets MediaPool set the currently-dragged asset ID
 * so TimelinePanel can read it during dragenter/dragover events.
 *
 * Browser security prevents reading dataTransfer data during dragenter/dragover
 * (only MIME type keys are visible, not values).  This module bridges that gap.
 */

let _draggedAssetId: string | null = null;

export function setDraggedAssetId(id: string | null): void {
  _draggedAssetId = id;
}

export function getDraggedAssetId(): string | null {
  return _draggedAssetId;
}
