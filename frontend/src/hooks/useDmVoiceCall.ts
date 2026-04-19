import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Room, VoiceParticipantState } from '../types';
import { subscribeToVoiceSocketEvents } from '../lib/voiceEvents';

type VoiceWsApi = {
  joinVoiceCall: (roomId: string) => void;
  leaveVoiceCall: (roomId: string) => void;
  setVoiceMute: (roomId: string, muted: boolean) => void;
  sendVoiceOffer: (roomId: string, targetUserId: string, sdp: RTCSessionDescriptionInit) => void;
  sendVoiceAnswer: (roomId: string, targetUserId: string, sdp: RTCSessionDescriptionInit) => void;
  sendVoiceIceCandidate: (roomId: string, targetUserId: string, candidate: RTCIceCandidateInit) => void;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function useDmVoiceCall(room: Room | null, userId: string, ws: VoiceWsApi) {
  const [participants, setParticipants] = useState<VoiceParticipantState[]>([]);
  const [isJoining, setIsJoining] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState('');
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const offerStartedRef = useRef(false);
  const isInCallRef = useRef(false);
  const otherParticipantIdRef = useRef<string | null>(null);

  const otherParticipant = useMemo(
    () => room?.members.find((member) => member.user_id !== userId) || null,
    [room?.id, room?.members, userId]
  );

  const otherParticipantId = otherParticipant?.user_id || null;
  const remoteParticipant = useMemo(
    () => participants.find((participant) => participant.user_id !== userId) || null,
    [participants, userId]
  );

  const isDmRoom = room?.type === 'dm';
  const remoteInCall = Boolean(remoteParticipant);

  useEffect(() => {
    isInCallRef.current = isInCall;
  }, [isInCall]);

  useEffect(() => {
    otherParticipantIdRef.current = otherParticipantId;
  }, [otherParticipantId]);

  const stopLocalMedia = useCallback(() => {
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
  }, []);

  const closePeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    setConnectionState('new');
    offerStartedRef.current = false;
  }, []);

  const resetCallState = useCallback(() => {
    setParticipants([]);
    setIsInCall(false);
    setIsMuted(false);
    setIsJoining(false);
    setError('');
    closePeerConnection();
    stopLocalMedia();
  }, [closePeerConnection, stopLocalMedia]);

  const ensurePeerConnection = useCallback(() => {
    if (!room || !otherParticipantId) {
      return null;
    }

    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const peerConnection = new RTCPeerConnection(RTC_CONFIG);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        ws.sendVoiceIceCandidate(room.id, otherParticipantId, event.candidate.toJSON());
      }
    };

    peerConnection.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.onconnectionstatechange = () => {
      setConnectionState(peerConnection.connectionState);
      if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
        offerStartedRef.current = false;
      }
    };

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        peerConnection.addTrack(track, localStreamRef.current);
      }
    }

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  }, [otherParticipantId, room?.id, ws]);

  const maybeCreateOffer = useCallback(async () => {
    if (!room || !otherParticipantId || !isInCall || !remoteInCall) {
      return;
    }

    if (userId > otherParticipantId || offerStartedRef.current) {
      return;
    }

    const peerConnection = ensurePeerConnection();
    if (!peerConnection) {
      return;
    }

    offerStartedRef.current = true;
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      ws.sendVoiceOffer(room.id, otherParticipantId, offer);
    } catch (err) {
      offerStartedRef.current = false;
      setError(err instanceof Error ? err.message : 'Unable to start the voice call');
    }
  }, [ensurePeerConnection, isInCall, otherParticipantId, remoteInCall, room?.id, userId, ws]);

  useEffect(() => {
    const roomId = room?.id || null;
    const previousRoomId = activeRoomIdRef.current;

    if (previousRoomId && previousRoomId !== roomId && isInCall) {
      ws.leaveVoiceCall(previousRoomId);
      resetCallState();
    }

    activeRoomIdRef.current = roomId;
  }, [isInCall, resetCallState, room?.id, ws]);

  useEffect(() => {
    const unsubscribe = subscribeToVoiceSocketEvents((event) => {
      if (!room || event.room_id !== room.id) {
        return;
      }

      if (event.type === 'voice_state') {
        setParticipants(event.participants);
        const localParticipant = event.participants.find((participant) => participant.user_id === userId);
        if (!localParticipant && isInCallRef.current) {
          setIsInCall(false);
          setIsMuted(false);
          stopLocalMedia();
          closePeerConnection();
        }
        return;
      }

      if (!localStreamRef.current || !isInCallRef.current) {
        return;
      }

      if (event.type === 'voice_offer' && event.from_user_id === otherParticipantIdRef.current) {
        void (async () => {
          try {
            const peerConnection = ensurePeerConnection();
            if (!peerConnection) return;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(event.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            ws.sendVoiceAnswer(room.id, otherParticipantId!, answer);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to answer the voice call');
          }
        })();
        return;
      }

      if (event.type === 'voice_answer' && event.from_user_id === otherParticipantIdRef.current) {
        void (async () => {
          try {
            const peerConnection = ensurePeerConnection();
            if (!peerConnection) return;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(event.sdp));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to connect the voice call');
          }
        })();
        return;
      }

      if (event.type === 'voice_ice_candidate' && event.from_user_id === otherParticipantIdRef.current) {
        void (async () => {
          try {
            const peerConnection = ensurePeerConnection();
            if (!peerConnection) return;
            await peerConnection.addIceCandidate(new RTCIceCandidate(event.candidate));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to add network candidate');
          }
        })();
      }
    });

    return unsubscribe;
  }, [closePeerConnection, ensurePeerConnection, isInCall, otherParticipantId, room?.id, stopLocalMedia, userId, ws]);

  useEffect(() => {
    void maybeCreateOffer();
  }, [maybeCreateOffer]);

  useEffect(() => {
    if (!remoteInCall && isInCall) {
      closePeerConnection();
    }
  }, [closePeerConnection, isInCall, remoteInCall]);

  useEffect(() => {
    if (!isInCall || connectionState === 'connected') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setError('Call ended because the connection did not complete in time');
      if (activeRoomIdRef.current) {
        ws.leaveVoiceCall(activeRoomIdRef.current);
      }
      resetCallState();
    }, 60000);

    return () => window.clearTimeout(timeoutId);
  }, [connectionState, isInCall, resetCallState, ws]);

  useEffect(() => {
    return () => {
      if (activeRoomIdRef.current && isInCall) {
        ws.leaveVoiceCall(activeRoomIdRef.current);
      }
      resetCallState();
    };
  }, [isInCall, resetCallState, ws]);

  const joinCall = useCallback(async () => {
    if (!room || !isDmRoom) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Voice calling is not supported in this browser');
      return;
    }

    setError('');
    setIsJoining(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      setIsMuted(false);
      setIsInCall(true);
      ensurePeerConnection();
      ws.joinVoiceCall(room.id);
    } catch (err) {
      stopLocalMedia();
      setIsInCall(false);
      setError(err instanceof Error ? err.message : 'Unable to access microphone');
    } finally {
      setIsJoining(false);
    }
  }, [ensurePeerConnection, isDmRoom, room, stopLocalMedia, ws]);

  const leaveCall = useCallback(() => {
    if (!room) {
      return;
    }

    ws.leaveVoiceCall(room.id);
    resetCallState();
  }, [resetCallState, room, ws]);

  const toggleMute = useCallback(() => {
    if (!room || !localStreamRef.current) {
      return;
    }

    const nextMuted = !isMuted;
    for (const track of localStreamRef.current.getAudioTracks()) {
      track.enabled = !nextMuted;
    }
    setIsMuted(nextMuted);
    ws.setVoiceMute(room.id, nextMuted);
  }, [isMuted, room, ws]);

  return {
    isSupported: typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined',
    isDmRoom,
    isJoining,
    isInCall,
    isMuted,
    remoteInCall,
    remoteMuted: Boolean(remoteParticipant?.muted),
    connectionState,
    isConnected: connectionState === 'connected',
    otherParticipantName: otherParticipant?.username || 'Direct chat',
    participantCount: participants.length,
    error,
    remoteAudioRef,
    joinCall,
    leaveCall,
    toggleMute,
    clearError: () => setError(''),
  };
}