'use client';
import React, { useState } from 'react';
import { colors, radius, space, gradients } from './theme';
import { Text } from './Text';
import { Gradient } from './Gradient';
import { Icon, IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: React.CSSProperties;
}

/**
 * Pressable button with a press-scale effect. The primary variant rides the ocean
 * gradient; others are flat surfaces. Replaces RN's bare <Button> everywhere.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  full = true,
  style,
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const isDisabled = disabled || loading;

  const tint =
    variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : colors.textHi;

  const fillStyle: React.CSSProperties = {
    height: 54,
    borderRadius: `${radius.pill}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: `${space.xl}px`,
    paddingRight: `${space.xl}px`,
  };

  const secondaryStyle: React.CSSProperties = {
    backgroundColor: colors.surfaceHi,
    border: `1px solid ${colors.borderStrong}`,
  };

  const ghostStyle: React.CSSProperties = {
    backgroundColor: colors.glassFill,
    border: `1px solid ${colors.border}`,
  };

  const dangerBgStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255,107,131,0.12)',
    border: '1px solid rgba(255,107,131,0.3)',
  };

  // CSS translation of shadow.accentGlow
  const accentGlowStyle: React.CSSProperties = {
    boxShadow: '0 10px 22px rgba(79,140,255,0.5)',
  };

  const Inner = (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: `${space.sm}px` }}>
      {loading ? (
        <span
          style={{
            display: 'inline-block',
            width: 16,
            height: 16,
            border: `2px solid ${tint}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      ) : (
        <>
          {icon && <Icon name={icon} size={18} color={tint} strokeWidth={2} />}
          <Text variant="bodyStrong" color={tint}>
            {label}
          </Text>
        </>
      )}
    </div>
  );

  const wrapperStyle: React.CSSProperties = {
    ...(full ? { alignSelf: 'stretch', width: '100%' } : {}),
    transform: pressed ? 'scale(0.96)' : 'scale(1)',
    transition: 'transform 120ms',
    ...style,
  };

  const buttonBaseStyle: React.CSSProperties = {
    borderRadius: `${radius.pill}px`,
    overflow: 'hidden',
    width: '100%',
    padding: 0,
    border: 'none',
    background: 'none',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.45 : 1,
    display: 'block',
  };

  return (
    <div
      style={wrapperStyle}
      onMouseDown={() => !isDisabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => !isDisabled && setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onTouchCancel={() => setPressed(false)}
    >
      <button
        onClick={onPress}
        disabled={isDisabled}
        style={buttonBaseStyle}
      >
        {variant === 'primary' ? (
          <Gradient
            colors={gradients.ocean}
            style={{ ...fillStyle, ...(!isDisabled ? accentGlowStyle : {}) }}
          >
            {Inner}
          </Gradient>
        ) : (
          <div
            style={{
              ...fillStyle,
              ...(variant === 'ghost' ? ghostStyle : secondaryStyle),
              ...(variant === 'danger' ? dangerBgStyle : {}),
            }}
          >
            {Inner}
          </div>
        )}
      </button>
    </div>
  );
}
