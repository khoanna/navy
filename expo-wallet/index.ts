import 'react-native-get-random-values';
import { Buffer } from 'buffer';
// @ts-expect-error global shim
globalThis.Buffer = globalThis.Buffer ?? Buffer;
import 'expo-router/entry';
