-- Sliding window rate limiter using sorted set
-- KEYS[1] = srl:{sender}         sorted set of recent send timestamps
-- KEYS[2] = gap:{sender}         next allowed send time (ms)
-- ARGV: now_ms, limit, min_delay_ms, window_ms
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local gap = tonumber(ARGV[3])
local win = tonumber(ARGV[4])

-- Prune entries older than rolling window
local cutoff = now - win
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)

local count = redis.call('ZCARD', KEYS[1])

if count >= limit then
  -- Find oldest item in the sliding window
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local oldestScore = tonumber(oldest[2])
  local retryAt = oldestScore + win
  if retryAt <= now then retryAt = now + 100 end
  return {1, retryAt, 0, count}                     -- LIMITED
end

local nextAllowed = tonumber(redis.call('GET', KEYS[2]) or '0')
if now < nextAllowed then
  return {2, nextAllowed, 0, count}                 -- TOO_SOON
end

-- Add current send to sliding sorted set
redis.call('ZADD', KEYS[1], now, now)
redis.call('PEXPIRE', KEYS[1], win * 2)
redis.call('SET', KEYS[2], now + gap, 'PX', gap * 2)

count = count + 1
local limitReachedNow = (count == limit) and 1 or 0
return {0, now, limitReachedNow, count}             -- ALLOWED
