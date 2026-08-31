import React from 'react';
import { Tv, Radio, Eye } from 'lucide-react';

interface StreamWatchCardProps {
  streamerName: string;
  title?: string;
  onWatch: () => void;
}

/**
 * Shown instead of auto-connecting to whoever is currently sharing. The
 * viewer sees who is streaming and has to explicitly click "Assistir
 * compartilhamento" before any video/audio connection is attempted.
 */
export const StreamWatchCard: React.FC<StreamWatchCardProps> = ({
  streamerName,
  title,
  onWatch,
}) => {
  return (
    <div className="w-full h-full min-h-[480px] flex-1 flex flex-col items-center justify-center p-6 relative select-none">
      <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-[#5865F2]/15 border border-[#5865F2]/30 flex items-center justify-center mb-4 text-[#5865F2] shadow-xl shadow-[#5865F2]/10 relative">
          <Tv className="w-7 h-7 stroke-[2]" />
          <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#0e1017] animate-pulse" />
        </div>

        <span className="text-[11px] font-bold tracking-widest text-[#808cf7] uppercase mb-1.5 flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
          Transmissão disponível
        </span>

        {/* Streamer name tag */}
        <div className="flex items-center gap-2 bg-[#141722] border border-[#232738] rounded-full px-3 py-1 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold text-white">{streamerName}</span>
          <span className="text-[10px] text-gray-500">está compartilhando a tela</span>
        </div>

        <h2 className="text-xl font-bold text-white mb-2 tracking-tight">
          {title || 'Uma transmissão está ao vivo'}
        </h2>

        <p className="text-xs text-gray-400 leading-relaxed max-w-sm mb-6">
          O vídeo só começa a carregar depois que você clicar em assistir.
        </p>

        <button
          id="btn-watch-stream"
          onClick={onWatch}
          className="w-full max-w-xs flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752c4] active:scale-[0.98] text-white px-5 py-3 rounded-xl text-xs font-bold shadow-lg shadow-[#5865F2]/30 transition-all cursor-pointer"
        >
          <Eye className="w-4 h-4" />
          <span>Assistir compartilhamento</span>
        </button>
      </div>
    </div>
  );
};
