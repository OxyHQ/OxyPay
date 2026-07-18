/**
 * Multi-peer connection manager for the FairCoin P2P network.
 *
 * Maintains a pool of connected peers, handles discovery via DNS seeds,
 * rotation, reconnection, and dispatches incoming messages.
 */

import type { NetworkConfig } from "@fairco.in/core";
import { resolveDNSSeeds, type NativeDnsResolver } from "./dns-seeds";
import { Peer, type PeerConfig, type PeerEvents, type SocketProvider } from "./peer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A connectivity event worth surfacing to telemetry/logging (review finding
 * L6). Peer errors and disconnects used to be swallowed entirely, making
 * network problems invisible. A consumer can supply {@link PeerManagerConfig.onEvent}
 * to observe them; the default is a no-op so behaviour is unchanged when unset.
 */
export interface PeerManagerEvent {
  /** What happened: a transport/protocol error, or a peer disconnect. */
  readonly type: "peer-error" | "peer-disconnect";
  /** The peer's `host:port` identifier. */
  readonly peer: string;
  /** Human-readable detail (the error message or disconnect reason). */
  readonly detail: string;
}

export type PeerEventSink = (event: PeerManagerEvent) => void;

export interface PeerManagerConfig {
  network: NetworkConfig;
  socketProvider: SocketProvider;
  nativeDnsResolver?: NativeDnsResolver;
  targetPeers?: number;
  maxPeers?: number;
  /**
   * Optional telemetry hook for connectivity events (errors, disconnects).
   * Defaults to a no-op. Must not throw; it is called from socket callbacks.
   */
  onEvent?: PeerEventSink;
  /**
   * Optional list of `host` addresses to seed `knownAddresses` with on
   * `start()`. Used by the wallet to (a) bootstrap from the persisted
   * `peers` table so the first connection round isn't blocked on DNS, and
   * (b) honour user-added peers from the "Add Peer" UI — without this,
   * `database.insertPeer` was a dead write because the peer manager only
   * learned addresses from DNS seeds and on-wire `addr` messages (N-5).
   */
  initialKnownAddresses?: readonly string[];
}

export type MessageHandler = (peer: Peer, command: string, payload: Uint8Array) => void;
export type PeerReadyHandler = (peer: Peer) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TARGET_PEERS = 8;
const DEFAULT_MAX_PEERS = 12;
const RECONNECT_INTERVAL_MS = 30_000; // 30 seconds
const PEER_DISCOVERY_INTERVAL_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// PeerManager
// ---------------------------------------------------------------------------

export class PeerManager {
  private readonly network: NetworkConfig;
  private readonly socketProvider: SocketProvider;
  private readonly nativeDnsResolver: NativeDnsResolver | undefined;
  private readonly targetPeers: number;
  private readonly maxPeers: number;
  private readonly onEvent: PeerEventSink;

  private readonly peers: Map<string, Peer> = new Map();
  private readonly knownAddresses: Set<string> = new Set();
  private readonly failedAddresses: Map<string, number> = new Map(); // address -> fail count

  private messageHandlers: MessageHandler[] = [];
  private peerReadyHandlers: PeerReadyHandler[] = [];
  private reconnectTimer: ReturnType<typeof setInterval> | undefined;
  private discoveryTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(config: PeerManagerConfig) {
    this.network = config.network;
    this.socketProvider = config.socketProvider;
    this.nativeDnsResolver = config.nativeDnsResolver;
    this.targetPeers = config.targetPeers ?? DEFAULT_TARGET_PEERS;
    this.maxPeers = config.maxPeers ?? DEFAULT_MAX_PEERS;
    this.onEvent = config.onEvent ?? noopEventSink;
    // N-5: load any address the caller wants us to know about before the
    // first DNS round (persisted "good peers" cache, user-added peers).
    if (config.initialKnownAddresses) {
      for (const addr of config.initialKnownAddresses) {
        this.knownAddresses.add(addr);
      }
    }
  }

  /**
   * Emit a connectivity event to the configured sink, guarding against a sink
   * that throws so a faulty telemetry hook can never break the network loop.
   */
  private emitEvent(event: PeerManagerEvent): void {
    try {
      this.onEvent(event);
    } catch {
      // A telemetry sink must never disrupt connectivity. Swallowing here is
      // deliberate and scoped to the observer callback only.
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Start the peer manager: discover peers, connect, and begin reconnection loop.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    // Initial peer discovery
    await this.discoverPeers();

    // Connect to initial peers
    this.fillConnections();

    // Periodic reconnection
    this.reconnectTimer = setInterval(() => {
      if (this.running) {
        this.fillConnections();
      }
    }, RECONNECT_INTERVAL_MS);

    // Periodic discovery
    this.discoveryTimer = setInterval(() => {
      if (this.running) {
        void this.discoverPeers();
      }
    }, PEER_DISCOVERY_INTERVAL_MS);
  }

  /**
   * Stop the peer manager and disconnect all peers.
   */
  stop(): void {
    this.running = false;

    if (this.reconnectTimer !== undefined) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.discoveryTimer !== undefined) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }

    for (const peer of this.peers.values()) {
      peer.disconnect();
    }
    this.peers.clear();
  }

  /**
   * Broadcast a message to all ready peers.
   */
  broadcast(command: string, payload: Uint8Array): void {
    for (const peer of this.peers.values()) {
      if (peer.state === "ready") {
        peer.sendMessage(command, payload);
      }
    }
  }

  /**
   * Send a message to a single ready peer.
   * Returns true if a peer was available and the message was sent.
   */
  sendToOne(command: string, payload: Uint8Array): boolean {
    for (const peer of this.peers.values()) {
      if (peer.state === "ready") {
        peer.sendMessage(command, payload);
        return true;
      }
    }
    return false;
  }

  /**
   * Get all currently connected/ready peers.
   */
  getPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get all ready peers.
   */
  getReadyPeers(): Peer[] {
    return Array.from(this.peers.values()).filter((p) => p.state === "ready");
  }

  /**
   * Get the best known chain height across all connected peers.
   */
  getBestHeight(): number {
    let best = 0;
    for (const peer of this.peers.values()) {
      if (peer.bestHeight > best) {
        best = peer.bestHeight;
      }
    }
    return best;
  }

  /**
   * Register a handler for incoming messages from any peer.
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a handler called when a peer completes the version handshake.
   */
  onPeerReady(handler: PeerReadyHandler): void {
    this.peerReadyHandlers.push(handler);
  }

  /**
   * Remove a previously registered message handler.
   */
  removeMessageHandler(handler: MessageHandler): void {
    const idx = this.messageHandlers.indexOf(handler);
    if (idx >= 0) {
      this.messageHandlers.splice(idx, 1);
    }
  }

  /**
   * Manually add a peer address to the known set.
   */
  addKnownAddress(address: string): void {
    this.knownAddresses.add(address);
  }

  // -----------------------------------------------------------------------
  // Peer discovery
  // -----------------------------------------------------------------------

  private async discoverPeers(): Promise<void> {
    try {
      const addresses = await resolveDNSSeeds(
        this.network.dnsSeeds,
        this.nativeDnsResolver,
      );
      for (const addr of addresses) {
        this.knownAddresses.add(addr);
      }
    } catch {
      // DNS resolution failed entirely — this is expected on networks without
      // DNS access. resolveDNSSeeds already returns fallback peers on failure,
      // so the knownAddresses set will still be populated from prior calls.
    }
  }

  // -----------------------------------------------------------------------
  // Connection management
  // -----------------------------------------------------------------------

  private fillConnections(): void {
    const currentCount = this.peers.size;
    const needed = this.targetPeers - currentCount;

    if (needed <= 0) {
      return;
    }

    // Build candidate list: known addresses not currently connected and not
    // excessively failed
    const candidates: string[] = [];
    for (const addr of this.knownAddresses) {
      const peerKey = `${addr}:${this.network.p2pPort}`;
      if (this.peers.has(peerKey)) {
        continue;
      }

      const failCount = this.failedAddresses.get(addr) ?? 0;
      // Back off: skip addresses that have failed many times recently
      if (failCount > 5) {
        continue;
      }

      candidates.push(addr);
    }

    // Shuffle candidates for randomised peer selection
    shuffleArray(candidates);

    const toConnect = Math.min(needed, candidates.length, this.maxPeers - currentCount);
    for (let i = 0; i < toConnect; i++) {
      this.connectToPeer(candidates[i]);
    }
  }

  private connectToPeer(host: string): void {
    const config: PeerConfig = {
      host,
      port: this.network.p2pPort,
      network: this.network,
    };

    const events: PeerEvents = {
      onReady: (peer: Peer) => {
        // Reset fail count on successful connection
        this.failedAddresses.delete(peer.host);
        // Notify subscribers
        for (const handler of this.peerReadyHandlers) {
          handler(peer);
        }
      },
      onMessage: (peer: Peer, command: string, payload: Uint8Array) => {
        this.dispatchMessage(peer, command, payload);
      },
      onDisconnect: (peer: Peer, reason: string) => {
        this.peers.delete(peer.id);
        // Schedule reconnection attempt
        const fails = (this.failedAddresses.get(peer.host) ?? 0) + 1;
        this.failedAddresses.set(peer.host, fails);
        this.emitEvent({
          type: "peer-disconnect",
          peer: peer.id,
          detail: reason,
        });
      },
      onError: (peer: Peer, error: Error) => {
        // Fail tracking is handled by the disconnect that follows; surface the
        // error to telemetry so connectivity problems are observable (L6).
        this.emitEvent({
          type: "peer-error",
          peer: peer.id,
          detail: error.message,
        });
      },
    };

    const peer = new Peer(config, events, this.socketProvider);
    this.peers.set(peer.id, peer);
    peer.connect();
  }

  // -----------------------------------------------------------------------
  // Message dispatch
  // -----------------------------------------------------------------------

  private dispatchMessage(peer: Peer, command: string, payload: Uint8Array): void {
    for (const handler of this.messageHandlers) {
      handler(peer, command, payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Default telemetry sink: ignores every event (no observability configured). */
function noopEventSink(_event: PeerManagerEvent): void {
  // Intentionally empty — the default behaviour is to not observe events.
}

/** Fisher-Yates shuffle (in-place). */
function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
