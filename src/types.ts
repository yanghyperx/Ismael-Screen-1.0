export type ResolutionPreset = '720p' | '1080p' | '1440p' | '4k';
export type FPSPreset = 30 | 60;

export interface StreamQualityConfig {
  resolution: ResolutionPreset;
  fps: FPSPreset;
  includeSystemAudio: boolean;
  includeMicrophone: boolean;
  enableWebcamPip: boolean;
  bitrateKbps: number;
}

export interface UserInfo {
  id: string;
  name: string;
  avatar?: string;
  isStreaming?: boolean;
  streamId?: string;
  joinedAt: number;
}

export interface StreamInfo {
  streamId: string;
  streamerId: string;
  streamerName: string;
  streamerAvatar?: string;
  title: string;
  resolution: ResolutionPreset | string;
  fps: number;
  hasAudio: boolean;
  startedAt: number;
  viewersCount: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface ReactionItem {
  id: string;
  emoji: string;
  sender: string;
  x: number;
  y: number;
}

export interface RoomState {
  roomId: string;
  users: UserInfo[];
  activeStream: StreamInfo | null;
}

export type ViewMode = 'standard' | 'theater' | 'discord-activity' | 'dual-test';
