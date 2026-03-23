'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import styles from './AvatarCropModal.module.css';

const CROP_INSET_RATIO = 0.08;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function AvatarCropModal({ file, onCancel, onConfirm }) {
  const [imageUrl, setImageUrl] = useState('');
  const [imageEl, setImageEl] = useState(null);
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewportSize, setViewportSize] = useState(320);
  const dragStartRef = useRef(null);
  const offsetStartRef = useRef(null);
  const pointerIdRef = useRef(null);
  const viewportRef = useRef(null);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setImageEl(null);
    setOffset({ x: 0, y: 0 });
    setScale(1);
    setMinScale(1);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!viewportRef.current) return undefined;
    const element = viewportRef.current;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const next = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
      setViewportSize(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(element);
    return () => ro.disconnect();
  }, []);

  const displayState = useMemo(() => {
    if (!imageEl) return null;
    const w = imageEl.naturalWidth || imageEl.width;
    const h = imageEl.naturalHeight || imageEl.height;
    if (!w || !h) return null;

    const cropSize = viewportSize * (1 - CROP_INSET_RATIO * 2);
    const cropLeft = (viewportSize - cropSize) / 2;
    const cropTop = cropLeft;

    // Show the full image initially, then let user scale up as needed.
    const containScale = Math.min(cropSize / w, cropSize / h);
    const baseWidth = w * containScale;
    const baseHeight = h * containScale;
    const coverScaleFromContain = Math.max(cropSize / baseWidth, cropSize / baseHeight);
    const effectiveScale = Math.max(scale, coverScaleFromContain);
    const scaledWidth = baseWidth * effectiveScale;
    const scaledHeight = baseHeight * effectiveScale;
    const maxX = Math.max(0, (scaledWidth - cropSize) / 2);
    const maxY = Math.max(0, (scaledHeight - cropSize) / 2);
    const x = clamp(offset.x, -maxX, maxX);
    const y = clamp(offset.y, -maxY, maxY);

    return {
      naturalWidth: w,
      naturalHeight: h,
      cropSize,
      cropLeft,
      cropTop,
      containScale,
      minScale: coverScaleFromContain,
      scale: effectiveScale,
      baseWidth,
      baseHeight,
      scaledWidth,
      scaledHeight,
      maxX,
      maxY,
      x,
      y,
    };
  }, [imageEl, offset.x, offset.y, scale, viewportSize]);

  useEffect(() => {
    if (!displayState) return;
    if (minScale !== displayState.minScale) {
      setMinScale(displayState.minScale);
    }
    if (scale < displayState.minScale) {
      setScale(displayState.minScale);
    }
    if (offset.x !== displayState.x || offset.y !== displayState.y) {
      setOffset({ x: displayState.x, y: displayState.y });
    }
  }, [displayState, minScale, offset.x, offset.y, scale]);

  const handleLoadedImage = (e) => {
    const img = e.currentTarget;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return;
    setImageEl(img);
    const cropSize = viewportSize * (1 - CROP_INSET_RATIO * 2);
    const containScale = Math.min(cropSize / w, cropSize / h);
    const baseWidth = w * containScale;
    const baseHeight = h * containScale;
    const nextMinScale = Math.max(cropSize / baseWidth, cropSize / baseHeight);
    setMinScale(nextMinScale);
    setScale(nextMinScale);
    setOffset({ x: 0, y: 0 });
  };

  const onPointerDown = (e) => {
    if (!displayState) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    setDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    offsetStartRef.current = { ...offset };
  };

  const onPointerMove = (e) => {
    if (!dragging || !displayState || !dragStartRef.current || !offsetStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({
      x: clamp(offsetStartRef.current.x + dx, -displayState.maxX, displayState.maxX),
      y: clamp(offsetStartRef.current.y + dy, -displayState.maxY, displayState.maxY),
    });
  };

  const stopDragging = () => {
    setDragging(false);
    pointerIdRef.current = null;
    dragStartRef.current = null;
    offsetStartRef.current = null;
  };

  const buildCroppedBlob = async () => {
    if (!imageEl || !displayState) throw new Error('Image not ready');

    const effectiveScale = displayState.containScale * displayState.scale;
    const imageLeft = displayState.cropLeft + (displayState.cropSize - displayState.scaledWidth) / 2 + displayState.x;
    const imageTop = displayState.cropTop + (displayState.cropSize - displayState.scaledHeight) / 2 + displayState.y;
    const sourceSize = displayState.cropSize / effectiveScale;
    const sourceX = clamp((displayState.cropLeft - imageLeft) / effectiveScale, 0, displayState.naturalWidth - sourceSize);
    const sourceY = clamp((displayState.cropTop - imageTop) / effectiveScale, 0, displayState.naturalHeight - sourceSize);

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    ctx.drawImage(
      imageEl,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9);
    });

    return blob;
  };

  const handleApply = async () => {
    if (!displayState || saving) return;
    setSaving(true);
    try {
      const blob = await buildCroppedBlob();
      onConfirm(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Crop profile photo"
      onClose={onCancel}
      maxWidth="460px"
      actions={[
        { label: 'Cancel', onClick: onCancel, variant: 'secondary', disabled: saving },
        { label: saving ? 'Applying...' : 'Apply crop', onClick: handleApply, disabled: !displayState || saving },
      ]}
    >
      <div className={styles.body}>
        <p className={styles.hint}>Drag to position and scale. The crop area is always fully covered by the image.</p>
        <div
          ref={viewportRef}
          className={styles.viewport}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopDragging}
          onPointerLeave={stopDragging}
          onPointerCancel={stopDragging}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Crop preview"
              draggable={false}
              className={styles.image}
              style={{
                left: displayState
                  ? `${displayState.cropLeft + (displayState.cropSize - displayState.baseWidth) / 2 + displayState.x}px`
                  : '0',
                top: displayState
                  ? `${displayState.cropTop + (displayState.cropSize - displayState.baseHeight) / 2 + displayState.y}px`
                  : '0',
                width: displayState ? `${displayState.baseWidth}px` : '100%',
                height: displayState ? `${displayState.baseHeight}px` : 'auto',
                transform: displayState ? `scale(${displayState.scale})` : 'none',
                transformOrigin: 'center center',
                cursor: dragging ? 'grabbing' : 'grab',
              }}
              onLoad={handleLoadedImage}
            />
          ) : null}
          <div className={styles.cropCircle} aria-hidden />
        </div>
        <label className={styles.zoomLabel} htmlFor="avatar-zoom-range">Scale</label>
        <input
          id="avatar-zoom-range"
          type="range"
          min={minScale}
          max={3}
          step={0.01}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          className={styles.range}
        />
      </div>
    </Modal>
  );
}
