'use client';
import React, { useRef, useState } from 'react';
import { colors, gradients, radius } from './theme';
import { Text } from './Text';
import { Gradient } from './Gradient';
import { Icon } from './Icon';
import { clampProgress, isConfirmed } from '@/lib/ui/slide';

const KNOB = 46;

export interface SlideToConfirmProps {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}

/** Drag-to-confirm control for money-moving actions. Snaps back if released early. */
export function SlideToConfirm({ label, onConfirm, disabled }: SlideToConfirmProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  const trackPx = () => (trackRef.current?.offsetWidth ?? 0) - KNOB - 8;

  const move = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = clientX - rect.left - KNOB / 2;
    const t = trackPx();
    const clamped = Math.max(0, Math.min(raw, t));
    setOffset(clamped);
    if (isConfirmed(clampProgress(clamped, t)) && !done) {
      setDone(true);
      setDragging(false);
      setOffset(t);
      onConfirm();
    }
  };

  const start = () => { if (!disabled && !done) setDragging(true); };
  const end = () => {
    setDragging(false);
    if (!done) setOffset(0);
  };

  return (
    <div
      ref={trackRef}
      onMouseMove={(e) => dragging && move(e.clientX)}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchMove={(e) => dragging && move(e.touches[0].clientX)}
      onTouchEnd={end}
      style={{
        position: 'relative',
        height: 54,
        borderRadius: `${radius.pill}px`,
        background: colors.surfaceHi,
        border: `1px solid ${colors.borderStrong}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        opacity: disabled ? 0.5 : 1,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <Text variant="bodyStrong" color={colors.textDim}>
        {done ? 'Confirmed' : label}
      </Text>
      <div
        onMouseDown={start}
        onTouchStart={start}
        style={{
          position: 'absolute',
          left: 4,
          top: 4,
          width: KNOB,
          height: KNOB,
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 200ms cubic-bezier(0.22,1,0.36,1)',
          cursor: disabled ? 'not-allowed' : 'grab',
        }}
      >
        <Gradient
          colors={gradients.ocean}
          style={{
            width: KNOB,
            height: KNOB,
            borderRadius: `${radius.pill}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="chevron" size={22} color={colors.onAccent} strokeWidth={2.4} />
        </Gradient>
      </div>
    </div>
  );
}
