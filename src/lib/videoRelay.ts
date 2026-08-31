/**
 * Real-time video delivery WITHOUT WebRTC.
 *
 * Discord Activities only allow WebSocket traffic (no RTCPeerConnection) —
 * see docs.discord.com/developers/activities/development-guides/networking.
 * WebCodecs, however, is NOT blocked inside the Activity iframe. So instead
 * of a peer connection, the broadcaster encodes raw frames with
 * `VideoEncoder` (no container — every chunk is sent the instant it's ready)
 * and viewers decode them with `VideoDecoder`, drawing each frame onto a
 * <canvas>. The chunks travel as plain binary over the existing Socket.IO
 * connection, which is real WebSocket under the hood and already proven to
 * pass through Discord's proxy fine.
 *
 * This mirrors the approach used by github.com/Jc007zZ/discord-screen
 * (~40ms latency, WebCodecs + WebSocket, no WebRTC).
 */

export const RELAY_CODEC = 'vp8';

/**
 * Codec/acceleration ladder tried in order when starting a broadcast. Real
 * WebRTC screen-share barely dents CPU/GPU because it almost always lands
 * on a hardware H.264 encoder; this relay was previously hardcoded to VP8
 * in software (see the removed comment below for why), which is why it hit
 * the CPU so much harder than the WebRTC path viewers were used to. Try
 * hardware H.264 first now and only fall back to software if it's
 * genuinely unavailable.
 *
 * Known Chromium quirk this ladder exists to survive: for some
 * codec/hardware combinations, `configure()` returns successfully but the
 * codec silently closes itself moments later (surfacing only via the async
 * `error` callback), without ever producing a frame. `startWebCodecsBroadcast`
 * treats an error inside the short "probation" window after configuring as
 * "this attempt doesn't actually work here" and moves to the next one
 * automatically, instead of that meaning the whole broadcast dies.
 */
const CODEC_ATTEMPTS: { codec: string; hardwareAcceleration: HardwareAcceleration }[] = [
  { codec: 'avc1.42001f', hardwareAcceleration: 'prefer-hardware' }, // H.264 baseline, GPU-accelerated — what WebRTC normally uses
  { codec: 'avc1.42001f', hardwareAcceleration: 'no-preference' },   // H.264, let the browser pick
  { codec: RELAY_CODEC, hardwareAcceleration: 'no-preference' },     // VP8 software — universally supported, proven reliable fallback
];

export interface EncodedVideoPacket {
  type: 'key' | 'delta';
  timestamp: number;
  data: ArrayBuffer;
  /**
   * Monotonically increasing counter, one per chunk emitted by the
   * broadcaster. Lets a viewer detect that a chunk was silently dropped by
   * the volatile relay (see server.ts) the instant the next packet arrives,
   * instead of only finding out when the decoder eventually errors (or
   * worse, doesn't error and just renders corrupted macroblocks).
   */
  seq: number;
  /**
   * Which codec (from CODEC_ATTEMPTS) actually produced this chunk. The
   * broadcaster can fall back to a different codec mid-stream (see
   * CODEC_ATTEMPTS above), so packets are self-describing rather than
   * assuming a single fixed codec for the whole broadcast — the viewer
   * reconfigures its decoder to match whenever this changes.
   */
  codec: string;
}

export interface BroadcastHandle {
  /** Force the next encoded frame to be a full keyframe. */
  requestKeyframe: () => void;
  stop: () => void;
}

/**
 * Encodes a screen-share MediaStream with WebCodecs and hands each chunk to
 * `onChunk`. Must run in a normal (non-iframe) tab, since it needs the
 * MediaStream from getDisplayMedia — that part hasn't changed.
 *
 * Requires Chrome/Edge/Brave/Opera (MediaStreamTrackProcessor + WebCodecs).
 */
export function startWebCodecsBroadcast(
  stream: MediaStream,
  onChunk: (packet: EncodedVideoPacket) => void,
  options: { bitrate?: number; fps?: number; onFatalError?: () => void } = {}
): BroadcastHandle {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('[VideoRelay] No video track in stream to broadcast.');

  // NOTE: do NOT override contentHint here. captureDisplayMedia() (webrtc.ts)
  // already sets it to 'motion' for this same track, which is the correct
  // hint for gameplay footage — it tells the encoder to prioritize temporal
  // (frame-to-frame) compression appropriate for a moving scene. Setting it
  // to 'text' here was overriding that with a hint meant for static
  // UI/text content, which biases the encoder's heuristics away from
  // motion video and made busy, high-detail scenes (loading screens,
  // particle effects, fast camera motion) look blockier than they should.

  const settings = track.getSettings();
  const nativeWidth = settings.width ?? 1280;
  const nativeHeight = settings.height ?? 720;

  // Capped independently of the real capture/WebRTC quality: this relay only
  // exists to feed Discord Activity viewers over a software-encoded path,
  // and encoding at the full native capture resolution (often 1080p+) was
  // a big chunk of the "streaming eats my game's FPS" problem. VideoEncoder
  // automatically downscales whatever frame it's given to match the
  // configured width/height, so we don't need to touch the real capture at
  // all — just ask for a smaller coded size here.
  const RELAY_MAX_DIMENSION = 960;
  const downscale = Math.min(1, RELAY_MAX_DIMENSION / Math.max(nativeWidth, nativeHeight));
  // Most encoders require even dimensions.
  const width = Math.max(2, Math.round((nativeWidth * downscale) / 2) * 2);
  const height = Math.max(2, Math.round((nativeHeight * downscale) / 2) * 2);

  // Lowered from 24 -> 20: still smooth for a screen-share, noticeably
  // lighter on CPU for the software encoder running alongside a game.
  const fps = options.fps ?? Math.min(20, settings.frameRate ?? 20);

  let forceKeyNext = true;
  let stopped = false;
  let chunksSent = 0;
  let seq = 0;

  // Bitrate: 1.1 Mbps (the old fixed value) was tuned for mostly-static
  // desktop/UI sharing and falls apart on busy, high-motion game footage
  // (particle effects, fast camera pans, detailed textures) — the encoder
  // has to quantize hard to hit that budget, which is exactly the
  // block/smear noise viewers were seeing. Scale the target with the actual
  // pixel throughput (width * height * fps) instead of a flat number, with
  // a floor high enough for busy content at the relay's max resolution.
  const pixelsPerSecond = width * height * fps;
  // ~0.09 bits/pixel is a reasonable target for realtime encoding of
  // complex, high-motion screen content; native 1080p60 desktop-share
  // tools land in a similar ballpark at these resolutions.
  const scaledBitrate = Math.round(pixelsPerSecond * 0.09);
  const defaultBitrate = Math.min(4_000_000, Math.max(2_500_000, scaledBitrate));
  const targetBitrate = options.bitrate ?? defaultBitrate;

  let encoder!: VideoEncoder;
  let currentCodec = '';
  let attemptIndex = 0;
  // Non-null while the current codec attempt hasn't proven itself yet (see
  // CODEC_ATTEMPTS comment above for the failure mode this guards against).
  let probationTimer: ReturnType<typeof setTimeout> | null = null;

  const makeEncoder = (): VideoEncoder =>
    new VideoEncoder({
      output: (chunk) => {
        const buf = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buf);
        onChunk({
          type: chunk.type === 'key' ? 'key' : 'delta',
          timestamp: chunk.timestamp,
          data: buf,
          seq: seq++,
          codec: currentCodec,
        });
        chunksSent += 1;
        if (chunksSent === 1) {
          console.log(`[VideoRelay] First encoded chunk produced and sent (codec=${currentCodec}) — broadcast is live.`);
        }
        if (probationTimer !== null) {
          // A real chunk came out, so this attempt clearly works — no need
          // to wait out the rest of the probation window.
          clearTimeout(probationTimer);
          probationTimer = null;
        }
      },
      error: (err) => {
        // If we're still inside the probation window for this attempt,
        // this is the known "configure() succeeds, then closes moments
        // later without ever producing a frame" failure mode — try the
        // next codec in the ladder instead of killing the whole broadcast.
        if (probationTimer !== null) {
          clearTimeout(probationTimer);
          probationTimer = null;
          console.warn(`[VideoRelay] Codec attempt "${currentCodec}" failed during probation, falling back:`, err);
          attemptIndex += 1;
          if (attemptIndex < CODEC_ATTEMPTS.length) {
            tryNextAttempt();
            return;
          }
        }
        console.error('[VideoRelay] Encoder error (broadcast will stop producing frames):', err);
        stopped = true;
        options.onFatalError?.();
      },
    });

  const tryNextAttempt = () => {
    const attempt = CODEC_ATTEMPTS[attemptIndex];
    currentCodec = attempt.codec;
    encoder = makeEncoder();
    const config: VideoEncoderConfig = {
      codec: attempt.codec,
      hardwareAcceleration: attempt.hardwareAcceleration,
      width,
      height,
      bitrate: targetBitrate,
      bitrateMode: 'variable', // let the encoder spend more bits on busy frames instead of quantizing everything to a flat cap
      framerate: fps,
      latencyMode: 'realtime', // don't buffer frames to compress better — emit immediately
    };
    try {
      encoder.configure(config);
      console.log(`[VideoRelay] Encoder configured OK (codec=${attempt.codec}, hardwareAcceleration=${attempt.hardwareAcceleration}, bitrate=${config.bitrate} bps).`);
      forceKeyNext = true; // always start fresh right after a (re)configure
      probationTimer = setTimeout(() => {
        probationTimer = null;
      }, 1200);
    } catch (err) {
      console.warn(`[VideoRelay] Encoder rejected codec "${attempt.codec}" (hardwareAcceleration=${attempt.hardwareAcceleration}):`, err);
      try {
        encoder.close();
      } catch {
        // already closed/closing
      }
      attemptIndex += 1;
      if (attemptIndex < CODEC_ATTEMPTS.length) {
        tryNextAttempt();
      } else {
        throw new Error(`[VideoRelay] No supported VideoEncoder configuration found: ${err}`);
      }
    }
  };

  console.log(`[VideoRelay] Starting broadcast: relay encode ${width}x${height}@${fps}fps (captured at ${nativeWidth}x${nativeHeight}).`);
  tryNextAttempt();

  // MediaStreamTrackProcessor isn't in every TS DOM lib version yet.
  const Processor = (window as any).MediaStreamTrackProcessor;
  if (!Processor) {
    encoder.close();
    throw new Error('[VideoRelay] MediaStreamTrackProcessor not supported in this browser (use Chrome/Edge).');
  }
  const processor = new Processor({ track });
  const reader: ReadableStreamDefaultReader<any> = processor.readable.getReader();

  // Self-healing against packet loss: video-chunk is relayed with
  // socket.volatile (see server.ts) so a congested viewer socket just drops
  // a chunk instead of building up latency. But VP8 delta frames reference
  // the previous frame — losing even one delta corrupts everything after it
  // into the kind of colorful noise/artifacts you'd see on screen, and
  // previously that only got fixed by a viewer manually reconnecting (which
  // asks for one fresh keyframe). Forcing a keyframe every few seconds
  // bounds how long any corruption can last, without anyone having to do
  // anything.
  const KEYFRAME_INTERVAL_MS = 3000;
  const keyframeInterval = setInterval(() => {
    forceKeyNext = true;
  }, KEYFRAME_INTERVAL_MS);

  // Pace frames to the configured target fps ourselves. getDisplayMedia
  // often delivers frames from MediaStreamTrackProcessor at the display's
  // native capture rate (30/60fps+) regardless of the `frameRate` we asked
  // for, and previously every single one of those was handed to encode()
  // — only backing off once encodeQueueSize was already > 2. At the higher
  // bitrate now needed to avoid block noise (see buildIceConfig/bitrate
  // comment above), the software VP8 encoder can't keep up with 60 calls/
  // sec, so it stayed permanently backlogged and dropped almost
  // everything, which is what showed up as the stream crawling at ~2fps.
  // Throttling here to one frame roughly every `frameIntervalMs` keeps the
  // encoder's real workload matched to what it was actually configured
  // (and sized) for.
  const frameIntervalMs = 1000 / fps;
  let lastEncodedAt = 0;

  (async () => {
    while (!stopped) {
      let result;
      try {
        result = await reader.read();
      } catch {
        break;
      }
      const { done, value: frame } = result;
      if (done) break;
      if (!frame) continue;

      // The encoder can still close itself asynchronously after a device
      // error, a lost GPU context, etc. Once that happens every further
      // encode() call throws — stop cleanly instead of spamming the console
      // and burning CPU on frames that can never be encoded, and tell the
      // caller so it can tear this broadcast down and start a fresh one.
      if (encoder.state === 'closed') {
        frame.close();
        console.error('[VideoRelay] Encoder closed unexpectedly — stopping broadcast loop.');
        stopped = true;
        options.onFatalError?.();
        break;
      }

      const now = performance.now();
      if (now - lastEncodedAt < frameIntervalMs) {
        // Arrived faster than our target cadence — drop it here, before it
        // ever reaches the encoder, instead of relying on the encoder's own
        // backlog check to notice it's overwhelmed.
        frame.close();
        continue;
      }

      try {
        if (encoder.encodeQueueSize > 2) {
          // The encoder is falling behind for some other reason (CPU spike,
          // a big keyframe still being written out) — drop this frame too
          // rather than build up a backlog that becomes permanent latency.
          continue;
        }
        encoder.encode(frame, { keyFrame: forceKeyNext });
        forceKeyNext = false;
        lastEncodedAt = now;
      } catch (err) {
        console.warn('[VideoRelay] encode() failed for a frame, skipping:', err);
      } finally {
        frame.close(); // VideoFrame holds GPU memory — must always be closed
      }
    }
  })();

  return {
    requestKeyframe: () => {
      forceKeyNext = true;
    },
    stop: () => {
      stopped = true;
      clearInterval(keyframeInterval);
      reader.cancel().catch(() => {});
      if (encoder.state !== 'closed') {
        try {
          encoder.close();
        } catch {
          // already closing/closed
        }
      }
    },
  };
}

export interface ViewerHandle {
  receive: (packet: EncodedVideoPacket) => void;
  /** Switch how frames fit the canvas without needing a new decoder. */
  setFit: (fit: 'contain' | 'cover') => void;
  stop: () => void;
}

export interface ViewerOptions {
  fit?: 'contain' | 'cover';
  /** Fired once, the first time a real decoded frame is actually drawn. */
  onFirstFrame?: () => void;
  /**
   * Fired the instant a gap in the packet sequence is detected (a chunk was
   * dropped by the volatile relay). The caller should ask the streamer for
   * a fresh keyframe right away (socket.emit('need-keyframe', ...)) instead
   * of waiting for the streamer's next scheduled one — that's the
   * difference between a corrupted frame lasting one frame vs. up to a few
   * seconds.
   */
  onPacketLoss?: () => void;
}

/**
 * Decodes packets from startWebCodecsBroadcast and draws each frame onto
 * `canvas`. Safe to run inside the Discord Activity iframe.
 *
 * The canvas's backing-store pixel size is kept in sync with how big it's
 * actually rendered on screen (via ResizeObserver) rather than the source
 * video's native resolution — using the source resolution directly made the
 * canvas bigger than its flex/aspect-ratio container could ever shrink it
 * to (replaced elements like <canvas> use their intrinsic width/height for
 * flex min-size purposes, ignoring the "w-full h-full" CSS), which is what
 * caused a stray scrollbar inside the Activity. Aspect ratio (contain vs
 * cover) is computed manually with drawImage's source/dest rectangles
 * instead of relying on the CSS `object-fit` property, since browser
 * support for `object-fit` on <canvas> specifically is inconsistent
 * (notably in some embedded/older Chromium builds like Discord's Activity
 * shell) and was producing a stretched/wrong-proportioned picture.
 */
export function startWebCodecsViewer(canvas: HTMLCanvasElement, options: ViewerOptions = {}): ViewerHandle {
  const ctx = canvas.getContext('2d');
  let waitingForKeyframe = true;
  let stopped = false;
  let fit: 'contain' | 'cover' = options.fit ?? 'contain';
  let firstFrameFired = false;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resizeCanvasToDisplaySize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  };
  resizeCanvasToDisplaySize();

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resizeCanvasToDisplaySize());
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener('resize', resizeCanvasToDisplaySize);
  }

  const drawFrame = (frame: VideoFrame) => {
    if (!ctx) return;
    const cw = canvas.width;
    const ch = canvas.height;
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    if (!cw || !ch || !fw || !fh) return;

    const scale = fit === 'cover' ? Math.max(cw / fw, ch / fh) : Math.min(cw / fw, ch / fh);
    const dw = fw * scale;
    const dh = fh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(frame, 0, 0, fw, fh, dx, dy, dw, dh);

    if (!firstFrameFired) {
      firstFrameFired = true;
      options.onFirstFrame?.();
    }
  };

  let decoder = new VideoDecoder({
    output: (frame) => {
      if (!stopped) {
        drawFrame(frame);
      }
      frame.close();
    },
    error: (err) => {
      console.warn('[VideoRelay] Decoder error, will resync on next keyframe:', err);
      waitingForKeyframe = true;
    },
  });

  let currentDecoderCodec: string | null = null;
  const configureDecoderFor = (codec: string) => {
    if (currentDecoderCodec === codec) return;
    if (decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch {
        // already closing/closed
      }
    }
    decoder = new VideoDecoder({
      output: (frame) => {
        if (!stopped) {
          drawFrame(frame);
        }
        frame.close();
      },
      error: (err) => {
        console.warn('[VideoRelay] Decoder error, will resync on next keyframe:', err);
        waitingForKeyframe = true;
      },
    });
    decoder.configure({ codec, optimizeForLatency: true });
    currentDecoderCodec = codec;
    console.log(`[VideoRelay] Viewer decoder (re)configured for codec=${codec}.`);
  };
  // The broadcaster reports its actual codec on every packet (it can fall
  // back between codecs — see CODEC_ATTEMPTS in startWebCodecsBroadcast),
  // so start with the universal fallback and switch the moment a packet
  // says otherwise, rather than assuming a single fixed codec up front.
  configureDecoderFor(RELAY_CODEC);

  console.log('[VideoRelay] Viewer decoder ready, waiting for first keyframe...');
  let firstPacketLogged = false;
  let lastSeq: number | null = null;

  return {
    receive: (packet) => {
      if (stopped) return;
      if (!firstPacketLogged) {
        firstPacketLogged = true;
        console.log(`[VideoRelay] First packet received from relay (type=${packet.type}, codec=${packet.codec}). If it's "delta" the decoder will wait for a key.`);
      }

      // Detect a dropped chunk the instant it's noticeable, instead of
      // waiting for the decoder to (maybe) error out or for the next
      // scheduled keyframe. Delta frames reference the previous frame, so a
      // gap here is exactly what turns into the color/block noise on
      // screen — resync as soon as we see one.
      if (typeof packet.seq === 'number') {
        if (lastSeq !== null && packet.seq !== lastSeq + 1 && !waitingForKeyframe) {
          console.warn(`[VideoRelay] Packet gap detected (expected seq ${lastSeq + 1}, got ${packet.seq}) — resyncing on next keyframe.`);
          waitingForKeyframe = true;
          options.onPacketLoss?.();
        }
        lastSeq = packet.seq;
      }

      // Can't decode anything meaningful until we've seen a full keyframe —
      // feeding delta frames to a cold decoder just produces errors. This
      // is also the only safe moment to switch decoder codec, since a
      // keyframe never depends on any prior frame.
      if (waitingForKeyframe && packet.type !== 'key') return;
      waitingForKeyframe = false;

      if (packet.codec && packet.codec !== currentDecoderCodec) {
        configureDecoderFor(packet.codec);
      }

      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: packet.type,
            timestamp: packet.timestamp,
            data: packet.data,
          })
        );
      } catch (err) {
        console.warn('[VideoRelay] decode() failed, waiting for next keyframe:', err);
        waitingForKeyframe = true;
      }
    },
    setFit: (f) => {
      fit = f;
    },
    stop: () => {
      stopped = true;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resizeCanvasToDisplaySize);
      if (decoder.state !== 'closed') {
        try {
          decoder.close();
        } catch {
          // already closing/closed
        }
      }
    },
  };
}

/** True if this browser can broadcast (encode) with this module. */
export function canBroadcastWithWebCodecs(): boolean {
  return typeof (window as any).VideoEncoder !== 'undefined' && typeof (window as any).MediaStreamTrackProcessor !== 'undefined';
}

/** True if this browser can watch (decode) with this module. */
export function canViewWithWebCodecs(): boolean {
  return typeof (window as any).VideoDecoder !== 'undefined';
}

/**
 * AUDIO relay — same idea as the video relay above (WebCodecs over the
 * existing Socket.IO/WebSocket connection, since RTCPeerConnection never
 * reaches a viewer inside a Discord Activity). Without this, viewers inside
 * the Activity had NO audio track at all, which is why the volume/mute
 * controls did nothing for them — there was nothing to control.
 */
export const AUDIO_RELAY_CODEC = 'opus';

export interface EncodedAudioPacket {
  timestamp: number;
  data: ArrayBuffer;
  sampleRate: number;
  numberOfChannels: number;
}

export interface AudioBroadcastHandle {
  stop: () => void;
}

/** True if this browser can encode microphone/system audio with WebCodecs. */
export function canBroadcastAudioWithWebCodecs(): boolean {
  return (
    typeof (window as any).AudioEncoder !== 'undefined' &&
    typeof (window as any).MediaStreamTrackProcessor !== 'undefined'
  );
}

/** True if this browser can decode + play WebCodecs audio (generator track). */
export function canViewAudioWithWebCodecs(): boolean {
  return (
    typeof (window as any).AudioDecoder !== 'undefined' &&
    typeof (window as any).MediaStreamTrackGenerator !== 'undefined'
  );
}

/**
 * Encodes the audio track of `stream` (system audio and/or mic, already
 * mixed by captureDisplayMedia) with WebCodecs and hands each chunk to
 * `onChunk`. Returns null if there's no audio track or the browser can't do
 * this — callers should treat that as "no audio relay available" rather
 * than throwing, since video should keep working either way.
 */
export function startWebCodecsAudioBroadcast(
  stream: MediaStream,
  onChunk: (packet: EncodedAudioPacket) => void
): AudioBroadcastHandle | null {
  const track = stream.getAudioTracks()[0];
  if (!track) return null;
  if (!canBroadcastAudioWithWebCodecs()) return null;

  const settings = track.getSettings();
  const sampleRate = settings.sampleRate || 48000;
  const numberOfChannels = settings.channelCount || 2;

  let stopped = false;

  const AudioEncoderCtor = (window as any).AudioEncoder;
  const encoder = new AudioEncoderCtor({
    output: (chunk: any) => {
      const buf = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buf);
      onChunk({ timestamp: chunk.timestamp, data: buf, sampleRate, numberOfChannels });
    },
    error: (err: any) => console.error('[AudioRelay] Encoder error:', err),
  });

  try {
    encoder.configure({
      codec: AUDIO_RELAY_CODEC,
      sampleRate,
      numberOfChannels,
      bitrate: 64000,
    });
  } catch (err) {
    console.warn('[AudioRelay] Could not configure AudioEncoder:', err);
    encoder.close();
    return null;
  }

  const Processor = (window as any).MediaStreamTrackProcessor;
  const processor = new Processor({ track });
  const reader: ReadableStreamDefaultReader<any> = processor.readable.getReader();

  (async () => {
    while (!stopped) {
      let result;
      try {
        result = await reader.read();
      } catch {
        break;
      }
      const { done, value: audioData } = result;
      if (done) break;
      if (!audioData) continue;

      try {
        if (encoder.encodeQueueSize <= 5) {
          encoder.encode(audioData);
        }
      } catch (err) {
        console.warn('[AudioRelay] encode() failed for a chunk, skipping:', err);
      } finally {
        audioData.close();
      }
    }
  })();

  return {
    stop: () => {
      stopped = true;
      reader.cancel().catch(() => {});
      if (encoder.state !== 'closed') {
        try {
          encoder.close();
        } catch {
          // already closing/closed
        }
      }
    },
  };
}

export interface AudioViewerHandle {
  receive: (packet: EncodedAudioPacket) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  stop: () => void;
}

/**
 * Decodes packets from startWebCodecsAudioBroadcast and plays them through a
 * hidden <audio> element (built from a MediaStreamTrackGenerator), so the
 * normal volume/mute controls work exactly like they would for a real
 * <video>/<audio> element. Returns null if the browser can't do this —
 * callers should degrade gracefully (hide/disable the volume UI) rather than
 * show controls that silently do nothing.
 */
export function startWebCodecsAudioViewer(): AudioViewerHandle | null {
  if (!canViewAudioWithWebCodecs()) return null;

  let configured = false;
  let writer: WritableStreamDefaultWriter<any> | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let stopped = false;
  let pendingVolume = 1;
  let pendingMuted = false;

  const AudioDecoderCtor = (window as any).AudioDecoder;
  const decoder = new AudioDecoderCtor({
    output: (audioData: any) => {
      if (stopped || !writer) {
        audioData.close();
        return;
      }
      writer.write(audioData).catch(() => {
        try {
          audioData.close();
        } catch {
          // ignore
        }
      });
    },
    error: (err: any) => console.warn('[AudioRelay] Decoder error:', err),
  });

  const ensureSetup = (sampleRate: number, numberOfChannels: number) => {
    if (configured) return;
    configured = true;
    try {
      decoder.configure({ codec: AUDIO_RELAY_CODEC, sampleRate, numberOfChannels });
      const Generator = (window as any).MediaStreamTrackGenerator;
      const generatorTrack = new Generator({ kind: 'audio' });
      writer = generatorTrack.writable.getWriter();

      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.volume = pendingVolume;
      audioEl.muted = pendingMuted;
      (audioEl as any).srcObject = new MediaStream([generatorTrack]);
      audioEl.play().catch(() => {
        // Autoplay-with-sound can be blocked without a user gesture; the
        // viewer's mute/volume controls (which ARE a user gesture) will
        // trigger another play() attempt implicitly via the volume element.
      });
    } catch (err) {
      console.warn('[AudioRelay] Could not set up audio playback:', err);
    }
  };

  return {
    receive: (packet) => {
      if (stopped) return;
      ensureSetup(packet.sampleRate, packet.numberOfChannels);
      try {
        const EncodedAudioChunkCtor = (window as any).EncodedAudioChunk;
        decoder.decode(
          new EncodedAudioChunkCtor({
            type: 'key',
            timestamp: packet.timestamp,
            data: packet.data,
          })
        );
      } catch (err) {
        console.warn('[AudioRelay] decode() failed for a chunk, skipping:', err);
      }
    },
    setVolume: (v) => {
      pendingVolume = v;
      if (audioEl) audioEl.volume = v;
    },
    setMuted: (m) => {
      pendingMuted = m;
      if (audioEl) {
        audioEl.muted = m;
        if (!m) audioEl.play().catch(() => {});
      }
    },
    stop: () => {
      stopped = true;
      if (decoder.state !== 'closed') {
        try {
          decoder.close();
        } catch {
          // already closing/closed
        }
      }
      if (writer) {
        try {
          writer.close();
        } catch {
          // ignore
        }
      }
      if (audioEl) {
        audioEl.pause();
        (audioEl as any).srcObject = null;
        audioEl = null;
      }
    },
  };
}
