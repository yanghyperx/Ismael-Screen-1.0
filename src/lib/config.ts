export const VPS_DOMAIN = 'ismael-bot.squareweb.app';
export const VPS_BASE_URL = 'https://ismael-bot.squareweb.app';

export function getShareUrl(roomId: string): string {
  if (!roomId) return VPS_BASE_URL;
  return `${VPS_BASE_URL}/r/${roomId}`;
}
