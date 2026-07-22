import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import { colors, radius, space } from '@/ui/theme';
import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { UsernameClient } from '@/lib/account/usernameClient';
import { normalizeUsername, isValidUsername } from '@/lib/account/username';

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const STATUS_META: Record<Status, { text: string; color: string } | null> = {
  idle: null,
  checking: { text: 'Checking availability…', color: colors.textDim },
  available: { text: 'Available', color: colors.success },
  taken: { text: 'Already taken', color: colors.danger },
  invalid: { text: '3–20 chars: lowercase letters, numbers, underscore', color: colors.textDim },
};

export function UsernameSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { authedFetch } = useNavySession();

  const client = useMemo(() => {
    if (!authedFetch) return null;
    return new UsernameClient(getEnv().navyApiUrl, authedFetch);
  }, [authedFetch]);

  const [value, setValue] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load current handle on open and prefill.
  useEffect(() => {
    if (!open || !client) return;
    let active = true;
    client
      .me()
      .then((me) => {
        if (!active) return;
        setCurrent(me.username);
        setValue(me.username ?? '');
        setStatus('idle');
      })
      .catch(() => {
        /* leave blank on load failure */
      });
    return () => {
      active = false;
    };
  }, [open, client]);

  const normalized = normalizeUsername(value);

  // Debounced availability check as the user types.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!client) return;

    // Empty / unchanged from the current handle → nothing to check.
    if (normalized === '' || normalized === current) {
      setStatus('idle');
      return;
    }
    if (!isValidUsername(normalized)) {
      setStatus('invalid');
      return;
    }

    setStatus('checking');
    debounceRef.current = setTimeout(() => {
      client
        .checkAvailable(normalized)
        .then((r) => setStatus(r.available ? 'available' : 'taken'))
        .catch(() => setStatus('idle'));
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [normalized, current, client]);

  const close = () => {
    setValue('');
    setCurrent(null);
    setStatus('idle');
    setSaving(false);
    onClose();
  };

  const save = async () => {
    if (!client) return;
    setSaving(true);
    try {
      await client.setUsername(normalized);
      toast(`Username set to @${normalized}`);
      close();
    } catch (e) {
      toast(`Could not set username: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  const meta = STATUS_META[status];
  const canSave =
    status === 'available' && isValidUsername(normalized) && normalized !== current;

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>
          Username
        </Text>
        <Text variant="caption" muted>
          A handle lets others send you money by @name instead of a wallet address.
        </Text>

        <View style={styles.inputRow}>
          <Text variant="bodyStrong" color={colors.textDim} style={styles.at}>
            @
          </Text>
          <TextInput
            style={styles.input}
            placeholder="handle"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            value={value}
            onChangeText={setValue}
          />
        </View>

        {meta && (
          <Text variant="caption" color={meta.color}>
            {meta.text}
          </Text>
        )}

        <Button
          label="Save username"
          loading={saving}
          disabled={!canSave}
          onPress={save}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  at: {
    marginRight: space.xs,
  },
  input: {
    flex: 1,
    paddingVertical: space.lg,
    color: colors.textHi,
    fontSize: 16,
  },
});
