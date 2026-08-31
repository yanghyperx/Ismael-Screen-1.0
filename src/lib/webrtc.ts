import { ResolutionPreset, FPSPreset } from '../types';

// TURN servers listed FIRST: inside the Discord Activity sandbox, direct/STUN
// candidates almost never work, so we want the browser to have TURN candidates
// gathered and ready as early as possible instead of wasting time on doomed
// host/srflx attempts.
const TURN_SERVERS: RTCIceServer[] = [
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.services.mozilla.com' },
];

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [...TURN_SERVERS, ...STUN_SERVERS],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

/**
 * Relay-only config. Discord's Activity iframe runs in a locked-down network
 * sandbox where direct P2P (host/srflx) candidates essentially never connect —
 * only a TURN relay reaches the peer reliably. Forcing 'relay' here skips the
 * wasted attempts and gets to a working connection (or a real ICE failure)
 * much faster instead of silently hanging.
 */
export const ICE_SERVERS_RELAY_ONLY: RTCConfiguration = {
  iceServers: TURN_SERVERS,
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'relay',
};

// Cache fetched dynamic TURN credentials (Metered.ca) for the session so we
// don't re-fetch on every peer connection.
let dynamicTurnServers: RTCIceServer[] | null = null;
let dynamicTurnFetchPromise: Promise<RTCIceServer[] | null> | null = null;

async function fetchDynamicTurnServers(): Promise<RTCIceServer[] | null> {
  if (dynamicTurnServers) return dynamicTurnServers;
  if (dynamicTurnFetchPromise) return dynamicTurnFetchPromise;

  dynamicTurnFetchPromise = (async () => {
    try {
      const res = await fetch('/api/turn-credentials');
      const data = await res.json();
      if (data.configured && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        dynamicTurnServers = data.iceServers;
        // Log the REAL provider the server actually used (cloudflare/metered),
        // instead of a hardcoded label — the old message always said
        // "Metered.ca" even when Cloudflare credentials were the ones in use,
        // making it impossible to verify which TURN provider was actually active.
        console.log(`[WebRTC] Using dynamic TURN credentials (provider: ${data.provider || 'unknown'}).`);
        return dynamicTurnServers;
      }
      console.warn('[WebRTC] Server has no TURN provider configured (provider: none) — falling back to static openrelay/STUN servers.');
      return null;
    } catch (err) {
      console.warn('[WebRTC] Could not fetch dynamic TURN credentials, using static fallback:', err);
      return null;
    }
  })();

  return dynamicTurnFetchPromise;
}

/**
 * Fallback "video by images" relay used ONLY when the real WebRTC connection
 * fails (e.g. TURN unreachable inside the Discord Activity sandbox). It draws
 * the screen-share stream onto a canvas at a low resolution/framerate and
 * hands JPEG data URLs to `onFrame`, which the caller sends over the existing
 * Socket.IO connection (already proven to work, since it's plain WebSocket
 * through Discord's proxy — no NAT traversal required). Lower quality than
 * real WebRTC, but guarantees something shows up instead of a black screen.
 */
export function startFrameRelay(
  stream: MediaStream,
  onFrame: (dataUrl: string) => void,
  options: { fps?: number; maxWidth?: number; quality?: number } = {}
): () => void {
  const { fps = 6, maxWidth = 800, quality = 0.55 } = options;

  const videoEl = document.createElement('video');
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.srcObject = stream;
  videoEl.play().catch(() => {
    // Autoplay might be blocked without user gesture in rare cases; the
    // interval below will simply produce no frames until it can play.
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  let stopped = false;

  const tick = () => {
    if (stopped || !ctx) return;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (vw && vh) {
      const scale = Math.min(1, maxWidth / vw);
      canvas.width = Math.max(1, Math.round(vw * scale));
      canvas.height = Math.max(1, Math.round(vh * scale));
      try {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        onFrame(canvas.toDataURL('image/jpeg', quality));
      } catch {
        // ignore transient encode errors (e.g. mid-resize frame)
      }
    }
  };

  const timer = setInterval(tick, Math.round(1000 / fps));

  return () => {
    stopped = true;
    clearInterval(timer);
    videoEl.pause();
    videoEl.srcObject = null;
  };
}


/**
 * Builds an ICE config, preferring dynamic (Metered.ca) TURN credentials when
 * the server has them configured, falling back to the static free servers
 * otherwise. Pass relayOnly=true for peers inside the Discord Activity sandbox.
 */
export async function buildIceConfig(relayOnly: boolean): Promise<RTCConfiguration> {
  const dynamic = await fetchDynamicTurnServers();

  if (dynamic) {
    return {
      iceServers: relayOnly ? dynamic : [...dynamic, ...STUN_SERVERS],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      ...(relayOnly ? { iceTransportPolicy: 'relay' as const } : {}),
    };
  }

  return relayOnly ? ICE_SERVERS_RELAY_ONLY : ICE_SERVERS;
}

/**
 * Optimizes WebRTC codecs preferring VP8 / VP9 which are universally supported across Electron and Discord sandboxes without black frames
 */
export function optimizeCodecs(pc: RTCPeerConnection) {
  try {
    if (typeof RTCRtpSender !== 'undefined' && 'getCapabilities' in RTCRtpSender) {
      const capabilities = RTCRtpSender.getCapabilities('video');
      if (capabilities && capabilities.codecs) {
        const sortedCodecs = [...capabilities.codecs].sort((a, b) => {
          const mimeA = a.mimeType.toLowerCase();
          const mimeB = b.mimeType.toLowerCase();
          // VP8 first, then VP9, then H264
          if (mimeA.includes('vp8')) return -1;
          if (b.mimeType.toLowerCase().includes('vp8')) return 1;
          if (mimeA.includes('vp9')) return -1;
          if (mimeB.includes('vp9')) return 1;
          return 0;
        });

        pc.getTransceivers().forEach((transceiver) => {
          if (
            (transceiver.sender.track?.kind === 'video' || transceiver.receiver.track?.kind === 'video') &&
            'setCodecPreferences' in transceiver
          ) {
            try {
              transceiver.setCodecPreferences(sortedCodecs);
            } catch (e) {
              console.warn('[WebRTC] setCodecPreferences:', e);
            }
          }
        });
      }
    }
  } catch (err) {
    console.warn('[WebRTC] Codec optimization error:', err);
  }
}

/**
 * Tune SDP to guarantee minimum 6-8 Mbps for 60fps high motion screen capture
 */
export function tuneSdp(sdp: string, bitrateKbps: number = 8000): string {
  let modifiedSdp = sdp;
  // Modify or insert b=AS and b=TIAS for video section
  if (modifiedSdp.includes('m=video')) {
    modifiedSdp = modifiedSdp.replace(
      /(m=video[^\r\n]+(\r?\n))/g,
      `$1b=AS:${bitrateKbps}\r\nb=TIAS:${bitrateKbps * 1000}\r\n`
    );
  }
  return modifiedSdp;
}

export const RESOLUTION_CONSTRAINTS: Record<ResolutionPreset, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

/**
 * Capture screen stream with optional system audio and microphone mixing
 */
export async function captureDisplayMedia(
  resolution: ResolutionPreset = '1080p',
  fps: FPSPreset = 60,
  includeSystemAudio: boolean = true,
  includeMicrophone: boolean = false
): Promise<{ stream: MediaStream; mixedAudio?: boolean }> {
  const { width, height } = RESOLUTION_CONSTRAINTS[resolution] || RESOLUTION_CONSTRAINTS['1080p'];

  const displayMediaOptions: DisplayMediaStreamOptions = {
    video: {
      width: { ideal: width, max: width },
      height: { ideal: height, max: height },
      frameRate: { ideal: fps, max: fps },
    },
    audio: includeSystemAudio
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : false,
  };

  const displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

  // Set contentHint to motion so Chromium encoder produces continuous smooth frames
  displayStream.getVideoTracks().forEach((track) => {
    if ('contentHint' in track) {
      (track as any).contentHint = 'motion';
    }
    track.enabled = true;
  });

  // If microphone is requested and user has mic, mix the mic audio with system audio
  if (includeMicrophone) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const destination = audioCtx.createMediaStreamDestination();

      // If display stream has system audio, add it to mix
      if (displayStream.getAudioTracks().length > 0) {
        const sysSource = audioCtx.createMediaStreamSource(displayStream);
        sysSource.connect(destination);
      }

      // Add mic audio to mix
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(destination);

      // Create composite stream: Display video + mixed audio
      const combinedTracks = [
        ...displayStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ];

      const mixedStream = new MediaStream(combinedTracks);

      // Listen for video stop to clean up mic
      displayStream.getVideoTracks()[0].onended = () => {
        micStream.getTracks().forEach((t) => t.stop());
        audioCtx.close();
      };

      return { stream: mixedStream, mixedAudio: true };
    } catch (err) {
      console.warn('Could not capture microphone for stream mix:', err);
      // fallback to just display stream
    }
  }

  return { stream: displayStream, mixedAudio: false };
}

/**
 * Capture user webcam for Picture-in-Picture overlay
 */
export async function captureWebcam(): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 },
      facingMode: 'user',
    },
    audio: false,
  });
}
