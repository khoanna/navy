import React from 'react';
import { View, Text as RNText, StyleSheet, Linking, type TextStyle } from 'react-native';

import { colors, space, radius, type as typeScale } from '@/ui/theme';
import { parseMarkdown, type Block, type Inline } from '@/lib/agent/markdown';

/** Renders parsed inline spans as nested <Text> with per-span styling. */
function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.type) {
          case 'bold':
            return (
              <RNText key={i} style={styles.bold}>
                {s.value}
              </RNText>
            );
          case 'italic':
            return (
              <RNText key={i} style={styles.italic}>
                {s.value}
              </RNText>
            );
          case 'code':
            return (
              <RNText key={i} style={styles.inlineCode}>
                {s.value}
              </RNText>
            );
          case 'link':
            return (
              <RNText
                key={i}
                style={styles.link}
                onPress={() => {
                  void Linking.openURL(s.href).catch(() => {});
                }}
              >
                {s.value}
              </RNText>
            );
          default:
            return <RNText key={i}>{s.value}</RNText>;
        }
      })}
    </>
  );
}

function BlockView({ block, first }: { block: Block; first: boolean }) {
  const gap = first ? undefined : styles.blockGap;

  switch (block.type) {
    case 'heading':
      return (
        <RNText style={[headingStyle(block.level), gap]}>
          <Spans spans={block.spans} />
        </RNText>
      );
    case 'paragraph':
      return (
        <RNText style={[styles.paragraph, gap]}>
          <Spans spans={block.spans} />
        </RNText>
      );
    case 'bullet':
      return (
        <View style={gap}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listRow}>
              <RNText style={styles.bulletDot}>•</RNText>
              <RNText style={styles.listText}>
                <Spans spans={item} />
              </RNText>
            </View>
          ))}
        </View>
      );
    case 'ordered':
      return (
        <View style={gap}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listRow}>
              <RNText style={styles.listNum}>{block.start + i}.</RNText>
              <RNText style={styles.listText}>
                <Spans spans={item} />
              </RNText>
            </View>
          ))}
        </View>
      );
    case 'code':
      return (
        <View style={[styles.codeBlock, gap]}>
          <RNText style={styles.codeText}>{block.value}</RNText>
        </View>
      );
    default:
      return null;
  }
}

/**
 * Thin renderer for the assistant's Markdown text. All parsing lives in the
 * framework-free, unit-tested `@/lib/agent/markdown`; this component only maps
 * the resulting blocks/spans to themed React Native elements.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <View>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} first={i === 0} />
      ))}
    </View>
  );
}

function headingStyle(level: number): TextStyle {
  if (level <= 1) return styles.h1;
  if (level === 2) return styles.h2;
  return styles.h3;
}

const styles = StyleSheet.create({
  blockGap: {
    marginTop: space.sm,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  bold: {
    fontWeight: '700',
    color: colors.textHi,
  },
  italic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: colors.aqua,
  },
  link: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  h1: {
    fontSize: typeScale.h3.fontSize,
    fontWeight: '700',
    lineHeight: 24,
    color: colors.textHi,
  },
  h2: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    color: colors.textHi,
  },
  h3: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    color: colors.textHi,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  bulletDot: {
    width: 18,
    fontSize: 15,
    lineHeight: 22,
    color: colors.aqua,
  },
  listNum: {
    width: 22,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textDim,
  },
  listText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  codeBlock: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
  },
});
