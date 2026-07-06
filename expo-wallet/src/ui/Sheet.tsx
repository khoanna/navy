import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from './theme';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Bottom sheet: a translucent scrim + slide-up panel. Tapping the scrim calls
 * onClose; tapping the panel does not. Safe-area bottom inset is respected.
 * Ports the web Sheet component using React Native Modal.
 */
export function Sheet({ open, onClose, children }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Full-screen scrim — tap to close */}
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Panel — stop propagation by not calling onClose */}
        <Pressable style={[styles.panel, { paddingBottom: space.xl + insets.bottom }]} onPress={() => {}}>
          {/* Drag handle */}
          <View style={styles.handle} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2,4,10,0.55)',
    justifyContent: 'flex-end',
  },
  panel: {
    width: '100%',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: space.md,
    paddingHorizontal: space.xl,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: space.lg,
  },
});
