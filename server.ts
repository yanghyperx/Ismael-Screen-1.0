import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';

interface UserInfo {
  id: string;
  name: string;
  avatar?: string;
  isStreaming?: boolean;
  streamId?: string;
  joinedAt: number;
}

interface StreamInfo {
  streamId: string;
  streamerId: string;
  streamerName: string;
  streamerAvatar?: string;
  title: string;
  resolution: string;
  fps: number;
  hasAudio: boolean;
  startedAt: number;
  viewersCount: number;
}

interface RoomState {
  roomId: string;
  users: Map<string, UserInfo>;
  activeStream: StreamInfo | null;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Global CORS Middleware
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // In-memory room store
  const rooms = new Map<string, RoomState>();

  const getOrCreateRoom = (roomId: string): RoomState => {
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        users: new Map(),
        activeStream: null,
      };
      rooms.set(roomId, room);
    }
    return room;
  };

  // Socket.IO Server with broad origin compatibility
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: false,
    },
    allowEIO3: true,
    transports: ['websocket', 'polling'],
    pingInterval: 10000,
    pingTimeout: 5000,
    // Default is 1MB — a single VP8 keyframe at 720p/1080p can exceed that,
    // which would silently disconnect the socket mid-stream.
    maxHttpBufferSize: 5 * 1024 * 1024,
  });

  io.on('connection', (socket) => {
    let currentRoomId: string | null = null;
    let currentUserId: string | null = null;

    // Join room
    socket.on('join-room', ({ roomId, user }: { roomId: string; user: { id: string; name: string; avatar?: string } }) => {
      currentRoomId = roomId;
      currentUserId = user.id;

      socket.join(roomId);
      const room = getOrCreateRoom(roomId);

      const userInfo: UserInfo = {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        isStreaming: room.activeStream?.streamerId === user.id,
        streamId: room.activeStream?.streamerId === user.id ? room.activeStream.streamId : undefined,
        joinedAt: Date.now(),
      };

      room.users.set(user.id, userInfo);

      // Send initial room state to newly joined user
      const usersList = Array.from(room.users.values());
      socket.emit('room-state', {
        roomId,
        users: usersList,
        activeStream: room.activeStream,
      });

      // Broadcast to other users in room
      socket.to(roomId).emit('user-joined', {
        user: userInfo,
        users: usersList,
        activeStream: room.activeStream,
      });
    });

    // Start streaming
    socket.on('start-stream', ({ roomId, streamInfo }: { roomId: string; streamInfo: Partial<StreamInfo> }) => {
      const room = getOrCreateRoom(roomId);
      const fullStreamInfo: StreamInfo = {
        streamId: streamInfo.streamId || `stream-${Date.now()}`,
        streamerId: currentUserId || socket.id,
        streamerName: streamInfo.streamerName || 'Streamer',
        streamerAvatar: streamInfo.streamerAvatar,
        title: streamInfo.title || 'Live Screen Share',
        resolution: streamInfo.resolution || '1080p',
        fps: streamInfo.fps || 60,
        hasAudio: !!streamInfo.hasAudio,
        startedAt: Date.now(),
        viewersCount: Math.max(0, room.users.size - 1),
      };

      room.activeStream = fullStreamInfo;

      const user = room.users.get(fullStreamInfo.streamerId);
      if (user) {
        user.isStreaming = true;
        user.streamId = fullStreamInfo.streamId;
      }

      io.to(roomId).emit('stream-started', {
        activeStream: fullStreamInfo,
        users: Array.from(room.users.values()),
      });
    });

    // Stop streaming
    socket.on('stop-stream', ({ roomId }: { roomId: string }) => {
      const room = rooms.get(roomId);
      if (room && room.activeStream) {
        const streamerId = room.activeStream.streamerId;
        const user = room.users.get(streamerId);
        if (user) {
          user.isStreaming = false;
          user.streamId = undefined;
        }
        room.activeStream = null;

        io.to(roomId).emit('stream-stopped', {
          users: Array.from(room.users.values()),
        });
      }
    });

    // WebRTC Signaling: Viewer requests stream from broadcaster
    socket.on('request-stream-offer', ({ roomId, viewerId, streamerId, viewerInDiscordActivity }: { roomId: string; viewerId: string; streamerId: string; viewerInDiscordActivity?: boolean }) => {
      // Direct message to the broadcaster
      io.to(roomId).emit('viewer-ready-for-offer', {
        viewerId,
        streamerId,
        viewerInDiscordActivity: !!viewerInDiscordActivity,
      });
    });

    // WebRTC Signaling: Broadcaster sends offer to specific viewer
    socket.on('signal-offer', ({ roomId, targetViewerId, offer, streamerId }: { roomId: string; targetViewerId: string; offer: any; streamerId: string }) => {
      socket.to(roomId).emit('signal-offer-received', {
        targetViewerId,
        offer,
        streamerId,
      });
    });

    // WebRTC Signaling: Viewer sends answer to broadcaster
    socket.on('signal-answer', ({ roomId, targetStreamerId, answer, viewerId }: { roomId: string; targetStreamerId: string; answer: any; viewerId: string }) => {
      socket.to(roomId).emit('signal-answer-received', {
        targetStreamerId,
        answer,
        viewerId,
      });
    });

    // WebRTC Signaling: ICE Candidate
    socket.on('signal-candidate', ({ roomId, targetId, candidate, senderId }: { roomId: string; targetId: string; candidate: any; senderId: string }) => {
      socket.to(roomId).emit('signal-candidate-received', {
        targetId,
        candidate,
        senderId,
      });
    });

    // Real-time video relay (WebCodecs): the streamer encodes with VideoEncoder
    // (no container, latencyMode: 'realtime') and sends each encoded chunk as
    // plain binary here. We relay it untouched to everyone watching in this
    // room. Using `volatile` means a chunk is dropped instead of queued if a
    // viewer's socket is congested — a stale queued video chunk is worse than
    // a dropped one, since piling them up only turns into permanent lag.
    socket.on('video-chunk', ({ roomId, streamerId, packet }: { roomId: string; streamerId: string; packet: { type: 'key' | 'delta'; timestamp: number; data: ArrayBuffer } }) => {
      socket.volatile.to(roomId).emit('video-chunk-received', { streamerId, packet });
    });

    // Same idea as video-chunk above, but for the audio relay (WebCodecs
    // AudioEncoder/AudioDecoder) — gives Discord Activity viewers real audio,
    // since RTCPeerConnection audio never reaches them either.
    socket.on('audio-chunk', ({ roomId, streamerId, packet }: { roomId: string; streamerId: string; packet: { timestamp: number; data: ArrayBuffer; sampleRate: number; numberOfChannels: number } }) => {
      socket.volatile.to(roomId).emit('audio-chunk-received', { streamerId, packet });
    });

    // A viewer just joined mid-stream and has nothing to decode yet — ask the
    // streamer for a fresh keyframe so they can start in ~1 frame instead of
    // waiting for the next scheduled one.
    socket.on('need-keyframe', ({ roomId, streamerId }: { roomId: string; streamerId: string }) => {
      socket.to(roomId).emit('need-keyframe-received', { streamerId, requesterId: socket.id });
    });

    // Legacy fallback "video by images" relay — kept only for older clients;
    // the WebCodecs relay above is now the primary path used inside Discord.
    socket.on('request-frame-fallback', ({ roomId, streamerId }: { roomId: string; streamerId: string }) => {
      socket.to(roomId).emit('frame-fallback-requested', { streamerId });
    });

    socket.on('frame-relay', ({ roomId, dataUrl }: { roomId: string; dataUrl: string }) => {
      socket.to(roomId).emit('frame-relay-received', { dataUrl });
    });

    // Chat Message
    socket.on('send-chat', ({ roomId, message }: { roomId: string; message: { id: string; text: string; sender: string; avatar?: string; timestamp: number } }) => {
      io.to(roomId).emit('new-chat', message);
    });

    // Quick emoji reaction
    socket.on('send-reaction', ({ roomId, emoji, sender }: { roomId: string; emoji: string; sender: string }) => {
      io.to(roomId).emit('new-reaction', { emoji, sender, timestamp: Date.now() });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
      if (currentRoomId && currentUserId) {
        const room = rooms.get(currentRoomId);
        if (room) {
          room.users.delete(currentUserId);

          if (room.activeStream && room.activeStream.streamerId === currentUserId) {
            room.activeStream = null;
            io.to(currentRoomId).emit('stream-stopped', {
              users: Array.from(room.users.values()),
            });
          }

          io.to(currentRoomId).emit('user-left', {
            userId: currentUserId,
            users: Array.from(room.users.values()),
            activeStream: room.activeStream,
          });

          // Clean empty room after delay
          if (room.users.size === 0) {
            setTimeout(() => {
              const currentCheck = rooms.get(currentRoomId!);
              if (currentCheck && currentCheck.users.size === 0) {
                rooms.delete(currentRoomId!);
              }
            }, 60000);
          }
        }
      }
    });
  });

  // REST API Routes
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), activeRooms: rooms.size });
  });

  // Dynamic TURN credentials. Static, publicly-shared TURN creds (like the
  // openrelayproject ones) get overloaded and become unreliable — this is
  // especially punishing inside the Discord Activity sandbox, which depends
  // entirely on TURN relay to work at all. We support two providers here:
  //
  //  1. Cloudflare Realtime TURN (preferred) — 1,000 GB/month free, set via
  //     CF_TURN_KEY_ID + CF_TURN_KEY_API_TOKEN (create a TURN key in the
  //     Cloudflare dashboard under Realtime > TURN).
  //  2. Metered.ca (fallback) — set via METERED_API_KEY + METERED_DOMAIN.
  //
  // If neither is configured, the client falls back to the static list on
  // its own. Credentials are cached briefly to avoid hitting either API on
  // every single viewer join.
  let turnCache: { servers: any[]; expiresAt: number; provider: string } | null = null;

  async function fetchCloudflareTurnCredentials(): Promise<any[] | null> {
    const keyId = process.env.CF_TURN_KEY_ID;
    const apiToken = process.env.CF_TURN_KEY_API_TOKEN;
    if (!keyId || !apiToken) return null;

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 86400 }), // 24h
      }
    );
    if (!response.ok) {
      throw new Error(`Cloudflare Realtime TURN API returned ${response.status}`);
    }
    const data = await response.json();
    // Cloudflare returns { iceServers: [...] } already in the shape the
    // client expects.
    return Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
  }

  async function fetchMeteredTurnCredentials(): Promise<any[] | null> {
    const apiKey = process.env.METERED_API_KEY;
    const domain = process.env.METERED_DOMAIN; // e.g. "yoursubdomain.metered.live"
    if (!apiKey || !domain) return null;

    const response = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
    );
    if (!response.ok) {
      throw new Error(`Metered API returned ${response.status}`);
    }
    return response.json();
  }

  app.get('/api/turn-credentials', async (_req, res) => {
    try {
      if (turnCache && turnCache.expiresAt > Date.now()) {
        return res.json({ configured: true, provider: turnCache.provider, iceServers: turnCache.servers });
      }

      // Try Cloudflare first (far more generous free tier), then Metered.
      let servers: any[] | null = null;
      let provider = 'none';
      try {
        servers = await fetchCloudflareTurnCredentials();
        if (servers) provider = 'cloudflare';
      } catch (err) {
        console.error('[TURN] Cloudflare Realtime TURN request failed:', err);
      }

      if (!servers) {
        try {
          servers = await fetchMeteredTurnCredentials();
          if (servers) provider = 'metered';
        } catch (err) {
          console.error('[TURN] Metered TURN request failed:', err);
        }
      }

      if (!servers) {
        return res.json({ configured: false, iceServers: [] });
      }

      // Cache for 5 hours (both providers' credentials are typically valid
      // ~24h, but refresh well before expiry to be safe).
      turnCache = { servers, expiresAt: Date.now() + 5 * 60 * 60 * 1000, provider };

      res.json({ configured: true, provider, iceServers: servers });
    } catch (err) {
      console.error('[TURN] Failed to fetch TURN credentials:', err);
      res.json({ configured: false, iceServers: [] });
    }
  });

  app.get('/api/room/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) {
      return res.json({
        exists: false,
        roomId,
        users: [],
        activeStream: null,
      });
    }

    res.json({
      exists: true,
      roomId: room.roomId,
      users: Array.from(room.users.values()),
      activeStream: room.activeStream,
    });
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Ismael Bot Screen Share Server running on http://localhost:${PORT}`);
  });
}

startServer();
