import React from 'react';
import { X, Sparkles, CheckCircle2, Code2, ExternalLink, Terminal, ShieldCheck } from 'lucide-react';
import { VPS_BASE_URL } from '../lib/config';

interface DiscordActivityInfoProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
}

export const DiscordActivityInfo: React.FC<DiscordActivityInfoProps> = ({
  isOpen,
  onClose,
  roomId,
}) => {
  if (!isOpen) return null;

  const appUrl = VPS_BASE_URL;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#141722] border border-[#2b3145] w-full max-w-2xl rounded-2xl p-6 shadow-2xl space-y-5 text-white max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#232736] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#5865F2]/20 border border-[#5865F2]/40 text-[#808cf7]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Integração Discord Activity & Web</h3>
              <p className="text-xs text-gray-400">Como executar esta aplicação dentro de canais de voz do Discord</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#232736] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps */}
        <div className="space-y-4 text-xs">
          <div className="p-4 bg-[#181b26] border border-[#2b3145] rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#808cf7]">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              1. Zero Lobby & Acesso Imediato
            </div>
            <p className="text-gray-300 leading-relaxed">
              Diferente de versões antigas, esta aplicação não possui tela de espera ou lobby desnecessário. Ao abrir o link ou a atividade no Discord, o usuário entra imediatamente na sala ativa (<span className="font-mono text-cyan-300">{roomId}</span>).
            </p>
          </div>

          <div className="p-4 bg-[#181b26] border border-[#2b3145] rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#808cf7]">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              2. Configurar no Discord Developer Portal
            </div>
            <p className="text-gray-300 leading-relaxed">
              Para registrar como uma <strong>Atividade Oficial do Discord</strong>:
            </p>
            <ol className="list-decimal list-inside space-y-1.5 text-gray-300 pl-1">
              <li>Acesse <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="text-[#808cf7] underline">Discord Developer Portal</a> e crie ou selecione sua aplicação.</li>
              <li>Na aba <strong>Activities</strong>, ative a opção de Atividade.</li>
              <li>Defina a <strong>URL Mapping</strong> para: <span className="font-mono bg-black/40 px-2 py-0.5 rounded text-white">{appUrl}</span></li>
            </ol>
          </div>

          <div className="p-4 bg-[#181b26] border border-[#2b3145] rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#808cf7]">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              3. Correção de Auto-Visualização (Fix do Loop Infinito)
            </div>
            <p className="text-gray-300 leading-relaxed">
              O streamer agora visualiza a própria transmissão diretamente através do stream local (<span className="font-mono text-emerald-400">Direct Local Feed</span>), sem criar conexões peer duplicadas consigo mesmo que causavam o carregamento infinito.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
