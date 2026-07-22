export type ChatMessageVM =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'tool'; name: string; result?: any };

export interface ChatState {
  messages: ChatMessageVM[];
  streaming: boolean;
  conversationId?: string;
  error?: string;
}

export type ChatAction =
  | { type: 'send'; text: string }
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_result'; name: string; result: any }
  | { type: 'done'; conversationId?: string }
  | { type: 'error'; message: string };

export function initialChat(): ChatState { return { messages: [], streaming: false }; }

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      return { ...state, streaming: true, error: undefined,
        messages: [...state.messages, { role: 'user', text: action.text }, { role: 'assistant', text: '' }] };
    case 'token': {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') { msgs[i] = { role: 'assistant', text: (msgs[i] as any).text + action.delta }; break; }
      }
      return { ...state, messages: msgs };
    }
    case 'tool_start': {
      const msgs = [...state.messages];
      const insertAt = msgs.length - 1;
      msgs.splice(Math.max(insertAt, 0), 0, { role: 'tool', name: action.name });
      return { ...state, messages: msgs };
    }
    case 'tool_result': {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'tool' && (msgs[i] as any).name === action.name && !(msgs[i] as any).result) {
          msgs[i] = { role: 'tool', name: action.name, result: action.result }; break;
        }
      }
      return { ...state, messages: msgs };
    }
    case 'done':
      return { ...state, streaming: false, conversationId: action.conversationId ?? state.conversationId };
    case 'error':
      return { ...state, streaming: false, error: action.message };
    default:
      return state;
  }
}
