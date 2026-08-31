import { io, Socket } from 'socket.io-client';
import { VPS_BASE_URL } from './config';

let socketInstance: Socket | null = null;

export function getSocketServerUrl(): string {
  if (typeof window !== 'undefined') {
    // In all browser contexts (Standalone, Discord Activity iframe, Dev preview)
    // connecting to window.location.origin uses the current host or Discord's transparent proxy
    return window.location.origin;
  }
  return VPS_BASE_URL;
}

export function getSocket(): Socket {
  if (!socketInstance) {
    const serverUrl = getSocketServerUrl();
    socketInstance = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['polling', 'websocket'],
      withCredentials: false,
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('[Socket.IO] Connection error on:', serverUrl, err.message);
    });
  }
  return socketInstance;
}


export function generateRoomId(): string {
  // Generate room id e.g. "d-4c8b-e8de-c307"
  const hexPart = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `d-${hexPart()}-${hexPart()}-${hexPart()}`;
}

export function getRoomIdFromUrl(): string {
  if (typeof window === 'undefined') return 'default-room';

  // 1. Check URL pathname e.g. /r/d-4c8b-e8de-c307 or /r/disc-12345
  const path = window.location.pathname;
  const match = path.match(/\/r\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }

  // 2. Check URL query param ?room=...
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    return roomParam;
  }

  // 3. Check Discord Activity specific params (channel_id or instance_id)
  const discordChannelId = urlParams.get('channel_id') || urlParams.get('instance_id');
  if (discordChannelId) {
    return `disc-${discordChannelId}`;
  }

  // 4. Check URL hash #room=...
  if (window.location.hash.startsWith('#room=')) {
    return window.location.hash.replace('#room=', '');
  }

  // 5. Check session storage
  const savedRoom = sessionStorage.getItem('ismael_room_id');
  if (savedRoom) {
    return savedRoom;
  }

  const newId = generateRoomId();
  sessionStorage.setItem('ismael_room_id', newId);
  return newId;
}

export function updateUrlWithRoomId(roomId: string) {
  try {
    const url = new URL(window.location.href);
    url.pathname = `/r/${roomId}`;
    window.history.replaceState({}, '', url.toString());
  } catch {
    // ignore
  }
}
