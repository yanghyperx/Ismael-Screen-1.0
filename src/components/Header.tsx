import React from 'react';
import {
  Tv,
  Users,
  Maximize2,
  Minimize2,
  Monitor,
  LogOut,
  Square,
} from 'lucide-react';
import { StreamInfo, UserInfo } from '../types';
import { isDiscordActivity } from '../lib/discord';

interface HeaderProps {
  roomId: string;
  currentUser: UserInfo;
  users: UserInfo[];
  activeStream: StreamInfo | null;
  isStreaming: boolean;
  isSocketConnected?: boolean;
  onToggleStream: () => void;
  onLeaveRoom?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  roomId,
  currentUser,
  users,
  activeStream,
  isStreaming,
  isSocketConnected = true,
  onToggleStream,
  onLeaveRoom,
  onToggleFullscreen,
  isFullscreen = false,
}) => {
  const viewersCount = users.length;
  const isLive = !!activeStream || isStreaming;

  // Inside a Discord Activity the actual screen capture always happens in a
  // separate external browser tab (the Activity iframe can't do it itself),
  // so `isStreaming` alone stays false in THIS session even while you're
  // sharing. Treat "there's an active stream while I'm in the Activity" the
  // same as "I'm sharing" so this single button correctly flips to
  // "Parar compartilhamento" instead of offering to share again.
  const isSharingActive = isStreaming || (isDiscordActivity() && !!activeStream);

  return (
    <header className="w-full bg-[#0d0f15] border-b border-[#1b1e2a] px-4 py-2.5 select-none z-30">
      <div className="w-full flex items-center justify-between gap-3">
        {/* Left: Sala ao vivo icon & title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#141724] border border-[#23283e] text-[#808cf7] shadow-sm">
            <Tv className="w-4 h-4" />
          </div>
          <h1 className="font-bold text-sm tracking-tight text-white">Sala ao vivo</h1>
        </div>

        {/* Right: Controls & Badges */}
        <div className="flex items-center gap-2">
          {/* Status Badge */}
          <div className="flex items-center gap-1.5 bg-[#12141c] border border-[#1f2330] px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300">
            <span
              className={`w-2 h-2 rounded-full ${
                isLive
                  ? 'bg-emerald-500 animate-pulse'
                  : isSocketConnected
                  ? 'bg-amber-400'
                  : 'bg-red-500'
              }`}
            />
            <span>
              {isLive
                ? 'Ao vivo'
                : isSocketConnected
                ? 'Aguardando transmissão'
                : 'Desconectado'}
            </span>
          </div>

          {/* User count badge */}
          <div className="flex items-center gap-1.5 bg-[#12141c] border border-[#1f2330] px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300">
            <Users className="w-3.5 h-3.5 text-gray-400" />
            <span>{viewersCount} {viewersCount === 1 ? 'pessoa' : 'pessoas'}</span>
          </div>

          {/* Fullscreen Button */}
          {onToggleFullscreen && (
            <button
              id="btn-header-fullscreen"
              onClick={onToggleFullscreen}
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              className="p-2 rounded-lg bg-[#12141c] hover:bg-[#1b1f2e] border border-[#1f2330] text-gray-300 hover:text-white transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}

          {/* Compartilhar tela / Parar compartilhamento button — the ONLY
              share control in the whole app now. */}
          {isSharingActive ? (
            <button
              id="btn-stop-sharing"
              onClick={onToggleStream}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-md shadow-red-600/20 transition-all cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Parar compartilhamento</span>
            </button>
          ) : (
            <button
              id="btn-share-screen"
              onClick={onToggleStream}
              className="flex items-center gap-2 bg-[#5865F2] hover:bg-[#4752c4] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-md shadow-[#5865F2]/25 transition-all cursor-pointer"
            >
              <Monitor className="w-4 h-4" />
              <span>Compartilhar tela</span>
            </button>
          )}

          {/* Leave / Logout button */}
          <button
            id="btn-leave-room"
            onClick={() => {
              if (onLeaveRoom) {
                onLeaveRoom();
              } else {
                window.location.reload();
              }
            }}
            title="Sair da sala"
            className="p-2 rounded-lg bg-[#12141c] hover:bg-red-500/10 border border-[#1f2330] hover:border-red-500/30 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
