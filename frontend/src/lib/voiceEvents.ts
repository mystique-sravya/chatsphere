import type { WSMessage } from '../types';

export type VoiceSocketEvent = Extract<
  WSMessage,
  { type: 'voice_state' | 'voice_offer' | 'voice_answer' | 'voice_ice_candidate' }
>;

const voiceEventTarget = new EventTarget();

export function emitVoiceSocketEvent(event: VoiceSocketEvent) {
  voiceEventTarget.dispatchEvent(new CustomEvent<VoiceSocketEvent>('voice-socket-event', { detail: event }));
}

export function subscribeToVoiceSocketEvents(listener: (event: VoiceSocketEvent) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<VoiceSocketEvent>).detail);
  };

  voiceEventTarget.addEventListener('voice-socket-event', handler);

  return () => {
    voiceEventTarget.removeEventListener('voice-socket-event', handler);
  };
}