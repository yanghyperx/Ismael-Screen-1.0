import React from 'react';
import { Users, Crown, Radio, Shield, User } from 'lucide-react';
import { UserInfo, StreamInfo } from '../types';

interface ParticipantsListProps {
  users: UserInfo[];
  currentUser: UserInfo;
  activeStream: StreamInfo | null;
}

export const ParticipantsList: React.FC<ParticipantsListProps> = ({
  users,
  currentUser,
  activeStream,
}) => {
  return (
    <div className="bg-[#11131a] border border-[#232736] rounded-2xl overflow-hidden shadow-xl">
      <div className="px-4 py-3 border-b border-[#232736] flex items-center justify-between bg-[#141722]">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#5865F2]" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">Participantes</span>
        </div>
        <span className="text-[11px] font-bold bg-[#1e2333] text-[#808cf7] px-2 py-0.5 rounded-full border border-[#2e364c]">
          {users.length}
        </span>
      </div>

      <div className="p-3 space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
        {users.map((user) => {
          const isMe = user.id === currentUser.id;
          const isStreamer = activeStream?.streamerId === user.id;

          return (
            <div
              key={user.id}
              className={`flex items-center justify-between p-2 rounded-xl border transition-colors ${
                isStreamer
                  ? 'bg-red-500/10 border-red-500/30 text-white'
                  : isMe
                  ? 'bg-[#181b26] border-[#5865F2]/40 text-gray-200'
                  : 'bg-[#141722]/60 border-transparent text-gray-300 hover:bg-[#181b26]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative w-7 h-7 rounded-lg bg-[#232736] flex items-center justify-center font-bold text-xs text-white shrink-0">
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="w-full h-full rounded-lg object-cover" />
                  ) : (
                    user.name.slice(0, 2).toUpperCase()
                  )}
                  {isStreamer && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-[#11131a] animate-pulse" />
                  )}
                </div>
                <div className="truncate">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-xs font-semibold truncate">{user.name}</span>
                    {isMe && (
                      <span className="text-[9px] bg-[#5865F2]/20 text-[#5865F2] px-1 py-0.2 rounded font-bold shrink-0">
                        Você
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 block">
                    {isStreamer ? 'Transmitindo tela' : 'Assistindo'}
                  </span>
                </div>
              </div>

              <div>
                {isStreamer ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/20 px-2 py-0.5 rounded-full border border-red-500/30">
                    <Radio className="w-3 h-3" /> AO VIVO
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-400">Online</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
