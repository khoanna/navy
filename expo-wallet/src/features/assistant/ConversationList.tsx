import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { colors, radius, space } from '@/ui/theme';
import { useNavySession } from '@/lib/auth/SessionContext';
import { getEnv } from '@/lib/config/env';

export interface Conversation {
  id: string;
  updatedAt: string;
  messages: Array<{ text: string; role: string }>;
}

interface ConversationListProps {
  open: boolean;
  onClose: () => void;
  /** Called with the conversation id to load it in the chat. */
  onSelect: (id: string) => void;
  /** Called to start a fresh conversation (clears conversationId). */
  onNew: () => void;
  activeId?: string | null;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchConversations(
  baseUrl: string,
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<Conversation[]> {
  const res = await authedFetch(`${baseUrl}/agent/conversations`);
  if (!res.ok) throw new Error(`fetch conversations failed (${res.status})`);
  return (await res.json()) as Conversation[];
}

async function deleteConversation(
  baseUrl: string,
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  id: string,
): Promise<void> {
  const res = await authedFetch(`${baseUrl}/agent/conversations/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`delete conversation failed (${res.status})`);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function firstText(conv: Conversation): string {
  const first = conv.messages.find((m) => m.role === 'user');
  if (!first) return 'Empty conversation';
  const raw = first.text.trim();
  return raw.length > 50 ? raw.slice(0, 47) + '…' : raw;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── item ──────────────────────────────────────────────────────────────────────

function ConversationItem({
  item,
  isActive,
  onSelect,
  onDelete,
}: {
  item: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <Pressable
      style={[styles.item, isActive && styles.itemActive]}
      onPress={onSelect}
    >
      <View style={styles.itemContent}>
        <Text
          variant="body"
          color={isActive ? colors.aqua : colors.textHi}
          style={{ maxWidth: 240 }}
        >
          {firstText(item)}
        </Text>
        <Text variant="caption" muted>
          {formatDate(item.updatedAt)}
        </Text>
      </View>
      <Pressable
        style={styles.deleteBtn}
        hitSlop={12}
        onPress={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="x" size={16} color={colors.danger} />
      </Pressable>
    </Pressable>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

export function ConversationList({
  open,
  onClose,
  onSelect,
  onNew,
  activeId,
}: ConversationListProps) {
  const { authedFetch } = useNavySession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const baseUrl = getEnv().navyApiUrl;

  // Load conversations whenever the sheet opens.
  useEffect(() => {
    if (!open || !authedFetch) return;
    let active = true;
    setLoading(true);
    fetchConversations(baseUrl, authedFetch)
      .then((list) => { if (active) setConversations(list); })
      .catch(() => { /* swallow — list stays empty */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, authedFetch, baseUrl]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleNew = useCallback(() => {
    onNew();
    onClose();
  }, [onNew, onClose]);

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert(
        'Delete conversation?',
        'This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (!authedFetch) return;
              setDeletingId(id);
              try {
                await deleteConversation(baseUrl, authedFetch, id);
                setConversations((prev) => prev.filter((c) => c.id !== id));
                // If we deleted the active conversation, start fresh.
                if (id === activeId) onNew();
              } catch {
                Alert.alert('Could not delete conversation.');
              } finally {
                setDeletingId(null);
              }
            },
          },
        ],
      );
    },
    [authedFetch, baseUrl, activeId, onNew],
  );

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ConversationItem
        item={item}
        isActive={item.id === activeId}
        onSelect={() => handleSelect(item.id)}
        onDelete={() => handleDelete(item.id)}
      />
    ),
    [activeId, handleSelect, handleDelete],
  );

  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  return (
    <Sheet open={open} onClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.titleRow}>
          <Text variant="h3" color={colors.textHi}>
            Conversations
          </Text>
          <Pressable style={styles.newBtn} onPress={handleNew} hitSlop={8}>
            <Icon name="plus" size={16} color={colors.onAccent} />
            <Text variant="bodyStrong" color={colors.onAccent}>
              New
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.aqua} />
          </View>
        ) : conversations.length === 0 ? (
          <View style={styles.empty}>
            <Text dim center>
              No conversations yet. Ask the assistant something!
            </Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Sheet>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrap: {
    maxHeight: 420,
    minHeight: 120,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    paddingBottom: space.sm,
  },
  sep: {
    height: 1,
    backgroundColor: colors.border,
  },
  loading: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
  },
  itemActive: {
    opacity: 0.7,
  },
  itemContent: {
    flex: 1,
    gap: space.xs,
  },
  deleteBtn: {
    padding: space.sm,
  },
});
