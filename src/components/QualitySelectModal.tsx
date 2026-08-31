import React, { useState } from 'react';
import { 
  Monitor, 
  X, 
  Volume2, 
  Mic, 
  Zap, 
  Check, 
  Sliders,
  Tv,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import { ResolutionPreset, FPSPreset, StreamQualityConfig } from '../types';

interface QualitySelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: StreamQualityConfig) => void;
  isStarting?: boolean;
}

export const QualitySelectModal: React.FC<QualitySelectModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isStarting = false,
}) => {
  const [resolution, setResolution] = useState<ResolutionPreset>('1080p');
  const [fps, setFps] = useState<FPSPreset>(60);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMicrophone, setIncludeMicrophone] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const bitrateKbps = 
      resolution === '4k' ? 14000 : 
      resolution === '1440p' ? 9000 : 
      resolution === '1080p' ? 6000 : 3500;

    onConfirm({
      resolution,
      fps,
      includeSystemAudio,
      includeMicrophone,
      enableWebcamPip: false,
      bitrateKbps,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-md bg-[#0e1017] border border-[#212534] rounded-2xl p-6 shadow-2xl space-y-5 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1c202d] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#5865F2]/20 border border-[#5865F2]/40 flex items-center justify-center text-[#808cf7]">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Configuração da Transmissão</h3>
              <p className="text-[11px] text-gray-400">Escolha a qualidade antes de selecionar a tela</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#1c202d] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quality Configuration Options */}
        <div className="space-y-4">
          {/* Resolution Section */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-300 flex items-center justify-between">
              <span>Resolução de Vídeo</span>
              <span className="text-[10px] text-[#808cf7] font-mono">
                {resolution === '4k' ? '3840x2160' : resolution === '1440p' ? '2560x1440' : resolution === '1080p' ? '1920x1080' : '1280x720'}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: '720p', label: '720p (HD)', desc: 'Menor consumo de rede' },
                { id: '1080p', label: '1080p (FHD)', desc: 'Recomendado / Nítido' },
                { id: '1440p', label: '1440p (2K)', desc: 'Alta definição' },
                { id: '4k', label: '4K (Ultra HD)', desc: 'Máxima nitidez' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setResolution(item.id as ResolutionPreset)}
                  className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                    resolution === item.id
                      ? 'bg-[#5865F2]/15 border-[#5865F2] text-white shadow-md'
                      : 'bg-[#131620] border-[#202534] text-gray-400 hover:text-gray-200 hover:border-[#2f364a]'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold">{item.label}</span>
                    {resolution === item.id && <Check className="w-3.5 h-3.5 text-[#808cf7]" />}
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Framerate (FPS) */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-300">Taxa de Quadros (FPS)</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 30, label: '30 FPS', desc: 'Apresentações & textos' },
                { id: 60, label: '60 FPS', desc: 'Fluido para jogos & vídeos' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFps(item.id as FPSPreset)}
                  className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                    fps === item.id
                      ? 'bg-[#5865F2]/15 border-[#5865F2] text-white shadow-md'
                      : 'bg-[#131620] border-[#202534] text-gray-400 hover:text-gray-200 hover:border-[#2f364a]'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold">{item.label}</span>
                    {fps === item.id && <Check className="w-3.5 h-3.5 text-[#808cf7]" />}
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Audio Preferences */}
          <div className="pt-2 border-t border-[#1c202d] space-y-2">
            <label className="text-xs font-semibold text-gray-300">Áudio da Transmissão</label>
            
            <div className="space-y-2">
              <label className="flex items-center justify-between p-2.5 rounded-xl bg-[#131620] border border-[#202534] hover:border-[#2f364a] cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <Volume2 className="w-4 h-4 text-[#808cf7]" />
                  <div>
                    <div className="text-xs font-semibold text-white">Áudio do Sistema / Jogo</div>
                    <div className="text-[10px] text-gray-400">Transmitir som do jogo, vídeo ou navegador</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeSystemAudio}
                  onChange={(e) => setIncludeSystemAudio(e.target.checked)}
                  className="w-4 h-4 rounded bg-[#1c202d] border-[#2f364a] text-[#5865F2] focus:ring-0 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-xl bg-[#131620] border border-[#202534] hover:border-[#2f364a] cursor-pointer transition-colors">
                <div className="flex items-center gap-2.5">
                  <Mic className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs font-semibold text-white">Microfone</div>
                    <div className="text-[10px] text-gray-400">Incluir sua voz junto com o áudio</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeMicrophone}
                  onChange={(e) => setIncludeMicrophone(e.target.checked)}
                  className="w-4 h-4 rounded bg-[#1c202d] border-[#2f364a] text-[#5865F2] focus:ring-0 cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Confirm & Trigger Display Media */}
          <div className="pt-2">
            <button
              id="btn-confirm-stream-quality"
              onClick={handleConfirm}
              disabled={isStarting}
              className="w-full py-3 px-4 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] active:scale-[0.98] text-white font-bold text-xs shadow-lg shadow-[#5865F2]/25 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {isStarting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Iniciando seletor de tela...</span>
                </>
              ) : (
                <>
                  <Monitor className="w-4 h-4" />
                  <span>Selecionar Tela / Janela</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
