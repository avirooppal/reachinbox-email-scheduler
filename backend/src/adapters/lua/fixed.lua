-- KEYS[1] = rl:{sender}:{windowStart}      hourly counter
-- KEYS[2] = gap:{sender}                   next allowed send time (ms)
-- KEYS[3] = spill:{sender}:{windowStart}   overflow rank for this window
-- ARGV: now_ms, limit, min_delay_ms, window_ms, window_start
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[2])
local gap = tonumber(ARGV[3])
local win = tonumber(ARGV[4])
local now = tonumber(ARGV[1])
local wstart = tonumber(ARGV[5])

if count >= limit then
  local rank = redis.call('INCR', KEYS[3])
  redis.call('PEXPIRE', KEYS[3], win * 3)
  local retry = wstart + win + math.floor((rank - 1) / limit) * win + ((rank - 1) % limit) * gap
  return {1, retry, 0, count}                       -- LIMITED: return {1, retryAt, 0, currentCount}
end

local nextAllowed = tonumber(redis.call('GET', KEYS[2]) or '0')
if now < nextAllowed then
  return {2, nextAllowed, 0, count}                 -- TOO_SOON: return {2, retryAt, 0, currentCount}
end

count = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], win * 2)
redis.call('SET', KEYS[2], now + gap, 'PX', gap * 2)
local limitReachedNow = (count == limit) and 1 or 0
return {0, now, limitReachedNow, count}             -- ALLOWED: return {0, reservedAt, limitReachedNow, count}
