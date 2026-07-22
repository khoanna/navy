import React, { useCallback, useReducer, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNavySession } from '@/lib/auth/SessionContext';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { getEnv } from '@/lib/config/env';
import {
  chatReducer,
  initialChat,
  type ChatMessageVM,
} from '@/lib/agent/chatReducer';
import type { SseEvent } from '@/lib/agent/sseParser';
import { streamAgentChat } from '@/lib/agent/agentClient';
import { TransferClient } from '@/lib/transfer/transferClient';
import { FarmingClient } from '@/lib/farming/farmingClient';
import { mapSendError } from '@/lib/wallet/sendErrors';

import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { colors, radius, space } from '@/ui/theme';

import { PortfolioCard } from '@/features/assistant/PortfolioCard';
import { ChartCard } from '@/features/assistant/ChartCard';
import { TransferConfirmCard } from '@/features/assistant/TransferConfirmCard';
import { FarmingConfirmCard } from '@/features/assistant/FarmingConfirmCard';

export default function Assistant() {
  const { session, authedFetch } = useNavySession();
  const token = session?.tokens.accessToken;
  const { signTypedData, sendTransaction } = useMobileSigner();

  const [state, dispatch] = useReducer(chatReducer, undefined, initialChat);
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // Map an SSE frame to a reducer action.
  const onEvent = useCallback((e: SseEvent) => {
    switch (e.event) {
      case 'token':
        dispatch({ type: 'token', delta: e.data.delta });
        break;
      case 'tool_start':
        dispatch({ type: 'tool_start', name: e.data.name });
        break;
      case 'tool_result':
        dispatch({ type: 'tool_result', name: e.data.name, result: e.data.result });
        break;
      case 'done':
        dispatch({ type: 'done', conversationId: e.data.conversationId });
        break;
      case 'error':
        dispatch({ type: 'error', message: e.data.message });
        break;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!text || !token) return;
      dispatch({ type: 'send', text });
      try {
        await streamAgentChat(
          getEnv().navyApiUrl,
          token,
          { message: text, conversationId: state.conversationId },
          onEvent,
        );
      } catch (err) {
        dispatch({
          type: 'error',
          message: err instanceof Error ? err.message : 'Something went wrong',
        });
      }
    },
    [token, state.conversationId, onEvent],
  );

  // The input's send button: guard streaming, clear the box, then dispatch.
  const submitInput = useCallback(() => {
    const text = input.trim();
    if (!text || state.streaming) return;
    setInput('');
    void send(text);
  }, [input, state.streaming, send]);

  // Sign the returned typedData + submit (authorization already built server-side).
  const onConfirmTransfer = useCallback(
    (result: any) => async () => {
      try {
        if (result.asset === 'ETH') {
          const txHash = await sendTransaction({ to: result.to, valueWei: result.amountWei });
          await new TransferClient(getEnv().navyApiUrl, authedFetch!).recordEth(result.to, result.amountWei, txHash);
        } else {
          const sig = await signTypedData(result.typedData);
          await new TransferClient(getEnv().navyApiUrl, authedFetch!).submit(result.transferId, sig);
        }
      } catch (e) {
        const { title, detail } = mapSendError(e);
        void send(`The send failed: ${title} — ${detail}. Briefly explain and tell me what to do next.`);
        throw e; // let the confirm card show its Failed state too
      }
    },
    [signTypedData, sendTransaction, authedFetch, send],
  );

  const onConfirmFarming = useCallback(
    (result: any) => async () => {
      const fc = new FarmingClient(getEnv().navyApiUrl, undefined, authedFetch ?? undefined);
      if (result.display.action === 'farming_deposit') {
        await fc.deposit(token!, result.amountBase);
      } else {
        await fc.withdraw(token!, result.amount);
      }
    },
    [authedFetch, token],
  );

  // Guard: no session / no authed fetch → prompt to sign in.
  if (!token || !authedFetch) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Icon name="bolt" size={48} color={colors.textDim} />
          <Text variant="h3" color={colors.text} center style={styles.gap}>
            Sign in to chat
          </Text>
          <Text dim center>
            The Navy assistant needs an active session.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text variant="h2" color={colors.textHi}>
          Assistant
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        >
          {state.messages.length === 0 && (
            <View style={styles.empty}>
              <Text dim center>
                Ask about your portfolio, send USDC, or farm — I draft it, you sign.
              </Text>
            </View>
          )}

          {state.messages.map((m, i) => (
            <MessageRow
              key={i}
              message={m}
              streaming={state.streaming}
              isTrailing={i === state.messages.length - 1}
              onConfirmTransfer={onConfirmTransfer}
              onConfirmFarming={onConfirmFarming}
            />
          ))}

          {state.error && (
            <View style={styles.errorBubble}>
              <Text variant="caption" color={colors.danger}>
                {state.error}
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message the assistant"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            editable={!state.streaming}
            onSubmitEditing={submitInput}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={submitInput}
            disabled={!input.trim() || state.streaming}
            style={[
              styles.sendBtn,
              (!input.trim() || state.streaming) && styles.sendBtnDisabled,
            ]}
          >
            {state.streaming ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Icon name="send" size={18} color={colors.onAccent} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── message rendering ────────────────────────────────────────────────────────

function MessageRow({
  message,
  streaming,
  isTrailing,
  onConfirmTransfer,
  onConfirmFarming,
}: {
  message: ChatMessageVM;
  streaming: boolean;
  isTrailing: boolean;
  onConfirmTransfer: (result: any) => () => Promise<void>;
  onConfirmFarming: (result: any) => () => Promise<void>;
}) {
  if (message.role === 'user') {
    return (
      <View style={[styles.bubbleRow, styles.userRow]}>
        <View style={[styles.bubble, styles.userBubble]}>
          <Text color={colors.onAccent}>{message.text}</Text>
        </View>
      </View>
    );
  }

  if (message.role === 'assistant') {
    const isTypingPlaceholder = streaming && isTrailing && message.text === '';
    return (
      <View style={[styles.bubbleRow, styles.assistantRow]}>
        <View style={[styles.bubble, styles.assistantBubble]}>
          {isTypingPlaceholder ? (
            <Text dim>…</Text>
          ) : (
            <Text color={colors.text}>{message.text}</Text>
          )}
        </View>
      </View>
    );
  }

  // Tool message.
  return (
    <View style={[styles.bubbleRow, styles.assistantRow]}>
      <ToolRender
        message={message}
        onConfirmTransfer={onConfirmTransfer}
        onConfirmFarming={onConfirmFarming}
      />
    </View>
  );
}

function ToolRender({
  message,
  onConfirmTransfer,
  onConfirmFarming,
}: {
  message: Extract<ChatMessageVM, { role: 'tool' }>;
  onConfirmTransfer: (result: any) => () => Promise<void>;
  onConfirmFarming: (result: any) => () => Promise<void>;
}) {
  const { name, result } = message;

  if (!result) {
    return (
      <View style={styles.chip}>
        <ActivityIndicator size="small" color={colors.aqua} />
        <Text variant="caption" dim>
          Running {name}…
        </Text>
      </View>
    );
  }

  const display = result.display ?? {};
  const kind: string = display.kind;

  if (kind === 'chart') {
    return <ChartCard result={result} />;
  }

  if (kind === 'action') {
    if (display.action === 'transfer') {
      return <TransferConfirmCard result={result} onConfirm={onConfirmTransfer(result)} />;
    }
    if (display.action === 'farming_deposit' || display.action === 'farming_withdraw') {
      return <FarmingConfirmCard result={result} onConfirm={onConfirmFarming(result)} />;
    }
  }

  if (kind === 'card') {
    // Portfolio / farming summary have usdcBase/ethWei/farming; render richly.
    if (result.usdcBase !== undefined || result.ethWei !== undefined || result.farming !== undefined) {
      return <PortfolioCard result={result} />;
    }
    // Other card-shaped results (history / resolve): compact generic chip.
    return (
      <View style={styles.genericCard}>
        <Text variant="caption" dim>
          {name}
        </Text>
      </View>
    );
  }

  // Unknown display hint → quiet chip.
  return (
    <View style={styles.genericCard}>
      <Text variant="caption" dim>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  gap: {
    marginTop: space.md,
    marginBottom: space.xs,
  },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    gap: space.sm,
  },
  empty: {
    marginTop: space.xxxl,
    paddingHorizontal: space.lg,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '86%',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
  },
  userBubble: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genericCard: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorBubble: {
    alignSelf: 'flex-start',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,107,131,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,131,0.3)',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textHi,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.aqua,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
