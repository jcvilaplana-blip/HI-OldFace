/**
 * rtcCall — llamada de audio/vídeo con el servidor RTC propio (mediasoup SFU).
 * Sustituye a ZEGOCLOUD UIKit en CallPage / VideoCallPage. Sirve para 1:1 y grupo.
 *
 *   const call = new RtcCall({ roomId, video, onPeerStream, onPeerLeft, onPeerMedia });
 *   await call.join();          // cámara/micro + entrar en la sala
 *   call.setMic(false); call.setCamera(false);
 *   call.leave();
 *
 * Eventos (callbacks):
 *   onPeerStream(userId, stream, { name })   → llega o se amplía el stream de un participante
 *   onPeerLeft(userId)                       → un participante salió
 *   onPeerMedia(userId, { kind, paused })    → micro/cámara de un participante pausado o reanudado
 */
import { Device } from 'mediasoup-client';
import { rtcRequest, onRtc } from './rtcClient';

export class RtcCall {
  constructor({ roomId, video = false, onPeerStream, onPeerLeft, onPeerMedia }) {
    this.roomId = roomId;
    this.video = video;
    this.cb = { onPeerStream, onPeerLeft, onPeerMedia };
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.localStream = null;
    this.producers = {};            // kind → producer
    this.peers = new Map();         // userId → { name, stream }
    this.consumerOwner = new Map(); // producerId → { userId, consumer }
    this.unsubs = [];
    this.closed = false;
  }

  async join() {
    // 1. Cámara / micrófono (antes de entrar, para fallar pronto si se deniega el permiso)
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: this.video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } : false,
    });
    if (this.closed) { this.stopLocal(); return; }

    // 2. Eventos de la sala (suscribirse antes de unirse para no perder producers)
    this.unsubs.push(
      onRtc('rtc:newProducer', (p) => { if (p.roomId === this.roomId) this.consume(p.producerId, p.userId, p.name).catch(e => console.warn('[RtcCall] consume:', e.message)); }),
      onRtc('rtc:peerLeft', (p) => { if (p.roomId === this.roomId) this.removePeer(p.userId); }),
      onRtc('rtc:consumerClosed', (p) => { if (p.roomId === this.roomId) this.dropConsumer(p.producerId); }),
      onRtc('rtc:consumerPaused', (p) => { if (p.roomId === this.roomId) this.emitMedia(p.producerId, true); }),
      onRtc('rtc:consumerResumed', (p) => { if (p.roomId === this.roomId) this.emitMedia(p.producerId, false); }),
    );

    // 3. Entrar en la sala y preparar transports
    const j = await rtcRequest('rtc:join', { roomId: this.roomId });
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: j.routerRtpCapabilities });
    this.sendTransport = await this.createTransport('send', j.iceServers);
    this.recvTransport = await this.createTransport('recv', j.iceServers);

    // 4. Publicar micro (y cámara)
    for (const track of this.localStream.getTracks()) {
      const opts = track.kind === 'video'
        ? { track, encodings: [{ maxBitrate: 900_000 }], codecOptions: { videoGoogleStartBitrate: 600 } }
        : { track, codecOptions: { opusStereo: false, opusDtx: true, opusFec: true } };
      this.producers[track.kind] = await this.sendTransport.produce(opts);
    }

    // 5. Recibir a quien ya estaba en la sala
    for (const peer of j.peers) {
      this.ensurePeer(peer.userId, peer.name);
      for (const pr of peer.producers) await this.consume(pr.id, peer.userId, peer.name);
    }
  }

  async createTransport(direction, iceServers) {
    const t = await rtcRequest('rtc:createTransport', { roomId: this.roomId, direction });
    const params = { id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters, iceServers };
    const transport = direction === 'send' ? this.device.createSendTransport(params) : this.device.createRecvTransport(params);
    transport.on('connect', ({ dtlsParameters }, ok, fail) =>
      rtcRequest('rtc:connectTransport', { roomId: this.roomId, transportId: transport.id, dtlsParameters }).then(() => ok(), fail));
    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, ok, fail) =>
        rtcRequest('rtc:produce', { roomId: this.roomId, transportId: transport.id, kind, rtpParameters, appData })
          .then(r => ok({ id: r.id }), fail));
    }
    transport.on('connectionstatechange', (s) => console.log(`[RtcCall] ${direction}: ${s}`));
    return transport;
  }

  ensurePeer(userId, name) {
    if (!this.peers.has(userId)) this.peers.set(userId, { name: name || userId, stream: new MediaStream() });
    return this.peers.get(userId);
  }

  async consume(producerId, userId, name) {
    if (this.closed || this.consumerOwner.has(producerId)) return;
    const r = await rtcRequest('rtc:consume', {
      roomId: this.roomId, transportId: this.recvTransport.id, producerId, rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumer = await this.recvTransport.consume({ id: r.id, producerId: r.producerId, kind: r.kind, rtpParameters: r.rtpParameters });
    this.consumerOwner.set(producerId, { userId, consumer });
    const peer = this.ensurePeer(userId, name);
    // Nuevo MediaStream para que los elementos <video>/<audio> detecten el cambio
    peer.stream = new MediaStream([...peer.stream.getTracks(), consumer.track]);
    await rtcRequest('rtc:resumeConsumer', { roomId: this.roomId, consumerId: consumer.id });
    this.cb.onPeerStream?.(userId, peer.stream, { name: peer.name });
    if (r.producerPaused) this.cb.onPeerMedia?.(userId, { kind: r.kind, paused: true });
  }

  dropConsumer(producerId) {
    const entry = this.consumerOwner.get(producerId);
    if (!entry) return;
    this.consumerOwner.delete(producerId);
    entry.consumer.close();
    const peer = this.peers.get(entry.userId);
    if (peer) {
      peer.stream = new MediaStream(peer.stream.getTracks().filter(t => t !== entry.consumer.track));
      this.cb.onPeerStream?.(entry.userId, peer.stream, { name: peer.name });
    }
  }

  emitMedia(producerId, paused) {
    const entry = this.consumerOwner.get(producerId);
    if (entry) this.cb.onPeerMedia?.(entry.userId, { kind: entry.consumer.kind, paused });
  }

  removePeer(userId) {
    for (const [pid, entry] of this.consumerOwner) {
      if (entry.userId === userId) { entry.consumer.close(); this.consumerOwner.delete(pid); }
    }
    if (this.peers.delete(userId)) this.cb.onPeerLeft?.(userId);
  }

  async setProducerPaused(kind, paused) {
    const p = this.producers[kind];
    if (!p) return;
    if (paused) p.pause(); else p.resume();
    try { await rtcRequest('rtc:setProducerPaused', { roomId: this.roomId, producerId: p.id, paused }); } catch { /* sigue local */ }
  }

  setMic(on)    { return this.setProducerPaused('audio', !on); }
  setCamera(on) { return this.setProducerPaused('video', !on); }

  get remoteCount() { return this.peers.size; }

  stopLocal() {
    this.localStream?.getTracks().forEach(t => t.stop());
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    rtcRequest('rtc:leave', { roomId: this.roomId }).catch(() => {});
    try { this.sendTransport?.close(); } catch {}
    try { this.recvTransport?.close(); } catch {}
    this.stopLocal();
    this.peers.clear();
    this.consumerOwner.clear();
  }
}
