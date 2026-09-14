import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';

/**
 * The only file that knows the network exists. A party is a star: one player
 * hosts under a short room code on PeerJS's free public matchmaking server,
 * everyone else connects straight to them over WebRTC. No server of ours, so
 * the whole game can keep living on GitHub Pages.
 */

export type Msg = { t: string; [k: string]: unknown };

const PREFIX = 'heirloom-party-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(what)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function errType(e: unknown): string {
  return (e as { type?: string })?.type ?? String((e as { message?: string })?.message ?? e);
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    const fail = (e: unknown) => {
      peer.destroy();
      reject(new Error(errType(e) === 'unavailable-id' ? 'unavailable-id' : 'The matchmaking server refused: ' + errType(e)));
    };
    peer.once('error', fail);
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
  });
}

function isMsg(d: unknown): d is Msg {
  return !!d && typeof d === 'object' && typeof (d as { t?: unknown }).t === 'string';
}

// --------------------------------------------------------------------- host

export class HostNet {
  readonly code: string;
  readonly id: string;
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onMsg: (id: string, m: Msg) => void = () => {};
  onTrouble: (text: string) => void = () => {};

  private constructor(peer: Peer, code: string) {
    this.peer = peer;
    this.code = code;
    this.id = peer.id;
    peer.on('connection', (c) => this.accept(c));
    peer.on('disconnected', () => {
      // the matchmaking link dropped; players already connected are unaffected
      this.onTrouble('Lost the matchmaking server. Reconnecting so new players can still join.');
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500);
    });
    peer.on('error', (e) => {
      if (errType(e) === 'peer-unavailable') return;
      this.onTrouble('Network trouble: ' + errType(e));
    });
  }

  static async open(): Promise<HostNet> {
    let last: unknown = null;
    for (let i = 0; i < 4; i++) {
      const code = makeCode();
      try {
        const peer = await withTimeout(openPeer(PREFIX + code), 12000,
          'The matchmaking server did not answer. Check your connection and try again.');
        return new HostNet(peer, code);
      } catch (e) {
        last = e;
        if ((e as Error).message !== 'unavailable-id') break;
      }
    }
    throw last ?? new Error('Could not open a party.');
  }

  private accept(c: DataConnection): void {
    c.on('open', () => {
      this.conns.set(c.peer, c);
      this.onJoin(c.peer);
    });
    c.on('data', (d) => { if (isMsg(d)) this.onMsg(c.peer, d); });
    const gone = () => {
      if (this.conns.get(c.peer) !== c) return;
      this.conns.delete(c.peer);
      this.onLeave(c.peer);
    };
    c.on('close', gone);
    c.on('error', gone);
  }

  get size(): number { return this.conns.size; }

  send(id: string, m: Msg): void {
    const c = this.conns.get(id);
    if (c?.open) c.send(m);
  }

  broadcast(m: Msg, except?: string): void {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(m);
  }

  kick(id: string): void {
    this.conns.get(id)?.close();
  }

  close(): void {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer.destroy();
  }
}

// -------------------------------------------------------------------- guest

export class GuestNet {
  readonly id: string;
  private peer: Peer;
  private conn: DataConnection;
  private closed = false;
  onMsg: (m: Msg) => void = () => {};
  onClose: () => void = () => {};

  private constructor(peer: Peer, conn: DataConnection) {
    this.peer = peer;
    this.conn = conn;
    this.id = peer.id;
    conn.on('data', (d) => { if (isMsg(d)) this.onMsg(d); });
    const gone = () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose();
    };
    conn.on('close', gone);
    conn.on('error', gone);
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  static async join(code: string): Promise<GuestNet> {
    const peer = await withTimeout(openPeer(), 12000,
      'The matchmaking server did not answer. Check your connection and try again.');
    const conn = peer.connect(PREFIX + cleanCode(code), { reliable: true });
    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        conn.once('open', () => resolve());
        conn.once('error', () => reject(new Error('Could not reach the host.')));
        peer.once('error', (e) => reject(new Error(
          errType(e) === 'peer-unavailable' ? 'No party is open with that code.' : 'Could not reach the host: ' + errType(e),
        )));
      }), 16000, 'The host did not answer. Their network may block direct connections; try the same Wi-Fi.');
    } catch (e) {
      peer.destroy();
      throw e;
    }
    return new GuestNet(peer, conn);
  }

  send(m: Msg): void {
    if (this.conn.open) this.conn.send(m);
  }

  close(): void {
    this.closed = true;
    this.conn.close();
    this.peer.destroy();
  }
}
