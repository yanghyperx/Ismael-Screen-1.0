import { DiscordSDK } from '@discord/embedded-app-sdk';

// Check if running inside Discord Activity iframe
export function isDiscordActivity(): boolean {
  if (typeof window === 'undefined') return false;
  const urlParams = new URLSearchParams(window.location.search);
  const hostname = window.location.hostname;
  return (
    urlParams.has('frame_id') ||
    urlParams.has('instance_id') ||
    urlParams.has('channel_id') ||
    hostname.includes('discordsays.com') ||
    window.location.search.includes('discord') ||
    (window.self !== window.top && window.location.ancestorOrigins?.[0]?.includes('discord'))
  );
}

// Extract Discord Client ID
export function getDiscordClientId(): string {
  if (typeof window === 'undefined') return '';
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('client_id')) return urlParams.get('client_id')!;
  if (urlParams.get('application_id')) return urlParams.get('application_id')!;
  
  // Check hostname format: <app-id>.discordsays.com
  const match = window.location.hostname.match(/^([0-9]+)\.discordsays\.com/);
  if (match && match[1]) return match[1];

  return '';
}

let discordSdkInstance: DiscordSDK | null = null;
let isReady = false;

export async function getDiscordSdk(): Promise<DiscordSDK | null> {
  if (!isDiscordActivity()) return null;
  if (discordSdkInstance && isReady) return discordSdkInstance;

  try {
    const clientId = getDiscordClientId();
    if (!clientId) {
      return null;
    }
    
    discordSdkInstance = new DiscordSDK(clientId);
    
    // Safety timeout so ready() NEVER hangs the thread
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 600));
    const readyPromise = discordSdkInstance.ready().then(() => discordSdkInstance);
    
    const result = await Promise.race([readyPromise, timeoutPromise]);
    if (result) {
      isReady = true;
      return discordSdkInstance;
    }
    return discordSdkInstance;
  } catch (err) {
    console.warn('[Discord SDK] Non-blocking init warning:', err);
    return null;
  }
}

/**
 * Opens an external browser URL using official Discord SDK or browser link
 */
export async function openExternalShareLink(url: string): Promise<boolean> {
  if (isDiscordActivity()) {
    try {
      const sdk = await getDiscordSdk();
      if (sdk && typeof sdk.commands?.openExternalLink === 'function') {
        await sdk.commands.openExternalLink({ url });
        return true;
      }
    } catch (err) {
      console.warn('[Discord SDK] openExternalLink fallback:', err);
    }
  }

  // Attempt window.open
  try {
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (newWindow) return true;
  } catch (e) {
    // Popup might be blocked
  }

  return false;
}

