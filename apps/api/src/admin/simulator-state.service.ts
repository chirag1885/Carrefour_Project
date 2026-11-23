import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { conflict } from '../common/errors';
import { RedisService } from '../redis/redis.service';

export interface SimulatorConfig {
  eventsPerSecond: number;
  seed: number;
}

export interface SimulatorState {
  running: boolean;
  config: SimulatorConfig;
}

const KEY = 'simulator:state';

const DEFAULT_STATE: SimulatorState = {
  running: false,
  config: { eventsPerSecond: 1, seed: 42 },
};

/**
 * Owns the simulator:state Redis key.
 *
 * start/stop use a Lua compare-and-set so two concurrent requests cannot both
 * get a 200: exactly one wins and the other gets a 409.
 */
@Injectable()
export class SimulatorStateService implements OnModuleInit {
  private readonly log = new Logger('SimulatorState');

  // Lua: atomically transition running=false->true. Returns 1 on success, 0 on conflict.
  private readonly START_SCRIPT = `
    local raw = redis.call('GET', KEYS[1])
    local s = raw and cjson.decode(raw) or cjson.decode(ARGV[2])
    if s.running then return 0 end
    s.running = true
    redis.call('SET', KEYS[1], cjson.encode(s))
    return 1
  `;

  // Lua: atomically transition running=true->false. Returns 1 on success, 0 on conflict.
  private readonly STOP_SCRIPT = `
    local raw = redis.call('GET', KEYS[1])
    local s = raw and cjson.decode(raw) or cjson.decode(ARGV[2])
    if not s.running then return 0 end
    s.running = false
    redis.call('SET', KEYS[1], cjson.encode(s))
    return 1
  `;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    // Seed the key with defaults if it has never been set.
    await this.redis.client.setnx(KEY, JSON.stringify(DEFAULT_STATE));
  }

  async get(): Promise<SimulatorState> {
    const raw = await this.redis.client.get(KEY);
    return raw ? (JSON.parse(raw) as SimulatorState) : { ...DEFAULT_STATE };
  }

  async start(): Promise<SimulatorState> {
    const result = await this.redis.client.eval(
      this.START_SCRIPT, 1, KEY, JSON.stringify(DEFAULT_STATE),
    );
    if (result === 0) throw conflict('SIMULATOR_ALREADY_RUNNING', 'Simulator is already running');
    return this.get();
  }

  async stop(): Promise<SimulatorState> {
    const result = await this.redis.client.eval(
      this.STOP_SCRIPT, 1, KEY, JSON.stringify(DEFAULT_STATE),
    );
    if (result === 0) throw conflict('SIMULATOR_ALREADY_STOPPED', 'Simulator is already stopped');
    return this.get();
  }

  /**
   * Merge-patch config fields (not a full replace). The worker picks up the new values on its
   * next 1-second tick without restarting. If eventsPerSecond is 0, the worker idles.
   */
  async configure(patch: Partial<SimulatorConfig>): Promise<SimulatorState> {
    const MERGE_SCRIPT = `
      local raw = redis.call('GET', KEYS[1])
      local s = raw and cjson.decode(raw) or cjson.decode(ARGV[2])
      local patch = cjson.decode(ARGV[1])
      if patch.eventsPerSecond ~= nil then s.config.eventsPerSecond = patch.eventsPerSecond end
      if patch.seed ~= nil then s.config.seed = patch.seed end
      redis.call('SET', KEYS[1], cjson.encode(s))
      return cjson.encode(s)
    `;
    const raw = await this.redis.client.eval(
      MERGE_SCRIPT, 1, KEY, JSON.stringify(patch), JSON.stringify(DEFAULT_STATE),
    );
    this.log.log(`config updated: ${raw}`);
    return JSON.parse(raw as string) as SimulatorState;
  }
}
