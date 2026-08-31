import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { StreamPlayer } from './components/StreamPlayer';
import { EmptyStreamStage } from './components/EmptyStreamStage';
import { StreamWatchCard } from './components/StreamWatchCard';
import { ChatAndReactions } from './components/ChatAndReactions';
import { ParticipantsList } from './components/ParticipantsList';
import { DiscordActivityInfo } from './components/DiscordActivityInfo';
import { DualTestModal } from './components/DualTestModal';
import { QualitySelectModal } from './components/QualitySelectModal';
import { getSocket, getRoomIdFromUrl, updateUrlWithRoomId } from './lib/socket';
import { captureDisplayMedia, captureWebcam, buildIceConfig, optimizeCodecs, tuneSdp, startFrameRelay } from './lib/webrtc';
import {
  startWebCodecsBroadcast,
  startWebCodecsViewer,
  canBroadcastWithWebCodecs,
  canViewWithWebCodecs,
  startWebCodecsAudioBroadcast,
  startWebCodecsAudioViewer,
  canBroadcastAudioWithWebCodecs,
  BroadcastHandle,
  ViewerHandle,
  EncodedVideoPacket,
  AudioBroadcastHandle,
  AudioViewerHandle,
  EncodedAudioPacket,
} from './lib/videoRelay';
import { isDiscordActivity, openExternalShareLink, getDiscordSdk } from './lib/discord';
import { getShareUrl, VPS_BASE_URL } from './lib/config';
import {
  UserInfo,
  StreamInfo,
  ChatMessage,
  ReactionItem,
  StreamQualityConfig,
  ViewMode,
} from './types';

// Generate or retrieve current user profile
function getOrCreateCurrentUser(): UserInfo {
  let saved = sessionStorage.getItem('ismael_user_profile');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // ignore
    }
  }

  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const user: UserInfo = {
    id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    name: `User_${randomNum}`,
    joinedAt: Date.now(),
  };

  sessionStorage.setItem('ismael_user_profile', JSON.stringify(user));
  return user;
}

export default function App() {
  const [roomId, setRoomId] = useState<string>('');
  const [currentUser] = useState<UserInfo>(getOrCreateCurrentUser);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [activeStream, setActiveStream] = useState<StreamInfo | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStartingStream, setIsStartingStream] = useState(false);

  // Streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  // Low-fps image fallback shown when the real WebRTC connection fails
  const [fallbackFrame, setFallbackFrame] = useState<string | null>(null);

  // Chat & Reactions
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('standard');
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'>('idle');
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isDualTestModalOpen, setIsDualTestModalOpen] = useState(false);
  const [isQualityModalOpen, setIsQualityModalOpen] = useState(false);

  // Which stream (by streamId) the current user has actively chosen to
  // watch. Nobody is connected to a stream automatically anymore — viewers
  // see a card with the streamer's name and a "Assistir compartilhamento"
  // button, and only start receiving video/audio once they click it.
  const [watchingStreamId, setWatchingStreamId] = useState<string | null>(null);

  // Initialize Discord Embedded SDK if inside Discord Activity
  useEffect(() => {
    if (isDiscordActivity()) {
      getDiscordSdk().catch((err) => {
        console.warn('[Discord SDK] Initialization:', err);
      });
    }
  }, []);

  // Warm the TURN credentials cache early so the first stream connection
  // doesn't have to wait on that fetch.
  useEffect(() => {
    buildIceConfig(false).catch(() => {});
  }, []);

  // WebRTC Peer References
  const broadcasterPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const frameRelayStopRef = useRef<(() => void) | null>(null);

  // WebCodecs relay (no WebRTC) — the primary video path when watching from
  // inside a Discord Activity, since RTCPeerConnection is blocked there but
  // WebCodecs + this Socket.IO connection are not. See src/lib/videoRelay.ts.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webCodecsBroadcastRef = useRef<BroadcastHandle | null>(null);
  const webCodecsViewerRef = useRef<ViewerHandle | null>(null);
  // Throttles how often a detected packet-loss gap can trigger an
  // out-of-band keyframe request (see onPacketLoss below).
  const lastPacketLossKeyframeRequestRef = useRef<number>(0);

  // Audio relay (same WebCodecs-over-WebSocket approach as video above) —
  // this is what makes the volume/mute controls actually do something for
  // viewers inside a Discord Activity, who previously received no audio at all.
  const webCodecsAudioBroadcastRef = useRef<AudioBroadcastHandle | null>(null);
  const webCodecsAudioViewerRef = useRef<AudioViewerHandle | null>(null);

  // How the canvas relay (Discord Activity viewers) should fit frames —
  // read by effect #3 when it (re)creates the viewer, written by StreamPlayer's
  // fit/ajustar toggle button via the ref passed down as canvasRelayRef.
  const canvasFitRef = useRef<'contain' | 'cover'>('contain');

  // Keep localStreamRef synced
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Keep isStreaming/connectionState mirrored in refs so socket handlers can
  // always read the LATEST value without needing to be in a useEffect's
  // dependency array (which would tear down and re-create every socket
  // listener, and even trigger a duplicate 'join-room', every single time
  // streaming starts/stops — exactly the moment offer/answer/ICE candidates
  // are being exchanged, which could silently drop signaling messages).
  const isStreamingRef = useRef(false);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const connectionStateRef = useRef<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'>('idle');
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  // activeStream is read inside socket handlers registered in an effect that
  // doesn't depend on it (see isStreamingRef comment above for why) — mirror
  // it in a ref so those handlers always see the current value.
  const activeStreamRef = useRef<StreamInfo | null>(null);
  useEffect(() => {
    activeStreamRef.current = activeStream;
  }, [activeStream]);

  // Helper to add pending candidates once remote description is set
  const drainPendingCandidates = async (peerKey: string, pc: RTCPeerConnection) => {
    const list = pendingCandidatesRef.current.get(peerKey);
    if (list && list.length > 0) {
      for (const cand of list) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('[WebRTC] Candidate drain warning:', e);
        }
      }
      pendingCandidatesRef.current.delete(peerKey);
    }
  };

  // 1. Initialize Room ID & URL
  useEffect(() => {
    const rId = getRoomIdFromUrl();
    setRoomId(rId);
    updateUrlWithRoomId(rId);
  }, []);

  // 2. Setup Socket.IO connection & WebRTC Signaling
  useEffect(() => {
    if (!roomId) return;

    const socket = getSocket();

    const handleJoin = () => {
      setIsSocketConnected(true);
      socket.emit('join-room', {
        roomId,
        user: currentUser,
      });
    };

    // Listen for socket connection status
    socket.on('connect', handleJoin);
    socket.on('reconnect', handleJoin);
    socket.on('disconnect', () => {
      setIsSocketConnected(false);
    });

    if (socket.connected) {
      handleJoin();
    }

    // Room state update
    socket.on('room-state', (data: { roomId: string; users: UserInfo[]; activeStream: StreamInfo | null }) => {
      setUsers(data.users);
      setActiveStream(data.activeStream);
    });

    // User joined
    socket.on('user-joined', (data: { user: UserInfo; users: UserInfo[]; activeStream: StreamInfo | null }) => {
      setUsers(data.users);
      if (data.activeStream) {
        setActiveStream(data.activeStream);
      }
    });

    // User left
    socket.on('user-left', (data: { userId: string; users: UserInfo[]; activeStream: StreamInfo | null }) => {
      setUsers(data.users);
      setActiveStream(data.activeStream);

      // Clean up peer if broadcaster
      const peer = broadcasterPeersRef.current.get(data.userId);
      if (peer) {
        peer.close();
        broadcasterPeersRef.current.delete(data.userId);
      }
      pendingCandidatesRef.current.delete(data.userId);
    });

    // Stream started in room
    socket.on('stream-started', (data: { activeStream: StreamInfo; users: UserInfo[] }) => {
      setActiveStream(data.activeStream);
      setUsers(data.users);
    });

    // Stream stopped
    socket.on('stream-stopped', (data: { users: UserInfo[] }) => {
      // If THIS client was actually the one broadcasting, this event can
      // arrive even without a local handleStopStream() call — e.g. someone
      // watching the same physical share from inside the Discord Activity
      // (a different session/tab) clicked "Parar compartilhamento". Fully
      // tear down local capture here too, so the browser's native screen
      // share indicator actually stops and the mic/webcam are released.
      if (activeStreamRef.current?.streamerId === currentUser.id) {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
          setLocalStream(null);
        }
        broadcasterPeersRef.current.forEach((pc) => pc.close());
        broadcasterPeersRef.current.clear();
        if (webCodecsBroadcastRef.current) {
          webCodecsBroadcastRef.current.stop();
          webCodecsBroadcastRef.current = null;
        }
        if (webCodecsAudioBroadcastRef.current) {
          webCodecsAudioBroadcastRef.current.stop();
          webCodecsAudioBroadcastRef.current = null;
        }
        setIsStreaming(false);
        setWebcamStream((prev) => {
          prev?.getTracks().forEach((t) => t.stop());
          return null;
        });
      }

      setActiveStream(null);
      setUsers(data.users);
      setRemoteStream(null);
      setFallbackFrame(null);
      setConnectionState('idle');
      setWatchingStreamId(null);

      if (viewerPeerRef.current) {
        viewerPeerRef.current.close();
        viewerPeerRef.current = null;
      }
      pendingCandidatesRef.current.clear();

      if (frameRelayStopRef.current) {
        frameRelayStopRef.current();
        frameRelayStopRef.current = null;
      }
      if (webCodecsViewerRef.current) {
        webCodecsViewerRef.current.stop();
        webCodecsViewerRef.current = null;
      }
      if (webCodecsAudioViewerRef.current) {
        webCodecsAudioViewerRef.current.stop();
        webCodecsAudioViewerRef.current = null;
      }
    });

    // BROADCASTER SIGNALS: Viewer is ready to receive stream
    socket.on('viewer-ready-for-offer', async ({ viewerId, streamerId, viewerInDiscordActivity }: { viewerId: string; streamerId: string; viewerInDiscordActivity?: boolean }) => {
      if (streamerId !== currentUser.id) return;
      const stream = localStreamRef.current;
      if (!stream) {
        console.warn('[WebRTC Broadcaster] No local stream to offer to viewer:', viewerId);
        return;
      }

      try {
        // Close existing peer for this viewer if any
        if (broadcasterPeersRef.current.has(viewerId)) {
          broadcasterPeersRef.current.get(viewerId)?.close();
        }

        // CRITICAL FIX: if this specific viewer is inside the Discord Activity
        // sandbox, it will only gather/accept TURN relay ICE candidates on its
        // side (see buildIceConfig(true) in the viewer's offer handler below).
        // If the broadcaster then offers with host/STUN candidates mixed in
        // (the previous behavior — always `buildIceConfig(false)`), the two
        // sides end up with mismatched candidate types and ICE negotiation
        // fails inside the sandbox — this was the "shares fine in the browser
        // but never reaches the Activity, stuck on a black screen" bug.
        // Mirror the viewer's policy per-connection so both sides agree.
        const iceConfig = await buildIceConfig(!!viewerInDiscordActivity);
        const pc = new RTCPeerConnection(iceConfig);
        broadcasterPeersRef.current.set(viewerId, pc);

        // Add local stream tracks to this viewer peer with max bitrate
        stream.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, stream);
          if (track.kind === 'video') {
            try {
              const params = sender.getParameters();
              if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
              }
              params.encodings[0].maxBitrate = 8000000; // 8 Mbps for high quality 60 FPS
              params.encodings[0].maxFramerate = 60;
              sender.setParameters(params).catch(() => {});
            } catch {
              // ignore
            }
          }
        });

        // Optimize codecs for universal Discord & browser compatibility
        optimizeCodecs(pc);

        // Send ICE candidate to specific viewer
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('signal-candidate', {
              roomId,
              targetId: viewerId,
              candidate: event.candidate,
              senderId: currentUser.id,
            });
          }
        };

        const rawOffer = await pc.createOffer();
        const tunedSdpOffer = new RTCSessionDescription({
          type: rawOffer.type,
          sdp: tuneSdp(rawOffer.sdp || '', 8000),
        });

        await pc.setLocalDescription(tunedSdpOffer);

        socket.emit('signal-offer', {
          roomId,
          targetViewerId: viewerId,
          offer: tunedSdpOffer,
          streamerId: currentUser.id,
        });
      } catch (err) {
        console.error('[WebRTC Broadcaster] Error creating offer for viewer:', viewerId, err);
      }
    });

    // BROADCASTER SIGNALS: Answer received from viewer
    socket.on('signal-answer-received', async ({ targetStreamerId, answer, viewerId }: { targetStreamerId: string; answer: any; viewerId: string }) => {
      if (targetStreamerId !== currentUser.id) return;
      const pc = broadcasterPeersRef.current.get(viewerId);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await drainPendingCandidates(viewerId, pc);
        } catch (err) {
          console.error('[WebRTC Broadcaster] Error setting remote description:', err);
        }
      }
    });

    // VIEWER SIGNALS: Offer received from broadcaster
    socket.on('signal-offer-received', async ({ targetViewerId, offer, streamerId }: { targetViewerId: string; offer: any; streamerId: string }) => {
      // Only process if this is intended for me and I am NOT the streamer
      if (targetViewerId !== currentUser.id || streamerId === currentUser.id) {
        return;
      }

      try {
        if (viewerPeerRef.current) {
          viewerPeerRef.current.close();
        }

        // Inside the Discord Activity iframe, direct/STUN candidates virtually
        // never connect (locked-down network sandbox) — force TURN relay so we
        // don't waste the ICE gathering window on candidates that will never work.
        const viewerIceConfig = await buildIceConfig(isDiscordActivity());
        const pc = new RTCPeerConnection(viewerIceConfig);
        viewerPeerRef.current = pc;

        // Ensure transceivers are configured to receive
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        optimizeCodecs(pc);

        pc.ontrack = (event) => {
          console.log('[WebRTC Viewer] ontrack received:', event.track.kind, event.streams);
          if (event.streams && event.streams[0]) {
            setRemoteStream(event.streams[0]);
          } else {
            setRemoteStream((prev) => {
              const base = prev || new MediaStream();
              if (!base.getTracks().some((t) => t.id === event.track.id)) {
                base.addTrack(event.track);
              }
              return new MediaStream(base.getTracks());
            });
          }
          setConnectionState('connected');
          // Real WebRTC video is flowing now — stop showing the low-fps fallback.
          setFallbackFrame(null);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('signal-candidate', {
              roomId,
              targetId: streamerId,
              candidate: event.candidate,
              senderId: currentUser.id,
            });
          }
        };

        // Extra diagnostics: connectionState alone doesn't always fire reliably
        // in embedded/sandboxed webviews, so also track ICE state directly.
        // NOTE: 'disconnected' is frequently a TRANSIENT network blip (brief
        // congestion, a dropped packet run) that recovers on its own within a
        // few seconds — it is NOT the same as 'failed'. Treating it as a hard
        // failure immediately used to trigger the slow JPEG "modo
        // compatibilidade" fallback far too eagerly. Instead we try an ICE
        // restart and give it a grace period to recover before giving up.
        let disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
        const clearDisconnectGrace = () => {
          if (disconnectGraceTimer) {
            clearTimeout(disconnectGraceTimer);
            disconnectGraceTimer = null;
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log('[WebRTC Viewer] iceConnectionState:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'disconnected') {
            // Transient — try to recover in place first.
            try {
              pc.restartIce();
            } catch {
              // ignore if not supported
            }
            if (!disconnectGraceTimer) {
              disconnectGraceTimer = setTimeout(() => {
                if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                  console.warn('[WebRTC Viewer] ICE still disconnected after grace period — treating as failed.');
                  setConnectionState('failed');
                }
                disconnectGraceTimer = null;
              }, 4000);
            }
          } else if (pc.iceConnectionState === 'failed') {
            clearDisconnectGrace();
            console.warn('[WebRTC Viewer] ICE failed — likely TURN relay unreachable inside Discord sandbox.');
            setConnectionState('failed');
          } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            clearDisconnectGrace();
          }
        };

        pc.onconnectionstatechange = () => {
          console.log('[WebRTC Viewer] connectionState:', pc.connectionState);
          if (pc.connectionState === 'connected') {
            clearDisconnectGrace();
            setConnectionState('connected');
          } else if (pc.connectionState === 'connecting') {
            setConnectionState('connecting');
          } else if (pc.connectionState === 'failed') {
            clearDisconnectGrace();
            setConnectionState('failed');
          }
          // 'disconnected' on the aggregate connectionState is handled via
          // oniceconnectionstatechange above (with its grace period) rather
          // than here, to avoid double-triggering an immediate failure.
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainPendingCandidates(streamerId, pc);

        const rawAnswer = await pc.createAnswer();
        const tunedSdpAnswer = new RTCSessionDescription({
          type: rawAnswer.type,
          sdp: tuneSdp(rawAnswer.sdp || '', 8000),
        });

        await pc.setLocalDescription(tunedSdpAnswer);

        socket.emit('signal-answer', {
          roomId,
          targetStreamerId: streamerId,
          answer: tunedSdpAnswer,
          viewerId: currentUser.id,
        });
      } catch (err) {
        console.error('[WebRTC Viewer] Error handling offer:', err);
        setConnectionState('failed');
      }
    });

    // FALLBACK: I am the streamer and a viewer's real WebRTC failed — start
    // sending low-fps JPEG frames over this socket so they see *something*.
    socket.on('frame-fallback-requested', ({ streamerId }: { streamerId: string }) => {
      if (streamerId !== currentUser.id) return;
      if (frameRelayStopRef.current) return; // already running
      const stream = localStreamRef.current;
      if (!stream) return;
      console.log('[FrameRelay] A viewer\'s WebRTC failed — starting low-fps image fallback.');
      frameRelayStopRef.current = startFrameRelay(
        stream,
        (dataUrl) => socket.emit('frame-relay', { roomId, dataUrl }),
        { fps: 6, maxWidth: 800, quality: 0.55 }
      );
    });

    // FALLBACK: I am a viewer and received a low-fps frame from the streamer
    socket.on('frame-relay-received', ({ dataUrl }: { dataUrl: string }) => {
      setFallbackFrame(dataUrl);
    });

    // WebCodecs relay: I am the streamer and a viewer (usually inside a
    // Discord Activity) just asked for a fresh keyframe — this is also our
    // cue to lazily spin up the WebCodecs encoders for the first time, so
    // they never run (and never cost CPU/GPU) unless someone is actually
    // watching through this path.
    socket.on('need-keyframe-received', ({ streamerId }: { streamerId: string }) => {
      console.log('[VideoRelay] need-keyframe-received event arrived. streamerId:', streamerId, 'currentUser.id:', currentUser.id);
      if (streamerId !== currentUser.id) {
        console.log('[VideoRelay] Ignoring — this keyframe request is not for me.');
        return;
      }
      const stream = localStreamRef.current;
      if (!stream) {
        console.warn('[VideoRelay] Got a keyframe request but I have no local stream to broadcast (not actually sharing?).');
        return;
      }

      if (!webCodecsBroadcastRef.current) {
        if (canBroadcastWithWebCodecs()) {
          try {
            webCodecsBroadcastRef.current = startWebCodecsBroadcast(
              stream,
              (packet) => {
                socket.emit('video-chunk', { roomId, streamerId: currentUser.id, packet });
              },
              {
                // If the encoder dies mid-stream (e.g. GPU/driver hiccup),
                // don't leave webCodecsBroadcastRef pointing at a dead
                // handle forever — clear it so the next keyframe request
                // (viewer clicking "Tentar agora") builds a fresh encoder
                // instead of silently doing nothing.
                onFatalError: () => {
                  console.error('[VideoRelay] Broadcast died — will rebuild on next viewer request.');
                  webCodecsBroadcastRef.current = null;
                },
              }
            );
          } catch (err) {
            console.error('[VideoRelay] Could not start WebCodecs broadcast (Discord Activity viewers won\'t see video):', err);
          }
        } else {
          console.warn('[VideoRelay] This browser doesn\'t support WebCodecs broadcast — Discord Activity viewers won\'t see video.');
        }
      }
      webCodecsBroadcastRef.current?.requestKeyframe();

      if (!webCodecsAudioBroadcastRef.current) {
        try {
          webCodecsAudioBroadcastRef.current = startWebCodecsAudioBroadcast(stream, (packet) => {
            socket.emit('audio-chunk', { roomId, streamerId: currentUser.id, packet });
          });
        } catch (err) {
          console.warn('[AudioRelay] Could not start WebCodecs audio broadcast:', err);
        }
      }
    });

    // WebCodecs relay: I am a viewer and received an encoded chunk from the
    // streamer. Feed it to the decoder that effect #3 set up on canvasRef.
    socket.on('video-chunk-received', ({ streamerId, packet }: { streamerId: string; packet: EncodedVideoPacket }) => {
      if (activeStreamRef.current?.streamerId !== streamerId) {
        console.log('[VideoRelay] Dropping chunk from', streamerId, '— not watching that streamer right now.');
        return;
      }
      if (!webCodecsViewerRef.current) {
        console.warn('[VideoRelay] Received a video chunk but no viewer/decoder is set up yet — dropping it.');
        return;
      }
      webCodecsViewerRef.current.receive(packet);
    });

    // Same as above, but for the audio relay — feeds the decoder that
    // effect #3 sets up alongside the canvas viewer.
    socket.on('audio-chunk-received', ({ streamerId, packet }: { streamerId: string; packet: EncodedAudioPacket }) => {
      if (activeStreamRef.current?.streamerId !== streamerId) return;
      webCodecsAudioViewerRef.current?.receive(packet);
    });

    // ICE Candidate Exchange (Both Broadcaster and Viewer)
    socket.on('signal-candidate-received', async ({ targetId, candidate, senderId }: { targetId: string; candidate: any; senderId: string }) => {      if (targetId !== currentUser.id) return;

      try {
        if (isStreamingRef.current) {
          const pc = broadcasterPeersRef.current.get(senderId);
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            // Buffer candidate until remote description is set
            const prev = pendingCandidatesRef.current.get(senderId) || [];
            pendingCandidatesRef.current.set(senderId, [...prev, candidate]);
          }
        } else if (viewerPeerRef.current) {
          const pc = viewerPeerRef.current;
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            const prev = pendingCandidatesRef.current.get(senderId) || [];
            pendingCandidatesRef.current.set(senderId, [...prev, candidate]);
          }
        }
      } catch (err) {
        console.warn('[WebRTC] Error adding ICE candidate:', err);
      }
    });

    // Chat Message received
    socket.on('new-chat', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    // Emoji reaction received
    socket.on('new-reaction', ({ emoji, sender }: { emoji: string; sender: string }) => {
      const newReaction: ReactionItem = {
        id: `react-${Date.now()}-${Math.random()}`,
        emoji,
        sender,
        x: 20 + Math.random() * 60, // random percentage
        y: 20 + Math.random() * 50,
      };

      setReactions((prev) => [...prev, newReaction]);

      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== newReaction.id));
      }, 1800);
    });

    return () => {
      socket.off('room-state');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('stream-started');
      socket.off('stream-stopped');
      socket.off('viewer-ready-for-offer');
      socket.off('signal-answer-received');
      socket.off('signal-offer-received');
      socket.off('signal-candidate-received');
      socket.off('frame-fallback-requested');
      socket.off('frame-relay-received');
      socket.off('need-keyframe-received');
      socket.off('video-chunk-received');
      socket.off('audio-chunk-received');
      socket.off('new-chat');
      socket.off('new-reaction');
    };
    // NOTE: isStreaming intentionally NOT in this dependency array anymore —
    // see isStreamingRef above for why. This effect now only re-runs when
    // the room or user actually changes, so listeners (and the WebRTC peer
    // refs tied to them) stay stable for the whole lifetime of a stream.
  }, [roomId, currentUser.id]);

  // 3. REMOTE VIEWER INITIATION: When active stream exists, current user is a
  // remote viewer, AND they've clicked "Assistir compartilhamento" on the
  // watch card. Nothing connects automatically anymore.
  useEffect(() => {
    // If there is no active stream, reset
    if (!activeStream) {
      setRemoteStream(null);
      setConnectionState('idle');
      if (webCodecsViewerRef.current) {
        webCodecsViewerRef.current.stop();
        webCodecsViewerRef.current = null;
      }
      if (webCodecsAudioViewerRef.current) {
        webCodecsAudioViewerRef.current.stop();
        webCodecsAudioViewerRef.current = null;
      }
      return;
    }

    // CRUCIAL FIX: If the active stream is from ME (the broadcaster), DO NOT request WebRTC offer!
    if (activeStream.streamerId === currentUser.id) {
      setConnectionState('connected');
      return;
    }

    // Wait for an explicit "Assistir compartilhamento" click before doing
    // any signaling/connecting work.
    if (watchingStreamId !== activeStream.streamId) {
      return;
    }

    const socket = getSocket();

    // Inside a Discord Activity, RTCPeerConnection can never connect (Discord's
    // proxy only supports WebSocket) — so don't even attempt WebRTC here.
    // Decode the WebCodecs relay instead, which travels over this same
    // Socket.IO connection and works fine inside the Activity iframe.
    if (isDiscordActivity() && canViewWithWebCodecs()) {
      setConnectionState('connecting');
      if (webCodecsViewerRef.current) {
        webCodecsViewerRef.current.stop();
      }
      if (canvasRef.current) {
        webCodecsViewerRef.current = startWebCodecsViewer(canvasRef.current, {
          fit: canvasFitRef.current,
          // Only flip to "connected" once a frame is actually decoded and
          // drawn — the old fixed 300ms timer marked it connected before
          // anything had really arrived, which is why the screen could sit
          // black with no loading indicator and no visible error either.
          onFirstFrame: () => setConnectionState('connected'),
          // A chunk got dropped somewhere between the streamer and us —
          // ask for a fresh keyframe right now instead of waiting for the
          // streamer's next scheduled one (up to a few seconds of visible
          // block/color noise otherwise). Throttled so a burst of losses
          // in the same window doesn't flood the streamer with requests.
          onPacketLoss: () => {
            const now = Date.now();
            if (now - lastPacketLossKeyframeRequestRef.current > 800) {
              lastPacketLossKeyframeRequestRef.current = now;
              socket.emit('need-keyframe', { roomId, streamerId: activeStream.streamerId });
            }
          },
        });
      }
      if (webCodecsAudioViewerRef.current) {
        webCodecsAudioViewerRef.current.stop();
      }
      webCodecsAudioViewerRef.current = startWebCodecsAudioViewer();
      // Ask the streamer for a fresh keyframe so we don't wait for the next
      // scheduled one — gets the picture up in ~1 frame.
      console.log('[VideoRelay] Requesting keyframe from streamer', activeStream.streamerId);
      socket.emit('need-keyframe', { roomId, streamerId: activeStream.streamerId });

      // Retry the keyframe request once — covers the case where the first
      // request arrives before the streamer's listener is fully attached,
      // or the streamer's encoder was still spinning up and missed it.
      const retryTimer = setTimeout(() => {
        if (connectionStateRef.current === 'connecting') {
          console.log('[VideoRelay] Still connecting after 2.5s — asking for a keyframe again.');
          socket.emit('need-keyframe', { roomId, streamerId: activeStream.streamerId });
        }
      }, 2500);

      // Safety net: the streamer's WebCodecs encoder now starts lazily (see
      // handleStartStream), so the very first watch has to wait for it to
      // spin up, encode a keyframe, and for it to travel back here. If
      // nothing has actually been drawn after a generous window, surface
      // the "failed" retry UI instead of leaving a silent black screen.
      const failTimer = setTimeout(() => {
        if (connectionStateRef.current === 'connecting') {
          console.warn('[VideoRelay] No frame received after 6s — marking connection as failed.');
          setConnectionState('failed');
        }
      }, 6000);
      return () => {
        clearTimeout(retryTimer);
        clearTimeout(failTimer);
      };
    }

    // Outside Discord: real WebRTC, unchanged.
    setConnectionState('connecting');
    socket.emit('request-stream-offer', {
      roomId,
      viewerId: currentUser.id,
      streamerId: activeStream.streamerId,
      viewerInDiscordActivity: isDiscordActivity(),
    });

    // Safety timeout to retry offer request if not connected within 4.5s.
    // Reads connectionStateRef (always current) instead of the `connectionState`
    // closed over when this effect ran — that value was stale (captured from
    // the PREVIOUS render, before the setConnectionState('connecting') call
    // above had taken effect), so this retry almost never actually fired.
    const retryTimer = setTimeout(() => {
      if (connectionStateRef.current === 'connecting') {
        socket.emit('request-stream-offer', {
          roomId,
          viewerId: currentUser.id,
          streamerId: activeStream.streamerId,
          viewerInDiscordActivity: isDiscordActivity(),
        });
      }
    }, 4500);

    return () => clearTimeout(retryTimer);
  }, [activeStream?.streamId, activeStream?.streamerId, currentUser.id, roomId, watchingStreamId]);

  // Handle Start Screen Share
  const handleStartStream = async (config: StreamQualityConfig) => {
    setIsStartingStream(true);
    try {
      const { stream } = await captureDisplayMedia(
        config.resolution,
        config.fps,
        config.includeSystemAudio,
        config.includeMicrophone
      );

      // If webcam PiP was requested
      if (config.enableWebcamPip) {
        try {
          const cam = await captureWebcam();
          setWebcamStream(cam);
        } catch (e) {
          console.warn('Could not capture webcam:', e);
        }
      }

      // Synchronously set both ref and state
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsStreaming(true);

      const streamInfo: Partial<StreamInfo> = {
        streamId: `stream-${Date.now()}`,
        streamerId: currentUser.id,
        streamerName: currentUser.name,
        title: `${currentUser.name}'s Screen`,
        resolution: config.resolution,
        fps: config.fps,
        hasAudio: config.includeSystemAudio || config.includeMicrophone,
      };

      const socket = getSocket();
      socket.emit('start-stream', {
        roomId,
        streamInfo,
      });

      // NOTE: the WebCodecs (video+audio) relay for Discord Activity viewers
      // is intentionally NOT started here. It's a full extra software-ish
      // encode of your screen running on top of the normal WebRTC path, and
      // starting it unconditionally on every share — even when nobody is
      // watching through it — was eating CPU/GPU that your game needed. It's
      // now started lazily, the first time a Discord Activity viewer
      // actually clicks "Assistir" (see the 'need-keyframe-received' handler
      // below), and only then.

      // When browser's native "Stop Sharing" button is clicked
      stream.getVideoTracks()[0].onended = () => {
        handleStopStream();
      };
    } catch (err) {
      console.error('Failed to capture screen:', err);
    } finally {
      setIsStartingStream(false);
    }
  };

  // Handle Stop Screen Share
  const handleStopStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    if (webcamStream) {
      webcamStream.getTracks().forEach((track) => track.stop());
      setWebcamStream(null);
    }

    // Close all broadcaster peer connections
    broadcasterPeersRef.current.forEach((pc) => pc.close());
    broadcasterPeersRef.current.clear();

    // Stop the WebCodecs relay encoder, if it was running
    if (webCodecsBroadcastRef.current) {
      webCodecsBroadcastRef.current.stop();
      webCodecsBroadcastRef.current = null;
    }

    // Stop the WebCodecs audio relay encoder, if it was running
    if (webCodecsAudioBroadcastRef.current) {
      webCodecsAudioBroadcastRef.current.stop();
      webCodecsAudioBroadcastRef.current = null;
    }

    // Stop the image fallback relay, if it was running
    if (frameRelayStopRef.current) {
      frameRelayStopRef.current();
      frameRelayStopRef.current = null;
    }

    setIsStreaming(false);

    const socket = getSocket();
    socket.emit('stop-stream', { roomId });
  }, [roomId, webcamStream]);

  // Reconnect stream handler
  const handleReconnect = useCallback(() => {
    if (activeStream && activeStream.streamerId !== currentUser.id && isDiscordActivity() && canViewWithWebCodecs()) {
      // Discord Activity path: just re-request a keyframe and keep decoding —
      // there's no WebRTC connection here to tear down and rebuild.
      const socket = getSocket();
      setConnectionState('connecting');
      socket.emit('need-keyframe', { roomId, streamerId: activeStream.streamerId });
      setTimeout(() => {
        if (connectionStateRef.current === 'connecting') {
          setConnectionState('failed');
        }
      }, 6000);
      return;
    }

    if (viewerPeerRef.current) {
      viewerPeerRef.current.close();
      viewerPeerRef.current = null;
    }
    pendingCandidatesRef.current.clear();

    if (activeStream && activeStream.streamerId !== currentUser.id) {
      setConnectionState('connecting');
      const socket = getSocket();
      socket.emit('request-stream-offer', {
        roomId,
        viewerId: currentUser.id,
        streamerId: activeStream.streamerId,
        viewerInDiscordActivity: isDiscordActivity(),
      });
    }
  }, [activeStream, currentUser.id, roomId]);

  // Auto-retry when the WebRTC connection fails (e.g. TURN relay hiccup inside
  // the Discord Activity sandbox). Without this the viewer is stuck on a black
  // screen forever with no way to recover except manually clicking reconnect.
  // The slow JPEG "modo compatibilidade" fallback is a LAST RESORT only — it
  // is intentionally requested after a couple of real WebRTC retries have
  // already failed, not on the very first hiccup, so a transient blip doesn't
  // needlessly drop everyone into the low quality/low fps mode.
  // NOTE: none of this runs inside a Discord Activity anymore — viewers there
  // use the WebCodecs relay (see effect #3 above), which never attempts
  // WebRTC in the first place, so it can't land in 'failed' for that reason.
  const FALLBACK_AFTER_RETRIES = 2;
  const failedRetryCountRef = useRef(0);
  const fallbackRequestedRef = useRef(false);
  useEffect(() => {
    if (isDiscordActivity() && canViewWithWebCodecs()) return;
    if (connectionState !== 'failed') {
      failedRetryCountRef.current = 0;
      fallbackRequestedRef.current = false;
      return;
    }

    if (
      !fallbackRequestedRef.current &&
      failedRetryCountRef.current >= FALLBACK_AFTER_RETRIES &&
      activeStream &&
      activeStream.streamerId !== currentUser.id
    ) {
      fallbackRequestedRef.current = true;
      const socket = getSocket();
      socket.emit('request-frame-fallback', { roomId, streamerId: activeStream.streamerId });
    }

    if (failedRetryCountRef.current >= 5) {
      console.warn('[WebRTC] Giving up auto-retry after 5 attempts. Check TURN server reachability.');
      return;
    }
    failedRetryCountRef.current += 1;
    const t = setTimeout(() => {
      console.log(`[WebRTC] Auto-retry attempt ${failedRetryCountRef.current}...`);
      handleReconnect();
    }, 2000);
    return () => clearTimeout(t);
  }, [connectionState, handleReconnect, activeStream, roomId, currentUser.id]);

  // Send Chat
  const handleSendMessage = (text: string) => {
    const newMsg: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random()}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      text,
      timestamp: Date.now(),
    };

    const socket = getSocket();
    socket.emit('send-chat', { roomId, message: newMsg });
  };

  // Send Reaction
  const handleSendReaction = (emoji: string) => {
    const socket = getSocket();
    socket.emit('send-reaction', { roomId, emoji, sender: currentUser.name });
  };

  // Screen share trigger. Only one control for this in the whole app now
  // (the header button) — clicking it toggles share/stop directly, with no
  // extra confirmation dialogs or intermediate modals.
  const handleTriggerShare = () => {
    // I'm actually broadcasting in this session -> stop.
    if (isStreaming) {
      handleStopStream();
      return;
    }

    // Inside a Discord Activity: if there's already an active stream in the
    // room (started from the external browser tab, since the Activity
    // iframe itself can't capture the screen), treat this click as "parar
    // compartilhamento" too — this is what makes the header button correctly
    // flip to a stop control instead of staying stuck on "Compartilhar tela"
    // forever while you're already sharing from the other tab.
    if (isDiscordActivity() && activeStream) {
      handleStopStream();
      return;
    }

    if (isDiscordActivity()) {
      // Screen capture isn't available inside the Discord Activity sandbox,
      // so silently hand off to the external browser tab — no popup/warning.
      openExternalShareLink(getShareUrl(roomId));
      return;
    }

    // In web browser: open quality selection modal before display media picker
    setIsQualityModalOpen(true);
  };

  // Fullscreen state. Tries the real Fullscreen API first, but that API is
  // frequently unavailable/blocked inside the Discord Activity iframe
  // sandbox (no Permissions-Policy grant from the embedding page) — when it
  // is, we fall back to a CSS-only "pseudo fullscreen" (fixed, covers the
  // whole viewport) so the button always visibly does something instead of
  // silently failing.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);

  const handleToggleFullscreen = async () => {
    if (isFullscreen || isPseudoFullscreen) {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          // ignore
        }
      }
      setIsPseudoFullscreen(false);
      setIsFullscreen(false);
      return;
    }

    try {
      await document.documentElement.requestFullscreen();
      // isFullscreen is set by the 'fullscreenchange' listener below once
      // the browser confirms it actually happened.
    } catch (err) {
      console.warn('[Fullscreen] Native API unavailable, using CSS fallback:', err);
      setIsPseudoFullscreen(true);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (document.fullscreenElement) {
        setIsPseudoFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const isEffectivelyFullscreen = isFullscreen || isPseudoFullscreen;
  // Someone else is currently sharing and I haven't clicked "Assistir
  // compartilhamento" for THIS stream yet — this drives whether we show the
  // watch card or the actual player below.
  const isWatchingActiveStream =
    !!activeStream &&
    (activeStream.streamerId === currentUser.id || watchingStreamId === activeStream.streamId);

  return (
    <div
      className={`h-screen bg-[#07080c] text-white flex flex-col font-sans select-none overflow-hidden ${
        isPseudoFullscreen ? 'fixed inset-0 z-[999] h-screen w-screen' : ''
      }`}
    >
      {/* Top Navigation Bar matching screenshot */}
      <Header
        roomId={roomId}
        currentUser={currentUser}
        users={users}
        activeStream={activeStream}
        isStreaming={isStreaming}
        isSocketConnected={isSocketConnected}
        onToggleStream={handleTriggerShare}
        onToggleFullscreen={handleToggleFullscreen}
        isFullscreen={isEffectivelyFullscreen}
      />

      {/* Main Full-Viewport Canvas */}
      <main className="relative flex-1 min-h-0 w-full h-full flex flex-col bg-[#07080c] overflow-hidden">
        {/* Floating "POWERED BY YANG" badge */}
        <div className="absolute top-4 left-5 z-20 pointer-events-auto">
          <div className="flex items-center gap-2 bg-[#090b10]/80 backdrop-blur-md border border-[#1d202b] rounded-full px-2.5 py-1 text-[11px] font-semibold text-gray-400 shadow-lg hover:border-[#2f3547] transition-all">
            <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#5865F2] to-black border border-[#5865F2]/40 flex items-center justify-center text-[10px] text-white overflow-hidden shadow-inner">
              <span className="font-extrabold text-[9px] text-indigo-300">Y</span>
            </div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
              POWERED BY <strong className="text-white font-extrabold tracking-tight">YANG</strong>
            </span>
          </div>
        </div>

        {/* Center Stage: Live Stream Player, Watch Card, or Empty Stage */}
        <div className="flex-1 min-h-0 w-full h-full flex items-center justify-center relative">
          {activeStream ? (
            isWatchingActiveStream ? (
              <div className="w-full h-full min-h-0 flex-1 flex flex-col">
                <StreamPlayer
                  roomId={roomId}
                  relayCanvasRef={canvasRef}
                  canvasRelayRef={webCodecsViewerRef}
                  canvasFitRef={canvasFitRef}
                  audioRelayRef={webCodecsAudioViewerRef}
                  activeStream={activeStream}
                  currentUser={currentUser}
                  localStream={localStream}
                  remoteStream={remoteStream}
                  webcamStream={webcamStream}
                  isStreaming={isStreaming}
                  connectionState={connectionState}
                  onReconnect={handleReconnect}
                  reactions={reactions}
                  fallbackFrame={fallbackFrame}
                />
              </div>
            ) : (
              <StreamWatchCard
                streamerName={activeStream.streamerName}
                title={activeStream.title}
                onWatch={() => setWatchingStreamId(activeStream.streamId)}
              />
            )
          ) : (
            <EmptyStreamStage
              roomId={roomId}
              onStartStream={handleStartStream}
              onRequestQualityModal={handleTriggerShare}
              isStarting={isStartingStream}
            />
          )}
        </div>
      </main>

      {/* Quality Select Modal before display media picker */}
      <QualitySelectModal
        isOpen={isQualityModalOpen}
        onClose={() => setIsQualityModalOpen(false)}
        onConfirm={(config) => {
          setIsQualityModalOpen(false);
          handleStartStream(config);
        }}
        isStarting={isStartingStream}
      />

      {/* Discord Activity Info Modal */}
      <DiscordActivityInfo
        isOpen={isActivityModalOpen}
        onClose={() => setIsActivityModalOpen(false)}
        roomId={roomId}
      />

      {/* Dual Test Modal */}
      <DualTestModal
        isOpen={isDualTestModalOpen}
        onClose={() => setIsDualTestModalOpen(false)}
        roomId={roomId}
      />
    </div>
  );
}

