import React, { useState } from 'react';
import {
  Monitor,
  Sliders,
  Volume2,
  Mic,
  Radio,
  Tv,
  MousePointerClick
} from 'lucide-react';
import { ResolutionPreset, FPSPreset, StreamQualityConfig } from '../types';
import { isDiscordActivity } from '../lib/discord';

interface EmptyStreamStageProps {
  roomId: string;
  onStartStream: (config: StreamQualityConfig) => void;
  onRequestQualityModal?: () => void;
  isStarting: boolean;
}

export const EmptyStreamStage: React.FC<EmptyStreamStageProps> = ({
  roomId,
  onStartStream,
  onRequestQualityModal,
  isStarting,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [resolution, setResolution] = useState<ResolutionPreset>('1080p');
  const [fps, setFps] = useState<FPSPreset>(60);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMicrophone, setIncludeMicrophone] = useState(false);

  const isDiscord = isDiscordActivity();

  const handleStart = () => {
    if (onRequestQualityModal) {
      onRequestQualityModal();
      return;
    }

    onStartStream({
      resolution,
      fps,
      includeSystemAudio,
      includeMicrophone,
      enableWebcamPip: false,
      bitrateKbps: resolution === '4k' ? 12000 : resolution === '1440p' ? 8000 : resolution === '1080p' ? 6000 : 3500,
    });
  };

  return (
    <div className="w-full h-full min-h-[480px] flex-1 flex flex-col items-center justify-center p-6 relative select-none">
      {/* Center Stage State */}
      <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto">
        {/* Animated Radio / Monitor Icon */}
        <div className="w-16 h-16 rounded-2xl bg-[#5865F2]/15 border border-[#5865F2]/30 flex items-center justify-center mb-4 text-[#5865F2] shadow-xl shadow-[#5865F2]/10 relative">
          <Tv className="w-7 h-7 stroke-[2]" />
          <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#0e1017] animate-pulse" />
        </div>

        {/* Status Badge */}
        <span className="text-[11px] font-bold tracking-widest text-[#808cf7] uppercase mb-1.5 flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
          {isDiscord ? 'Activity do Discord Conectada' : 'Pronto para Transmitir'}
        </span>

        {/* Main Title */}
        <h2 className="text-xl font-bold text-white mb-2 tracking-tight">
          {isDiscord ? 'Nenhuma transmissão ativa' : 'Compartilhe sua tela em 60 FPS'}
        </h2>

        {/* Subtitle instructions */}
        <p className="text-xs text-gray-400 leading-relaxed max-w-sm mb-6">
          {isDiscord ? (
            <>
              Clique em <strong>Compartilhar tela</strong> no topo para começar — a captura abre em uma aba do navegador e a transmissão aparece aqui automaticamente.
            </>
          ) : (
            'Transmita seus jogos, vídeos ou abas em alta definição diretamente para a sala do Discord.'
          )}
        </p>

        {/* Primary Action Buttons */}
        <div className="flex flex-col items-center gap-3 w-full max-w-xs">
          {isDiscord ? (
            <div className="w-full flex items-center justify-center gap-2 bg-[#141622] border border-[#202538] text-gray-400 px-4 py-2.5 rounded-xl text-xs font-medium">
              <MousePointerClick className="w-3.5 h-3.5 text-[#808cf7] shrink-0" />
              <span>Use o botão "Compartilhar tela" no topo da tela</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 w-full">
              <button
                id="btn-stage-start-stream"
                onClick={handleStart}
                disabled={isStarting}
                className="flex-1 flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752c4] active:scale-[0.98] text-white px-4 py-3 rounded-xl text-xs font-bold shadow-lg shadow-[#5865F2]/25 transition-all cursor-pointer disabled:opacity-50"
              >
                <Monitor className="w-4 h-4" />
                <span>{isStarting ? 'Iniciando captura...' : 'Compartilhar tela agora'}</span>
              </button>

              <button
                id="btn-toggle-stream-settings"
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center justify-center p-3 bg-[#12141c] hover:bg-[#1b1f2e] border border-[#1f2330] text-gray-400 hover:text-gray-200 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                title="Configurações de Qualidade"
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Optional Expandable Quality Settings (for standalone browser) */}
        {!isDiscord && showSettings && (
          <div className="w-full mt-4 bg-[#12141c] border border-[#1f2330] rounded-xl p-4 text-left space-y-3 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#1b1e2a] pb-2">
              <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#5865F2]" /> Qualidade da Transmissão
              </span>
              <span className="text-[10px] text-gray-500 font-mono">0ms Latência</span>
            </div>

            {/* Resolution Selector */}
            <div className="space-y-1">
              <label className="text-[11px] text-gray-400 font-medium">Resolução:</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['720p', '1080p', '1440p', '4k'] as ResolutionPreset[]).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setResolution(res)}
                    className={`py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      resolution === res
                        ? 'bg-[#5865F2] border-[#5865F2] text-white'
                        : 'bg-[#181a24] border-[#222533] text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* FPS Selector */}
            <div className="space-y-1">
              <label className="text-[11px] text-gray-400 font-medium">Taxa de Quadros (FPS):</label>
              <div className="grid grid-cols-2 gap-1.5">
                {([30, 60] as FPSPreset[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFps(f)}
                    className={`py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      fps === f
                        ? 'bg-[#5865F2] border-[#5865F2] text-white'
                        : 'bg-[#181a24] border-[#222533] text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {f} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Audio Toggles */}
            <div className="flex items-center justify-between pt-1 text-xs text-gray-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSystemAudio}
                  onChange={(e) => setIncludeSystemAudio(e.target.checked)}
                  className="rounded bg-[#181a24] border-[#2b3044] text-[#5865F2] focus:ring-0"
                />
                <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                <span>Áudio do Sistema</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMicrophone}
                  onChange={(e) => setIncludeMicrophone(e.target.checked)}
                  className="rounded bg-[#181a24] border-[#2b3044] text-[#5865F2] focus:ring-0"
                />
                <Mic className="w-3.5 h-3.5 text-gray-400" />
                <span>Microfone</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


