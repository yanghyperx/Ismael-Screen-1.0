import React, { useState } from 'react';
import { X, ExternalLink, Copy, Check, Tv, Play, Layers } from 'lucide-react';
import { getShareUrl } from '../lib/config';

interface DualTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
}

export const DualTestModal: React.FC<DualTestModalProps> = ({
  isOpen,
  onClose,
  roomId,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const roomUrl = getShareUrl(roomId);

  const handleCopy = () => {
    navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenNewTab = () => {
    window.open(roomUrl, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#141722] border border-[#2b3145] w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-5 text-white">
        <div className="flex items-center justify-between border-b border-[#232736] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Teste Multi-Usuário / Espectador</h3>
              <p className="text-xs text-gray-400">Teste transmissão e visualização em tempo real</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#232736] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3.5 text-xs text-gray-300">
          <p className="leading-relaxed">
            Você pode testar a experiência de assistir abrindo esta mesma sala em uma nova aba ou janela anônima do navegador.
          </p>

          <div className="p-3 bg-[#181b26] border border-[#2b3145] rounded-xl flex items-center justify-between gap-2">
            <span className="font-mono text-cyan-300 truncate">{roomUrl}</span>
            <button
              onClick={handleCopy}
              className="p-1.5 bg-[#232736] hover:bg-[#2e344a] rounded-lg text-gray-200 transition-colors shrink-0 cursor-pointer"
              title="Copiar link"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              onClick={handleOpenNewTab}
              className="flex-1 py-2.5 px-4 bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Abrir Aba Espectador</span>
            </button>
            <button
              onClick={onClose}
              className="py-2.5 px-4 bg-[#232736] hover:bg-[#2c3247] text-gray-300 hover:text-white font-semibold rounded-xl transition-all cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
