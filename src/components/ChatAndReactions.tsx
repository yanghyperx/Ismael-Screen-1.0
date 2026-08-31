import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Smile, 
  Sparkles, 
  MessageSquare, 
  Flame, 
  Heart, 
  Crown, 
  Gamepad2, 
  Rocket, 
  PartyPopper 
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ChatMessage, UserInfo } from '../types';

interface ChatAndReactionsProps {
  roomId: string;
  currentUser: UserInfo;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onSendReaction: (emoji: string) => void;
}

const QUICK_EMOJIS = ['🔥', '❤️', '👏', '🚀', '🎮', '👑', '🎉', '💯'];

export const ChatAndReactions: React.FC<ChatAndReactionsProps> = ({
  roomId,
  currentUser,
  messages,
  onSendMessage,
  onSendReaction,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleTriggerReaction = (emoji: string) => {
    onSendReaction(emoji);

    // Fire subtle confetti burst
    try {
      confetti({
        particleCount: 20,
        spread: 60,
        origin: { y: 0.85, x: 0.8 },
        colors: ['#5865F2', '#eb459e', '#57F287', '#FEE75C'],
      });
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#11131a] border border-[#232736] rounded-2xl overflow-hidden shadow-xl">
      {/* Chat Header */}
      <div className="px-4 py-3 border-b border-[#232736] flex items-center justify-between bg-[#141722]">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#5865F2]" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">Chat Ao Vivo</span>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar text-xs">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 py-8 space-y-2">
            <Sparkles className="w-6 h-6 text-gray-600" />
            <p className="text-xs font-medium">Nenhuma mensagem ainda.</p>
            <p className="text-[11px] text-gray-600">Envie uma mensagem ou reação para interagir!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUser.id;
            return (
              <div key={msg.id} className="flex flex-col space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={`font-semibold ${isMe ? 'text-[#808cf7]' : 'text-gray-300'}`}>
                    {msg.senderName}
                  </span>
                  {isMe && (
                    <span className="text-[9px] bg-[#5865F2]/20 text-[#5865F2] px-1 py-0.2 rounded font-bold">
                      Você
                    </span>
                  )}
                  <span className="text-[10px] text-gray-600">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-gray-200 bg-[#181b26] p-2.5 rounded-xl rounded-tl-none border border-[#262b3d] leading-relaxed break-words">
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Reaction Bar */}
      <div className="px-3 py-2 bg-[#141722] border-t border-[#232736] flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
        <span className="text-[11px] font-semibold text-gray-400 shrink-0 mr-1">Reações:</span>
        <div className="flex items-center gap-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleTriggerReaction(emoji)}
              className="p-1.5 hover:bg-[#232736] rounded-lg text-base transition-transform active:scale-125 cursor-pointer"
              title={`Reagir com ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Message Input Box */}
      <form onSubmit={handleSubmit} className="p-3 bg-[#11131a] border-t border-[#232736] flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Enviar mensagem no chat..."
          className="flex-1 bg-[#181b26] border border-[#2b3145] focus:border-[#5865F2] rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-2.5 bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-40 disabled:hover:bg-[#5865F2] text-white rounded-xl transition-all cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
